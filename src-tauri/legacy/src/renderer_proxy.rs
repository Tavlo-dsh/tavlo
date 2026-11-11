//! Loopback reverse proxy presenting the desktop renderer capability.
//!
//! The official Host gate classifies marker-carrying carrier traffic as the
//! desktop renderer only when it carries the generation's secret
//! `x-dsh-desktop-renderer` header. System WebViews cannot attach per-request
//! headers, so the Tauri shell fronts the carrier with a loopback proxy whose
//! path embeds the same unguessable value: the webview loads
//! `http://127.0.0.1:<proxy-port>/<secret>/...` and every same-origin request
//! (including WebSocket upgrades) is forwarded with the header attached.

use std::sync::Arc;

use bytes::Bytes;
use http_body_util::BodyExt as _;
use hyper::body::Incoming;
use hyper::header::{
    HeaderValue, CONNECTION, CONTENT_LENGTH, CONTENT_TYPE, HOST, LOCATION, ORIGIN,
    TRANSFER_ENCODING,
};
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use url::Url;

use crate::window_spec::RendererAccessHeader;

type BoxedBody =
    http_body_util::combinators::UnsyncBoxBody<Bytes, Box<dyn std::error::Error + Send + Sync>>;

const HOP_BY_HOP_HEADERS: &[&str] = &["connection", "keep-alive", "proxy-connection", "te", "trailer"];

/// Running proxy for one Desktop generation.
pub struct RendererProxy {
    port: u16,
    secret: String,
    accept_task: tokio::task::JoinHandle<()>,
}

/// Rewrite a carrier URL so the webview reaches it through the proxy.
pub fn proxied_url(port: u16, secret: &str, original: &Url) -> Url {
    let mut url = original.clone();
    let _ = url.set_scheme("http");
    let _ = url.set_host(Some("127.0.0.1"));
    let _ = url.set_port(Some(port));
    let path = url.path().to_string();
    url.set_path(&format!("/{secret}{path}"));
    url
}

/// Strip the secret prefix from a proxied request path; `None` rejects the request.
pub fn strip_secret_path<'a>(secret: &str, path: &'a str) -> Option<&'a str> {
    let prefix = format!("/{secret}");
    let rest = path.strip_prefix(&prefix)?;
    if rest.is_empty() {
        Some("/")
    } else if rest.starts_with('/') {
        // `/secretfoo` must not authenticate as `/secret`.
        Some(rest)
    } else {
        None
    }
}

/// Rewrite a redirect Location so follow-up requests stay on the proxy path.
pub fn rewrite_location(secret: &str, target: &Url, proxy_origin: &str, location: &str) -> String {
    if let Ok(absolute) = Url::parse(location) {
        if absolute.scheme() == target.scheme()
            && absolute.host_str() == target.host_str()
            && absolute.port() == target.port()
        {
            let tail = &absolute[url::Position::BeforePath..];
            return format!("{proxy_origin}/{secret}{tail}");
        }
        return location.to_string();
    }
    if location.starts_with('/') {
        return format!("{proxy_origin}/{secret}{location}");
    }
    location.to_string()
}

/// Script injected into carrier HTML: every same-origin request the renderer
/// makes — absolute carrier URLs and, crucially, the relative `/api/...`
/// paths the kernel client actually uses (fetch, XHR, and WebSocket upgrades,
/// which carry no `Referer` to authorize them) — is rewritten onto the
/// proxy's secret path so the renderer capability reaches the carrier.
pub fn origin_rewrite_script(carrier_authority: &str, proxy_authority: &str, secret: &str) -> String {
    let carrier = serde_json::to_string(carrier_authority).expect("carrier authority json");
    let proxy_base = serde_json::to_string(&format!("http://{proxy_authority}/{secret}"))
        .expect("proxy base json");
    let proxy_authority_json =
        serde_json::to_string(proxy_authority).expect("proxy authority json");
    let secret_json = serde_json::to_string(secret).expect("proxy secret json");
    format!(
        r#"(function () {{
  if (window.__DSH_DESKTOP_ORIGIN_REWRITE__) return;
  window.__DSH_DESKTOP_ORIGIN_REWRITE__ = true;
  var CARRIER = {carrier};
  var BASE = {proxy_base};
  var PROXY_AUTH = {proxy_authority_json};
  var SECRET_PREFIX = '/' + {secret_json} + '/';
  function withSecret(u) {{
    var p = new URL(BASE + u.pathname + u.search + u.hash);
    if (u.protocol === 'ws:') p.protocol = 'ws:';
    if (u.protocol === 'wss:') p.protocol = 'wss:';
    return p.href;
  }}
  function rewrite(raw) {{
    try {{
      var u = new URL(String(raw), location.href);
      // Authority, not origin: WebKit derives a ws: URL's origin as
      // `ws://host:port`, so origin equality silently never matches the
      // event-stream WebSockets this rewrite exists for.
      if (u.host === CARRIER) return withSecret(u);
      if (u.host === PROXY_AUTH
        && u.pathname.slice(0, SECRET_PREFIX.length) !== SECRET_PREFIX) return withSecret(u);
      return null;
    }} catch (error) {{ return null; }}
  }}
  var fetchNative = window.fetch;
  if (typeof fetchNative === 'function') {{
    window.fetch = function (input, init) {{
      if (typeof input === 'string') {{
        var rewritten = rewrite(input);
        if (rewritten !== null) input = rewritten;
      }}
      return fetchNative.call(window, input, init);
    }};
  }}
  var openNative = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {{
    var rewritten = rewrite(arguments[1]);
    if (rewritten !== null) arguments[1] = rewritten;
    return openNative.apply(this, arguments);
  }};
  var webSocketNative = window.WebSocket;
  if (typeof webSocketNative === 'function') {{
    function WrappedWebSocket(url, protocols) {{
      var rewritten = rewrite(url);
      var target = rewritten === null ? String(url) : rewritten;
      if (target.indexOf('http://') === 0) target = 'ws://' + target.slice(7);
      else if (target.indexOf('https://') === 0) target = 'wss://' + target.slice(8);
      return protocols === undefined
        ? new webSocketNative(target)
        : new webSocketNative(target, protocols);
    }}
    WrappedWebSocket.prototype = webSocketNative.prototype;
    Object.setPrototypeOf(WrappedWebSocket, webSocketNative);
    window.WebSocket = WrappedWebSocket;
  }}
}})();"#
    )
}

/// Insert the script into an HTML document right after the `<head>` open tag
/// so it runs before every application script.
pub fn inject_origin_rewrite(document: &str, script: &str) -> String {
    let tag = format!("<script>{script}</script>");
    let lower = document.to_ascii_lowercase();
    for marker in ["<head>", "<head "] {
        if let Some(start) = lower.find(marker) {
            let insert_at = if marker == "<head>" {
                start + marker.len()
            } else {
                document[start..]
                    .find('>')
                    .map(|offset| start + offset + 1)
                    .unwrap_or(start)
            };
            return format!("{}{tag}{}", &document[..insert_at], &document[insert_at..]);
        }
    }
    format!("{tag}{document}")
}

/// Same-origin checks on the carrier compare against the carrier origin, so a
/// browser `Origin` naming the proxy must be translated when forwarded.
pub fn forwarded_origin(proxy_origin: &str, carrier_origin: &str, origin: &str) -> String {
    if origin == proxy_origin {
        carrier_origin.to_string()
    } else {
        origin.to_string()
    }
}

/// Decide the upstream path for a proxied request. The first navigation
/// carries the secret as its first path segment; every same-origin
/// subresource resolves against the origin root and instead proves the
/// capability through its `Referer`. Anything else is rejected.
pub fn resolve_authorized_path(
    secret: &str,
    path: &str,
    headers: &hyper::HeaderMap,
) -> Option<String> {
    if let Some(stripped) = strip_secret_path(secret, path) {
        return Some(stripped.to_string());
    }
    let referer = headers
        .get(hyper::header::REFERER)
        .and_then(|value| value.to_str().ok())?;
    // "http://127.0.0.1:port/<secret>/..." -> "<secret>/..."
    let referer_path = referer.split("://").nth(1)?.splitn(2, '/').nth(1)?;
    let tail = referer_path.strip_prefix(secret)?;
    if tail.is_empty() || tail.starts_with('/') {
        Some(path.to_string())
    } else {
        None
    }
}

fn boxed<B>(body: B) -> BoxedBody
where
    B: hyper::body::Body<Data = Bytes> + Send + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    body.map_err(Into::into).boxed_unsync()
}

fn plain_response(status: StatusCode) -> Response<BoxedBody> {
    let mut response = Response::new(boxed(http_body_util::Empty::<Bytes>::new()));
    *response.status_mut() = status;
    response
}

struct ProxyConfig {
    port: u16,
    target: Url,
    target_authority: String,
    header_name: hyper::header::HeaderName,
    header_value: HeaderValue,
    secret: String,
    origin_rewrite_script: String,
}

async fn forward(config: Arc<ProxyConfig>, request: Request<Incoming>) -> Response<BoxedBody> {
    let mut request = request;
    let on_browser_upgrade = hyper::upgrade::on(&mut request);
    let (parts, body) = request.into_parts();
    let Some(path) = resolve_authorized_path(&config.secret, parts.uri.path(), &parts.headers)
    else {
        #[cfg(dsh_devtools)]
        eprintln!(
            "dsh-desktop: renderer proxy rejected {} (no secret in path or referer)",
            parts.uri.path()
        );
        return plain_response(StatusCode::NOT_FOUND);
    };
    let upstream_uri = match parts.uri.query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_string(),
    };

    let stream = match tokio::net::TcpStream::connect(&config.target_authority).await {
        Ok(stream) => stream,
        Err(_) => return plain_response(StatusCode::BAD_GATEWAY),
    };
    // One loopback connection per request keeps upgrade tunneling independent
    // of connection pooling; handshake cost on 127.0.0.1 is negligible.
    let (mut sender, connection) =
        match hyper::client::conn::http1::handshake::<_, Incoming>(TokioIo::new(stream)).await {
            Ok(pair) => pair,
            Err(_) => return plain_response(StatusCode::BAD_GATEWAY),
        };
    let connection = connection.with_upgrades();
    tokio::spawn(async move {
        let _ = connection.await;
    });

    let mut builder = Request::builder()
        .method(parts.method.clone())
        .uri(upstream_uri)
        .header(HOST, &config.target_authority)
        .header(&config.header_name, config.header_value.clone());
    {
        // WebSocket upgrades must retain `Connection: Upgrade` end to end.
        let is_upgrade_request = parts.headers.contains_key(hyper::header::UPGRADE);
        let proxy_origin = format!("http://127.0.0.1:{}", config.port);
        let carrier_origin = format!("http://{}", config.target_authority);
        let headers = builder.headers_mut().expect("request headers");
        for (name, value) in parts.headers.iter() {
            if name == HOST {
                continue;
            }
            if name == ORIGIN {
                if let Some(origin) = value.to_str().ok() {
                    if let Ok(rewritten) =
                        HeaderValue::from_str(&forwarded_origin(&proxy_origin, &carrier_origin, origin))
                    {
                        headers.append(ORIGIN, rewritten);
                        continue;
                    }
                }
            }
            let hop_by_hop = if is_upgrade_request {
                ["keep-alive", "proxy-connection", "te", "trailer"].contains(&name.as_str())
            } else {
                HOP_BY_HOP_HEADERS.contains(&name.as_str())
            };
            if hop_by_hop {
                continue;
            }
            headers.append(name, value.clone());
        }
    }
    let upstream_request = match builder.body(body) {
        Ok(request) => request,
        Err(_) => return plain_response(StatusCode::BAD_GATEWAY),
    };

    let mut response = match sender.send_request(upstream_request).await {
        Ok(response) => response,
        Err(error) => {
            #[cfg(dsh_devtools)]
            eprintln!("dsh-desktop: renderer proxy upstream send failed: {error}");
            return plain_response(StatusCode::BAD_GATEWAY);
        }
    };
    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        // hyper hands the client-side upgrade future to the 101 response.
        let on_upstream_upgrade = hyper::upgrade::on(&mut response);
        tokio::spawn(async move {
            let (Ok(mut browser), Ok(mut upstream)) = (
                on_browser_upgrade.await,
                on_upstream_upgrade.await,
            ) else {
                return;
            };
            let mut browser = TokioIo::new(browser);
            let mut upstream = TokioIo::new(upstream);
            let _ = tokio::io::copy_bidirectional(&mut browser, &mut upstream).await;
        });
        return response.map(|body| boxed(body));
    }
    if response.status().is_redirection() {
        if let Some(location) = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string())
        {
            let proxy_origin = format!("http://127.0.0.1:{}", config.port);
            let rewritten = rewrite_location(&config.secret, &config.target, &proxy_origin, &location);
            if let Ok(value) = HeaderValue::from_str(&rewritten) {
                response.headers_mut().insert(LOCATION, value);
            }
        }
    }
    response.headers_mut().remove(CONNECTION);
    let is_html = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/html"));
    if is_html {
        let (parts, body) = response.into_parts();
        return match body.collect().await {
            Ok(collected) => {
                let bytes = collected.to_bytes();
                let Some(document) = std::str::from_utf8(&bytes).ok() else {
                    return Response::from_parts(parts, boxed(http_body_util::Full::new(bytes)));
                };
                let injected = inject_origin_rewrite(document, &config.origin_rewrite_script);
                let mut rebuilt = Response::from_parts(
                    parts,
                    boxed(http_body_util::Full::new(Bytes::from(injected.clone()))),
                );
                let headers = rebuilt.headers_mut();
                // The body was replaced with a fixed-length buffer: the framing
                // must be content-length only, never both length declarations.
                headers.remove(TRANSFER_ENCODING);
                headers.remove(CONTENT_LENGTH);
                if let Ok(length) = HeaderValue::from_str(&injected.len().to_string()) {
                    headers.insert(CONTENT_LENGTH, length);
                }
                rebuilt
            }
            Err(_) => plain_response(StatusCode::BAD_GATEWAY),
        };
    }
    response.map(|body| boxed(body))
}

impl RendererProxy {
    /// Start the proxy on a random loopback port. Must run inside a tokio runtime.
    pub async fn start(target: Url, header: RendererAccessHeader) -> std::io::Result<Self> {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        let header_name = header
            .name
            .parse::<hyper::header::HeaderName>()
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        let header_value = HeaderValue::from_str(&header.value)
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        let authority = match target.port() {
            Some(port) => format!("{}:{port}", target.host_str().unwrap_or("127.0.0.1")),
            None => target.host_str().unwrap_or("127.0.0.1").to_string(),
        };
        let secret = header.value.clone();
        let script = origin_rewrite_script(
            &authority,
            &format!("127.0.0.1:{port}"),
            &secret,
        );
        let config = Arc::new(ProxyConfig {
            port,
            target,
            target_authority: authority.clone(),
            header_name,
            header_value,
            secret: secret.clone(),
            origin_rewrite_script: script,
        });
        let accept_task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let config = Arc::clone(&config);
                let service = service_fn(move |request| {
                    let config = Arc::clone(&config);
                    async move { Ok::<_, std::convert::Infallible>(forward(config, request).await) }
                });
                let connection = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .with_upgrades();
                tokio::spawn(async move {
                    let _ = connection.await;
                });
            }
        });
        Ok(Self {
            port,
            secret,
            accept_task,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn secret(&self) -> &str {
        &self.secret
    }

    /// URL the webview should load for a carrier URL of this generation.
    pub fn webview_url(&self, original: &Url) -> Url {
        proxied_url(self.port, &self.secret, original)
    }
}

impl Drop for RendererProxy {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    const SECRET: &str = "s3cret_token_value_with_43_chars_padding_xx";

    #[test]
    fn proxied_url_inserts_secret_path_segment() {
        let original =
            Url::parse("http://127.0.0.1:43120/?dsh-desktop-mode=compatibility").unwrap();
        let proxied = proxied_url(54321, SECRET, &original);
        assert_eq!(
            proxied.as_str(),
            format!("http://127.0.0.1:54321/{SECRET}/?dsh-desktop-mode=compatibility")
        );
    }

    #[test]
    fn strip_secret_path_keeps_nested_paths() {
        assert_eq!(strip_secret_path(SECRET, &format!("/{SECRET}")), Some("/"));
        assert_eq!(
            strip_secret_path(SECRET, &format!("/{SECRET}/api/v1")),
            Some("/api/v1")
        );
        assert_eq!(strip_secret_path(SECRET, "/other/path"), None);
        assert_eq!(
            strip_secret_path(SECRET, &format!("/{SECRET}lookalike")),
            None
        );
    }

    #[test]
    fn rewrite_location_retargets_carrier_redirects_only() {
        let target = Url::parse("http://127.0.0.1:43120").unwrap();
        let origin = "http://127.0.0.1:54321";
        assert_eq!(
            rewrite_location(SECRET, &target, origin, "/landing?x=1"),
            format!("{origin}/{SECRET}/landing?x=1")
        );
        assert_eq!(
            rewrite_location(
                SECRET,
                &target,
                origin,
                "http://127.0.0.1:43120/deep/path#frag"
            ),
            format!("{origin}/{SECRET}/deep/path#frag")
        );
        assert_eq!(
            rewrite_location(SECRET, &target, origin, "https://example.com/"),
            "https://example.com/"
        );
    }

    #[test]
    fn origin_rewrite_script_embeds_carrier_and_proxy_base() {
        let script = origin_rewrite_script("127.0.0.1:43120", "127.0.0.1:54321", SECRET);
        assert!(script.contains("\"127.0.0.1:43120\""));
        assert!(script.contains(&format!("\"http://127.0.0.1:54321/{SECRET}\"")));
        assert!(script.contains("__DSH_DESKTOP_ORIGIN_REWRITE__"));
        assert!(script.contains("window.fetch"));
        assert!(script.contains("window.WebSocket"));
    }

    #[test]
    fn origin_rewrite_script_prefixes_secret_onto_same_origin_requests() {
        let script = origin_rewrite_script("127.0.0.1:43120", "127.0.0.1:54321", SECRET);
        // Relative /api paths resolve against the proxy origin and must gain
        // the secret path — WebSocket upgrades carry no Referer to authorize
        // them, so the old carrier-only rewrite 404'd every event stream.
        // Authority-based matching, not origin: WebKit derives a ws: URL's
        // origin as `ws://host:port`, so origin equality never matched there.
        assert!(script.contains("u.host === CARRIER"));
        assert!(script.contains("u.host === PROXY_AUTH"));
        assert!(script.contains("u.pathname.slice(0, SECRET_PREFIX.length) !== SECRET_PREFIX"));
        assert!(script.contains("new URL(BASE + u.pathname + u.search + u.hash)"));
        // A WebSocket constructor handed an http(s) URL throws SyntaxError.
        assert!(script.contains("target.indexOf('http://') === 0"));
    }

    #[test]
    fn inject_origin_rewrite_targets_head_open_tag() {
        let document =
            "<!doctype html><html><head><title>x</title></head><body></body></html>";
        let injected = inject_origin_rewrite(document, "/*s*/");
        assert!(injected.starts_with(
            "<!doctype html><html><head><script>/*s*/</script><title>x</title>"
        ));
        let spaced = inject_origin_rewrite("<html><head lang=\"en\"><title>y</title>", "/*s*/");
        assert!(spaced.starts_with("<html><head lang=\"en\"><script>/*s*/</script><title>y</title>"));
        let headless = inject_origin_rewrite("<html><body></body></html>", "/*s*/");
        assert!(headless.starts_with("<script>/*s*/</script><html>"));
    }

    type GateBody = http_body_util::combinators::BoxBody<Bytes, std::convert::Infallible>;

    fn gate_text(body: &'static str) -> GateBody {
        http_body_util::Full::new(Bytes::from(body)).boxed()
    }

    /// Carrier stand-in that 403s any request without the renderer header.
    async fn spawn_gate_server() -> u16 {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let service = service_fn(|request: Request<Incoming>| async move {
                    let (parts, _body) = request.into_parts();
                    let is_renderer = parts
                        .headers
                        .get("x-dsh-desktop-renderer")
                        .map(|value| value == "renderer-token")
                        .unwrap_or(false);
                    let carrier_origin = format!("http://{}", parts.headers.get(HOST).unwrap().to_str().unwrap());
                    let origin_ok = parts
                        .headers
                        .get(ORIGIN)
                        .and_then(|value| value.to_str().ok())
                        .map(|value| value == carrier_origin)
                        .unwrap_or(false);
                    if parts.uri.path() == "/ws" && is_renderer {
                        let mut response = Response::new(gate_text(""));
                        *response.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
                        let on_upgrade = {
                            let mut whole = Request::from_parts(parts, ());
                            hyper::upgrade::on(&mut whole)
                        };
                        tokio::spawn(async move {
                            if let Ok(upgraded) = on_upgrade.await {
                                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                                let mut upgraded = TokioIo::new(upgraded);
                                let mut buffer = [0u8; 32];
                                if let Ok(read) = upgraded.read(&mut buffer).await {
                                    let _ = upgraded.write_all(&buffer[..read]).await;
                                }
                            }
                        });
                        return Ok::<_, std::convert::Infallible>(response);
                    }
                    if !is_renderer {
                        let mut response = Response::new(gate_text(""));
                        *response.status_mut() = StatusCode::FORBIDDEN;
                        return Ok(response);
                    }
                    if parts.uri.path() == "/report" {
                        // Mirrors the carrier's same-origin private routes.
                        if !origin_ok {
                            let mut response = Response::new(gate_text(""));
                            *response.status_mut() = StatusCode::FORBIDDEN;
                            return Ok(response);
                        }
                        return Ok(Response::new(gate_text("report-ok")));
                    }
                    if parts.uri.path() == "/" {
                        let mut response = Response::new(gate_text(
                            "<!doctype html><html><head><meta charset=\"utf-8\"><title>shell</title></head><body>app</body></html>",
                        ));
                        response.headers_mut().insert(
                            CONTENT_TYPE,
                            HeaderValue::from_static("text/html; charset=utf-8"),
                        );
                        // Match the real carrier: explicitly chunked index responses.
                        response.headers_mut().insert(
                            TRANSFER_ENCODING,
                            HeaderValue::from_static("chunked"),
                        );
                        return Ok(response);
                    }
                    if parts.uri.path() == "/redirect" {
                        let mut response = Response::new(gate_text(""));
                        *response.status_mut() = StatusCode::FOUND;
                        response
                            .headers_mut()
                            .insert(LOCATION, HeaderValue::from_static("/landing"));
                        return Ok(response);
                    }
                    Ok(Response::new(gate_text("renderer-ok")))
                });
                let connection = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .with_upgrades();
                tokio::spawn(async move {
                    let _ = connection.await;
                });
            }
        });
        port
    }

    async fn start_proxy() -> (RendererProxy, Url) {
        let gate_port = spawn_gate_server().await;
        let target = Url::parse(&format!("http://127.0.0.1:{gate_port}")).unwrap();
        let carrier = target.clone();
        let proxy = RendererProxy::start(
            target,
            RendererAccessHeader {
                name: "x-dsh-desktop-renderer".into(),
                value: "renderer-token".into(),
            },
        )
        .await
        .unwrap();
        (proxy, carrier)
    }

    async fn get(url: &Url) -> Response<Incoming> {
        get_with_origin(url, None).await
    }

    async fn get_with_origin(url: &Url, origin: Option<&str>) -> Response<Incoming> {
        let stream = tokio::net::TcpStream::connect((
            url.host_str().unwrap(),
            url.port_or_known_default().unwrap(),
        ))
        .await
        .unwrap();
        let (mut sender, connection) = hyper::client::conn::http1::handshake::<_, http_body_util::Empty<Bytes>>(
            TokioIo::new(stream),
        )
        .await
        .unwrap();
        tokio::spawn(async move {
            let _ = connection.with_upgrades().await;
        });
        let path_and_query = match url.query() {
            Some(query) => format!("{}?{}", url.path(), query),
            None => url.path().to_string(),
        };
        let mut request = Request::builder()
            .uri(path_and_query)
            .header(HOST, url.authority());
        if let Some(origin) = origin {
            request = request.header(ORIGIN, origin);
        }
        let request = request.body(http_body_util::Empty::<Bytes>::new()).unwrap();
        sender.send_request(request).await.unwrap()
    }

    fn url_with_secret(proxy: &RendererProxy, tail: &str) -> Url {
        Url::parse(&format!(
            "http://127.0.0.1:{}/{}{tail}",
            proxy.port(),
            proxy.secret()
        ))
        .unwrap()
    }

    #[tokio::test]
    async fn proxy_gates_on_secret_and_adds_renderer_header() {
        let (proxy, carrier) = start_proxy().await;

        let target = url_with_secret(&proxy, "/api?v=2");
        let response = get(&target).await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"renderer-ok");

        let wrong = Url::parse(&format!(
            "http://127.0.0.1:{}/{}wrong/api",
            proxy.port(),
            proxy.secret()
        ))
        .unwrap();
        assert_eq!(get(&wrong).await.status(), StatusCode::NOT_FOUND);

        // Direct carrier access without the header stays forbidden.
        assert_eq!(get(&carrier).await.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn forwarded_origin_translates_only_the_proxy_origin() {
        assert_eq!(
            forwarded_origin("http://127.0.0.1:54321", "http://127.0.0.1:43120", "http://127.0.0.1:54321"),
            "http://127.0.0.1:43120"
        );
        assert_eq!(
            forwarded_origin("http://127.0.0.1:54321", "http://127.0.0.1:43120", "http://127.0.0.1:54322"),
            "http://127.0.0.1:54322"
        );
    }

    #[test]
    fn authorized_paths_accept_secret_prefix_or_secret_referer() {
        let mut headers = hyper::HeaderMap::new();
        // First navigation: secret in the path.
        assert_eq!(
            resolve_authorized_path(SECRET, &format!("/{SECRET}/api"), &headers),
            Some("/api".to_string())
        );
        // Same-origin subresource: root path plus secret-bearing referer.
        headers.insert(
            hyper::header::REFERER,
            HeaderValue::from_str(&format!("http://127.0.0.1:54321/{SECRET}/x")).unwrap(),
        );
        assert_eq!(
            resolve_authorized_path(SECRET, "/assets/index.js", &headers),
            Some("/assets/index.js".to_string())
        );
        // Referer without the secret grants nothing.
        headers.insert(
            hyper::header::REFERER,
            HeaderValue::from_static("http://127.0.0.1:54321/"),
        );
        assert_eq!(resolve_authorized_path(SECRET, "/assets/index.js", &headers), None);
        // Near-miss referer secret is rejected.
        headers.insert(
            hyper::header::REFERER,
            HeaderValue::from_str(&format!("http://127.0.0.1:54321/{SECRET}evil/x")).unwrap(),
        );
        assert_eq!(resolve_authorized_path(SECRET, "/assets/index.js", &headers), None);
    }

    #[tokio::test]
    async fn proxy_rewrites_proxy_origin_to_carrier_origin() {
        let (proxy, _carrier) = start_proxy().await;
        let proxy_origin = format!("http://127.0.0.1:{}", proxy.port());
        let response = get_with_origin(&url_with_secret(&proxy, "/report"), Some(&proxy_origin)).await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"report-ok");
    }

    #[tokio::test]
    async fn proxy_injects_origin_rewrite_into_html() {
        let (proxy, _carrier) = start_proxy().await;
        let response = get(&url_with_secret(&proxy, "/")).await;
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers().clone();
        let content_type = headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert!(content_type.contains("text/html"), "content type: {content_type}");
        let content_length = headers
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok())
            .expect("html content length");
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(bytes.len(), content_length);
        assert!(
            !headers.contains_key(TRANSFER_ENCODING),
            "rewritten html must not keep transfer-encoding alongside content-length"
        );
        let document = String::from_utf8(bytes.to_vec()).unwrap();
        let head_open = document.find("<head>").expect("head open tag");
        let script_open = document.find("<script>").expect("injected script");
        assert!(
            script_open > head_open && script_open < head_open + 8,
            "script must run inside <head> before app assets"
        );
        assert!(document.contains("__DSH_DESKTOP_ORIGIN_REWRITE__"));
        assert!(document.contains("renderer-token"));
    }

    #[tokio::test]
    async fn proxy_rewrites_redirect_locations() {
        let (proxy, _carrier) = start_proxy().await;
        let response = get(&url_with_secret(&proxy, "/redirect")).await;
        assert_eq!(response.status(), StatusCode::FOUND);
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .unwrap()
            .to_string();
        assert_eq!(
            location,
            format!("http://127.0.0.1:{}/{}/landing", proxy.port(), proxy.secret())
        );
    }

    #[tokio::test]
    async fn proxy_tunnels_websocket_upgrades() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (proxy, _carrier) = start_proxy().await;
        let mut stream =
            tokio::net::TcpStream::connect(("127.0.0.1", proxy.port())).await.unwrap();
        let request = format!(
            "GET /{}/ws HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
            proxy.secret(),
            proxy.port()
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut buffer = [0u8; 1024];
        let read = stream.read(&mut buffer).await.unwrap();
        let head = String::from_utf8_lossy(&buffer[..read]).to_string();
        assert!(
            head.starts_with("HTTP/1.1 101"),
            "upgrade was not forwarded: {head}"
        );
        stream.write_all(b"ping").await.unwrap();
        let mut echo = [0u8; 4];
        stream.read_exact(&mut echo).await.unwrap();
        assert_eq!(&echo, b"ping");
    }
}
