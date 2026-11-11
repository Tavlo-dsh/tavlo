//! `dsh web` 输出协议：就绪行解析、版本解析、日志脱敏、导航判定。
//!
//! `dsh web --no-open` 在 Connection 认证可用后向 stdout 打印
//! `dsh web: http://127.0.0.1:<port>/?token=<进程凭据>`。浏览器访问该 URL
//! 换取签名 cookie 后重定向到不带凭据的根路径。

use url::Url;

pub const READY_PREFIX: &str = "dsh web:";

/// 去掉 ANSI 转义序列（CSI `ESC [ ... final`）。
pub fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

pub fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        None => false,
    }
}

/// 解析就绪行，返回带 token 的启动 URL。只接受 loopback 的 http(s) 地址；
/// 同前缀的其他提示行（如 "dsh web: listening on ..."）返回 `None`。
pub fn parse_ready_line(line: &str) -> Option<Url> {
    let clean = strip_ansi(line);
    let rest = clean.trim().strip_prefix(READY_PREFIX)?.trim();
    let url = Url::parse(rest).ok()?;
    if !matches!(url.scheme(), "http" | "https") || !is_loopback_host(&url) {
        return None;
    }
    Some(url)
}

/// 从 `dsh --version` 输出取版本号（第一行非空文本）。
pub fn parse_version(output: &str) -> Option<String> {
    output
        .lines()
        .map(|line| strip_ansi(line).trim().to_string())
        .find(|line| !line.is_empty())
        .map(|line| line.trim_start_matches('v').to_string())
        .filter(|line| line.chars().next().is_some_and(|c| c.is_ascii_digit()))
}

/// 日志里不保存进程凭据。
pub fn redact_token(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(index) = rest.find("token=") {
        let (head, tail) = rest.split_at(index + "token=".len());
        out.push_str(head);
        out.push_str("<redacted>");
        let end = tail
            .find(|c: char| c == '&' || c == '#' || c.is_whitespace())
            .unwrap_or(tail.len());
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

#[derive(Debug, PartialEq, Eq)]
pub enum NavigationDecision {
    /// 在主窗口内继续导航。
    Allow,
    /// 交给系统浏览器打开，主窗口不动。
    OpenExternal,
    /// 拒绝（未知协议）。
    Deny,
}

/// 主窗口导航策略：应用内置页面与 loopback（dsh web）留在窗口内；
/// 其他 http(s)/mailto 链接交给系统浏览器。
pub fn navigation_decision(url: &Url) -> NavigationDecision {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => NavigationDecision::Allow,
        "http" | "https" => {
            let app_host = url
                .host_str()
                .is_some_and(|host| host.eq_ignore_ascii_case("tauri.localhost"));
            if app_host || is_loopback_host(url) {
                NavigationDecision::Allow
            } else {
                NavigationDecision::OpenExternal
            }
        }
        "mailto" => NavigationDecision::OpenExternal,
        _ => NavigationDecision::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ready_line_with_token() {
        let url = parse_ready_line("dsh web: http://127.0.0.1:54135/?token=abc123").unwrap();
        assert_eq!(url.port(), Some(54135));
        assert_eq!(url.query(), Some("token=abc123"));
    }

    #[test]
    fn parses_ready_line_with_ansi_and_whitespace() {
        let url = parse_ready_line("\u{1b}[32mdsh web: http://localhost:3080/?token=x\u{1b}[0m\r").unwrap();
        assert_eq!(url.host_str(), Some("localhost"));
    }

    #[test]
    fn accepts_ipv6_loopback() {
        assert!(parse_ready_line("dsh web: http://[::1]:3080/?token=x").is_some());
    }

    #[test]
    fn ignores_other_dsh_web_lines() {
        assert!(parse_ready_line("dsh web: opening the default browser; pass --no-open to disable").is_none());
        assert!(parse_ready_line("dsh web: listening on 10.0.0.2 over plain HTTP; restrict this port").is_none());
        assert!(parse_ready_line("random output").is_none());
    }

    #[test]
    fn rejects_non_loopback_urls() {
        assert!(parse_ready_line("dsh web: http://10.0.0.2:3080/?token=x").is_none());
        assert!(parse_ready_line("dsh web: https://app.example/?token=x").is_none());
        assert!(parse_ready_line("dsh web: file:///etc/passwd").is_none());
    }

    #[test]
    fn parses_version_output() {
        assert_eq!(parse_version("0.2.2-rc.1\n").as_deref(), Some("0.2.2-rc.1"));
        assert_eq!(parse_version("\n v0.3.0 \n").as_deref(), Some("0.3.0"));
        assert_eq!(parse_version("error: boom"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn redacts_tokens() {
        assert_eq!(
            redact_token("dsh web: http://127.0.0.1:1/?token=secret&x=1"),
            "dsh web: http://127.0.0.1:1/?token=<redacted>&x=1"
        );
        assert_eq!(
            redact_token("a token=one b token=two"),
            "a token=<redacted> b token=<redacted>"
        );
        assert_eq!(redact_token("no secrets"), "no secrets");
    }

    #[test]
    fn navigation_keeps_app_and_loopback_inside() {
        let allow = |s: &str| navigation_decision(&Url::parse(s).unwrap());
        assert_eq!(allow("http://tauri.localhost/splash.html"), NavigationDecision::Allow);
        assert_eq!(allow("tauri://localhost/splash.html"), NavigationDecision::Allow);
        assert_eq!(allow("http://127.0.0.1:54135/"), NavigationDecision::Allow);
        assert_eq!(allow("https://github.com/x"), NavigationDecision::OpenExternal);
        assert_eq!(allow("mailto:a@b.c"), NavigationDecision::OpenExternal);
        assert_eq!(allow("file:///C:/x"), NavigationDecision::Deny);
    }
}
