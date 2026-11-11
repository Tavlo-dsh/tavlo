/// Presentation adapter for kernel-owned dialogs: the harness renders the
/// settings modal (centered 800px panel with nav rail) and the community
/// plugin market overlay (800x700 centered section) inside the main webview.
/// This script (evaluated on every main-window page load, next to
/// `TITLEBAR_DBLCLICK_SCRIPT`) restyles both into full-window pages and adds
/// a top-left "back to workspace" control to settings. Anchors are semantic
/// attributes and structural signatures only — never CSS-module hash class
/// names — so a future kernel shell change degrades silently back to the
/// stock modal.
pub const SETTINGS_FULLSCREEN_SCRIPT: &str = r#"(function () {
  if (window.__DSH_SETTINGS_FULLSCREEN__) return;
  window.__DSH_SETTINGS_FULLSCREEN__ = true;

  var STYLE_ID = 'dsh-settings-fullscreen-style';
  var BACK_ID = 'dsh-settings-fullscreen-back';
  var FS_MARK = 'data-dsh-fs';
  var BODY_OPEN = 'data-dsh-settings-fullscreen';

  var STYLE_TEXT = [
    '[data-dsh-fs="overlay"] { position: fixed !important; inset: 0 !important; width: auto !important; height: auto !important; z-index: 1000 !important; display: block !important; pointer-events: auto !important; background: transparent !important; }',
    '[data-dsh-fs="overlay"] > [aria-hidden="true"] { display: none !important; }',
    '[data-dsh-fs="panel"] { width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; border-radius: 0 !important; transform: none !important; animation: none !important; box-shadow: none !important; }',
    '[data-dsh-fs="panel"] > nav { min-width: 232px !important; padding-top: 6px !important; box-sizing: border-box; }',
    '#' + BACK_ID + ' { appearance: none; border: 0; background: rgba(127,127,127,0); color: inherit; opacity: .72; font: inherit; font-size: 13px; line-height: 1; display: flex; align-items: center; gap: 7px; text-align: left; cursor: pointer; padding: 9px 10px; margin: 54px 10px 6px; border-radius: 8px; width: calc(100% - 20px); box-sizing: border-box; }',
    '#' + BACK_ID + ':hover { opacity: 1; background: rgba(127,127,127,.16); }',
    '[data-dsh-fs="market"] { padding: 0 !important; align-items: stretch !important; justify-content: stretch !important; }',
    '[data-dsh-fs="market"] > section { width: 100vw !important; height: 100vh !important; max-width: none !important; border-radius: 0 !important; box-shadow: none !important; border-left: 0 !important; border-right: 0 !important; border-top: 0 !important; border-bottom: 0 !important; }',
    '[data-dsh-fs="market"] > button { display: none !important; }'
  ].join('\n');

  function cssEscape(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  // The settings panel is the only kernel dialog whose aria-labelledby title
  // node lives inside its nav rail; onboarding chrome never matches this.
  function isSettingsPanel(panel) {
    if (!panel || panel.getAttribute('role') !== 'dialog') return false;
    if (panel.getAttribute('aria-modal') !== 'true') return false;
    var titleId = panel.getAttribute('aria-labelledby');
    if (!titleId) return false;
    var nav = null;
    try {
      nav = panel.querySelector(':scope > nav');
      if (!nav) return false;
      return !!nav.querySelector('#' + cssEscape(titleId));
    } catch (error) {
      return false;
    }
  }

  function findSettingsPanel() {
    var candidates = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    for (var i = 0; i < candidates.length; i++) {
      if (isSettingsPanel(candidates[i])) return candidates[i];
    }
    return null;
  }

  // The market overlay *is* the dialog element, and its first rendered child
  // is the mask <button>; the settings dialog can never match this shape.
  function isMarketDialog(candidate) {
    if (!candidate || candidate.getAttribute('role') !== 'dialog') return false;
    if (candidate.getAttribute('aria-modal') !== 'true') return false;
    var first = candidate.firstElementChild;
    if (!first || first.tagName !== 'BUTTON' || first.getAttribute('aria-label') === null) return false;
    try { return !!candidate.querySelector(':scope > section'); } catch (error) { return false; }
  }

  function findMarketDialog() {
    var candidates = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    for (var i = 0; i < candidates.length; i++) {
      if (isMarketDialog(candidates[i])) return candidates[i];
    }
    return null;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = STYLE_TEXT;
    document.head.appendChild(tag);
  }

  function backLabel() {
    var lang = '';
    try {
      lang = (document.documentElement.getAttribute('lang') || '') + ' ' + (navigator.language || '');
    } catch (error) {}
    return /zh/i.test(lang) ? '← 返回工作区' : '← Back to workspace';
  }

  function ensureBackButton(nav) {
    var button = document.getElementById(BACK_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = BACK_ID;
      button.type = 'button';
      button.textContent = backLabel();
      button.addEventListener('click', function () {
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true, cancelable: true,
          }));
        } catch (error) {}
      });
    }
    button.setAttribute(FS_MARK, 'back');
    if (button.parentElement !== nav) nav.insertBefore(button, nav.firstChild);
  }

  function sweep() {
    var panel = findSettingsPanel();
    var market = findMarketDialog();
    if (!panel && !market) {
      document.body.removeAttribute(BODY_OPEN);
      var stale = document.getElementById(BACK_ID);
      if (stale && !stale.closest('[role="dialog"][aria-modal="true"]')) stale.remove();
      var marked = document.querySelectorAll('[' + FS_MARK + ']');
      for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(FS_MARK);
      return;
    }
    document.body.setAttribute(BODY_OPEN, 'open');
    installStyle();
    if (panel) {
      panel.setAttribute(FS_MARK, 'panel');
      var overlay = panel.parentElement;
      if (overlay && overlay !== document.body) overlay.setAttribute(FS_MARK, 'overlay');
      try {
        var nav = panel.querySelector(':scope > nav');
        if (nav) ensureBackButton(nav);
      } catch (error) {}
    }
    if (market) market.setAttribute(FS_MARK, 'market');
  }

  function start() {
    sweep();
    try {
      var scheduled = false;
      new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          sweep();
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (error) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();"#;

#[cfg(test)]
mod tests {
    use super::SETTINGS_FULLSCREEN_SCRIPT;

    #[test]
    fn guards_against_double_injection() {
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("window.__DSH_SETTINGS_FULLSCREEN__"));
    }

    #[test]
    fn anchors_on_semantic_structure_not_hashed_class_names() {
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains(r#"[role="dialog"][aria-modal="true"]"#));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains(":scope > nav"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("aria-labelledby"));
        assert!(!SETTINGS_FULLSCREEN_SCRIPT.contains("css.overlay"));
        assert!(!SETTINGS_FULLSCREEN_SCRIPT.contains("css.panel"));
    }

    #[test]
    fn carries_bilingual_back_labels() {
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("返回工作区"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("Back to workspace"));
    }

    #[test]
    fn fullscreen_rules_and_marks_are_declared() {
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("dsh-settings-fullscreen-style"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("dsh-settings-fullscreen-back"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("data-dsh-settings-fullscreen"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("width: 100vw"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("height: 100vh"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("border-radius: 0"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("display: none"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("pointer-events: auto"));
    }

    #[test]
    fn closes_through_official_escape_path_and_cleans_up() {
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("'Escape'"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("dispatchEvent"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("removeAttribute"));
    }

    #[test]
    fn observes_childlist_without_attribute_feedback_loop() {
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("MutationObserver"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("childList: true"));
        assert!(!SETTINGS_FULLSCREEN_SCRIPT.contains("attributes: true"));
    }

    #[test]
    fn recognizes_market_overlay_by_its_mask_button_signature() {
        // The market wrapper *is* the dialog and its first child is the mask
        // <button>; the settings dialog nests its labelledby title in a nav
        // instead. Both must be detectable without hash class names.
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("'BUTTON'"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains(":scope > section"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("[data-dsh-fs=\"market\"]"));
        assert!(SETTINGS_FULLSCREEN_SCRIPT.contains("width: 100vw"));
    }
}
