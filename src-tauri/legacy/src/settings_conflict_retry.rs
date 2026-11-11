//! Settings write adaptation: one transparent retry for a settings write the
//! kernel refused because the namespace moved under the writer, without
//! touching the pinned kernel checkout. Same injection mechanism as
//! `COMPOSER_SURFACES_SCRIPT` / `MAIN_VIEW_THEME_SCRIPT` — evaluated on every
//! main-window page load.
//!
//! The kernel's Models page freezes a namespace's revision when an editor card
//! mounts and sends it back as `expectedRevision`; a write that lost the race
//! (first attempt committed server-side but the card never learned, or a
//! concurrent editor) surfaces the raw `SettingsConflictError` text with no
//! recovery path. The kernel client resolves `globalThis.fetch` at call time,
//! so a fetch-level wrapper intercepts every unary RPC.
//!
//! Retry policy: only **targeted** writes — `settings.mutate` (path ops) and
//! `settings.update` (merge patch) — retry once, with the wire error's
//! `details.actual` as the fresh `expectedRevision`; the original rpcId rides
//! along because the client verifies the response echo against its own mint.
//! A targeted write re-applied onto the current namespace cannot clobber
//! another writer's keys. `settings.replace` (wholesale section rebuild) is
//! deliberately never retried: replaying it against a moved namespace would
//! delete a concurrent writer's change — and any secret the redacted view
//! never carried. A second conflict surfaces as-is; retrying once only.

pub const SETTINGS_CONFLICT_RETRY_SCRIPT: &str = r#"(function () {
  if (window.__DSH_SETTINGS_CONFLICT_RETRY__) return;
  window.__DSH_SETTINGS_CONFLICT_RETRY__ = true;

  var RETRYABLE = { 'settings.mutate': true, 'settings.update': true };

  function freshRpcId() {
    var c = window.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function requestPath(input) {
    try {
      var href = typeof input === 'string' ? input : String(input);
      var base = window.location && window.location.href ? String(window.location.href) : 'http://dsh.internal/';
      return new URL(href, base).pathname;
    } catch (error) {
      return null;
    }
  }

  function retriableRequest(init) {
    if (!init || typeof init.body !== 'string') return null;
    if ((init.method || 'GET').toUpperCase() !== 'POST') return null;
    var parsed;
    try { parsed = JSON.parse(init.body); } catch (error) { return null; }
    if (!parsed || parsed.type !== 'client-request' || !RETRYABLE[parsed.method]) return null;
    if (!parsed.payload || typeof parsed.payload.expectedRevision !== 'number') return null;
    return parsed;
  }

  function retryBody(request, envelope) {
    var result = envelope && envelope.result;
    if (!result || result.ok !== false || !result.error) return null;
    var error = result.error;
    if (error.code !== 'settings-conflict') return null;
    var details = error.details;
    if (!details || typeof details.actual !== 'number') return null;
    var payload = {};
    for (var key in request.payload) {
      if (Object.prototype.hasOwnProperty.call(request.payload, key)) payload[key] = request.payload[key];
    }
    payload.expectedRevision = details.actual;
    return JSON.stringify({ type: request.type, rpcId: request.rpcId, method: request.method, payload: payload });
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  window.fetch = function (input, init) {
    var path = requestPath(input);
    if (path === null || path.indexOf('/api/settings.') !== 0) return originalFetch(input, init);
    var request = retriableRequest(init);
    if (request === null) return originalFetch(input, init);
    return originalFetch(input, init).then(function (response) {
      if (!response.ok) return response;
      return response.clone().json().then(function (envelope) {
        var body = retryBody(request, envelope);
        if (body === null) return response;
        var retryInit = {};
        for (var key in init) {
          if (Object.prototype.hasOwnProperty.call(init, key)) retryInit[key] = init[key];
        }
        retryInit.body = body;
        return originalFetch(input, retryInit).then(function (retryResponse) {
          return retryResponse;
        }, function () {
          return response;
        });
      }, function () {
        return response;
      });
    });
  };
})();"#;

#[cfg(test)]
mod tests {
    use super::SETTINGS_CONFLICT_RETRY_SCRIPT;

    #[test]
    fn guards_against_double_injection() {
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("window.__DSH_SETTINGS_CONFLICT_RETRY__"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("if (window.__DSH_SETTINGS_CONFLICT_RETRY__) return;"));
    }

    #[test]
    fn wraps_fetch_at_the_layer_the_kernel_resolves_at_call_time() {
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("window.fetch = function (input, init)"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("var originalFetch = window.fetch;"));
    }

    #[test]
    fn retries_only_targeted_settings_writes() {
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("'settings.mutate': true"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("'settings.update': true"));
        // Wholesale rebuild is excluded on purpose: a replay could clobber a
        // concurrent writer's section (and secrets the redacted view lacks).
        assert!(!SETTINGS_CONFLICT_RETRY_SCRIPT.contains("'settings.replace'"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("'/api/settings.'"));
    }

    #[test]
    fn retry_uses_the_wire_error_actual_revision() {
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("error.code !== 'settings-conflict'"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("typeof details.actual !== 'number'"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("payload.expectedRevision = details.actual;"));
    }

    #[test]
    fn retry_is_single_shot_and_falls_back_to_the_original_response() {
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("!response.ok) return response;"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("body === null) return response;"));
        // Transport failure on the retry leg must not hide the original refusal.
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("return response;\n        });\n      }, function () {\n        return response;\n      });"));
    }

    #[test]
    fn request_gate_demands_the_client_request_envelope() {
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("parsed.type !== 'client-request'"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("!RETRYABLE[parsed.method]"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("typeof parsed.payload.expectedRevision !== 'number'"));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("(init.method || 'GET').toUpperCase() !== 'POST'"));
    }

    #[test]
    fn is_es5_with_no_arrow_functions_or_block_bindings() {
        assert!(!SETTINGS_CONFLICT_RETRY_SCRIPT.contains("=>"));
        assert!(!SETTINGS_CONFLICT_RETRY_SCRIPT.contains("const "));
        assert!(!SETTINGS_CONFLICT_RETRY_SCRIPT.contains("let "));
        assert!(SETTINGS_CONFLICT_RETRY_SCRIPT.contains("(function () {"));
    }
}
