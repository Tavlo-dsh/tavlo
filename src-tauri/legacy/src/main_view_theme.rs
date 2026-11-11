//! Desktop main-view theme: pins the kernel console to the reference dark
//! palette (near-black content, mid-gray sidebar, elevated #2b2b2b surfaces,
//! white primary buttons). The kernel is checkout-only, so — same pattern as
//! `SETTINGS_FULLSCREEN_SCRIPT` — this is an ES5 IIFE evaluated on every
//! main-window page load. It forces the dark base palette attribute and
//! installs one stylesheet overriding the kernel's `--dsw-*` alias/specific
//! tokens, the officially documented theming extension surface; no CSS-module
//! hash class names, no DOM grafting. Structural product-form gaps that CSS
//! cannot express are tracked in `docs/main-view-theme.md`, not faked here.

pub const MAIN_VIEW_THEME_SCRIPT: &str = r#"(function () {
  if (window.__DSH_DESKTOP_THEME__) return;
  window.__DSH_DESKTOP_THEME__ = true;

  var STYLE_ID = 'dsh-desktop-theme-style';
  var DARK = 'data-ds-dark-theme';

  // Alias/specific token overrides sampled from the reference build. Scoped
  // to body[data-ds-dark-theme] and !important so they also beat any inline
  // token variables the kernel ThemePresenter may project for its own themes.
  var TOKENS = [
    ['--dsw-alias-bg-base', '#161616'],
    ['--dsw-alias-bg-layer-1', '#1e1e1e'],
    ['--dsw-alias-bg-layer-2', '#222222'],
    ['--dsw-alias-bg-layer-3', '#2b2b2b'],
    ['--dsw-alias-bg-module-platform', '#1e1e1e'],
    ['--dsw-alias-bg-multi-select', '#2b2b2b'],
    ['--dsw-alias-bg-overlay', '#2e2e2e'],
    ['--dsw-alias-bg-skeleton', 'rgba(255,255,255,0.06)'],
    ['--dsw-specific-sidebar-fill', '#3a3b3b'],
    ['--dsw-specific-sidebar-nav-item-hover', '#444545'],
    ['--dsw-specific-sidebar-nav-item-active', '#4e4f4e'],
    ['--dsw-specific-sidebar-nav-item-active-accent', '#4e4f4e'],
    ['--dsw-specific-input-major', '#2b2b2b'],
    ['--dsw-specific-login-input', '#222222'],
    ['--dsw-specific-menu', '#2b2b2b'],
    ['--dsw-specific-selector', '#2b2b2b'],
    ['--dsw-specific-tip', '#2e2e2e'],
    ['--dsw-alias-tooltip-bg', '#363636'],
    ['--dsw-alias-toast-bg', '#2e2e2e'],
    ['--dsw-specific-bubble', '#222222'],
    ['--dsw-specific-bubble-highlight', '#2b2b2b'],
    ['--dsw-alias-markdown-code-block', '#262626'],
    ['--dsw-alias-markdown-code-block-banner', '#2b2b2b'],
    ['--dsw-alias-markdown-inline-code', '#2e2e2e'],
    ['--dsw-alias-markdown-code-segment-selected', '#333333'],
    ['--dsw-alias-markdown-code-segment-unselected', '#262626'],
    ['--dsw-alias-markdown-citation', '#2b2b2b'],
    ['--dsw-alias-markdown-tag', '#2b2b2b'],
    ['--dsw-alias-markdown-placeholder', '#262626'],
    ['--dsw-alias-label-primary', '#e6e6e6'],
    ['--dsw-alias-label-primary-bluish', '#e6e6e6'],
    ['--dsw-alias-label-primary-dimmed', '#c2c2c2'],
    ['--dsw-alias-label-primary-foreground', '#161616'],
    ['--dsw-alias-label-primary-inverted', '#161616'],
    ['--dsw-alias-label-secondary', '#9b9b9b'],
    ['--dsw-alias-label-tertiary', '#8a8a8a'],
    ['--dsw-alias-label-caption', '#707070'],
    ['--dsw-alias-label-dimmed', '#5e5e5e'],
    ['--dsw-alias-border-inverted', 'rgba(255,255,255,0.06)'],
    ['--dsw-alias-border-inverted2', 'rgba(255,255,255,0.08)'],
    ['--dsw-alias-border-l1', 'rgba(255,255,255,0.07)'],
    ['--dsw-alias-border-l2-darkmode-thin', 'rgba(255,255,255,0.06)'],
    ['--dsw-alias-border-l2', 'rgba(255,255,255,0.1)'],
    ['--dsw-alias-border-l3', 'rgba(255,255,255,0.14)'],
    ['--dsw-alias-border-l4', 'rgba(255,255,255,0.18)'],
    ['--dsw-alias-brand-primary', '#ffffff'],
    ['--dsw-alias-brand-primary-invert', '#161616'],
    ['--dsw-alias-brand-text', '#f0f0f0'],
    ['--dsw-alias-button-primary-fill', '#ffffff'],
    ['--dsw-alias-button-primary-hover', '#e3e3e3'],
    ['--dsw-alias-button-primary-dimmed', '#3a3b3b'],
    ['--dsw-alias-button-contrast-fill', '#2b2b2b'],
    ['--dsw-alias-button-elevated-fill', '#2b2b2b'],
    ['--dsw-alias-button-floating-fill', '#2b2b2b'],
    ['--dsw-alias-button-floating-hover', '#333333'],
    ['--dsw-alias-button-ghost-active-border', '#5e5e5e'],
    ['--dsw-alias-button-ghost-active-fill', '#3a3b3b'],
    ['--dsw-alias-button-ghost-active-hover', '#444545'],
    ['--dsw-alias-button-tool-bar-fill', 'rgba(58,59,59,0.6)'],
    ['--dsw-alias-button-tool-bar-hover', 'rgba(78,79,78,0.7)'],
    ['--dsw-alias-button-tool-bar-fill-invisible', 'rgba(22,22,22,0.36)'],
    ['--dsw-alias-interactive-bg-hover', 'rgba(255,255,255,0.07)'],
    ['--dsw-alias-interactive-bg-active', 'rgba(255,255,255,0.12)'],
    ['--dsw-alias-interactive-bg-hover-accent', 'rgba(255,255,255,0.16)'],
    ['--dsw-alias-interactive-bg-hover-solid', '#333333'],
    ['--dsw-alias-interactive-bg-hover-danger', 'rgba(242,90,90,0.15)'],
    ['--dsw-alias-state-success-primary', '#46bf72'],
    ['--dsw-alias-state-success-secondary', '#46bf72'],
    ['--dsw-alias-state-success-tertiary', 'rgba(70,191,114,0.16)'],
    ['--dsw-alias-scrollbar-bg-l1', '#404142'],
    ['--dsw-alias-scrollbar-bg-l2', '#4a4b4c'],
    ['--dsw-alias-scrollbar-hover-l1', '#4a4b4c'],
    ['--dsw-alias-scrollbar-hover-l2', '#565758']
  ];

  var declarations = [];
  for (var t = 0; t < TOKENS.length; t++) {
    declarations.push(TOKENS[t][0] + ': ' + TOKENS[t][1] + ' !important;');
  }
  var STYLE_TEXT = 'html { color-scheme: dark !important; }\n'
    + 'body[' + DARK + '] { ' + declarations.join(' ') + ' }\n'
    // The desktop frame titlebar blends a translucent fill over the native
    // window material, which reads near-black instead of the content base.
    // Anchor: the stable data attribute and the adapter's stable frame class
    // (both already used by window_ops.rs TITLEBAR selectors).
    + '[data-dsh-desktop-frame="titlebar"], .dshDesktopFrameTitlebar'
    + ' { background: #161616 !important; }';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = STYLE_TEXT;
    (document.head || document.documentElement).appendChild(tag);
  }

  // Compare-before-write: every write here re-fires the observers below, so a
  // write must only ever happen when the observed state actually differs.
  // The next pass then finds nothing to do and the loop terminates.
  function ensureDark() {
    var body = document.body;
    if (!body) return false;
    var dirty = false;
    if (!body.hasAttribute(DARK)) {
      body.setAttribute(DARK, '');
      dirty = true;
    }
    var root = document.documentElement;
    if (root && root.style.getPropertyValue('color-scheme') !== 'dark') {
      root.style.setProperty('color-scheme', 'dark');
      dirty = true;
    }
    return dirty;
  }

  var scheduled = false;
  function reassert() {
    scheduled = false;
    ensureDark();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reassert);
  }

  function start() {
    installStyle();
    ensureDark();
    try {
      var observer = new MutationObserver(schedule);
      // The kernel ThemePresenter toggles the palette attribute and an inline
      // root color-scheme on every theme snapshot; re-assert ours right after.
      observer.observe(document.body, { attributes: true, attributeFilter: [DARK] });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
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
    use super::MAIN_VIEW_THEME_SCRIPT;

    #[test]
    fn guards_against_double_injection() {
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("window.__DSH_DESKTOP_THEME__"));
    }

    #[test]
    fn forces_dark_base_palette_attribute() {
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("'data-ds-dark-theme'"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("body.setAttribute(DARK, '')"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("hasAttribute(DARK)"));
    }

    #[test]
    fn forces_root_color_scheme_dark() {
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("color-scheme: dark !important"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("getPropertyValue('color-scheme')"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("setProperty('color-scheme', 'dark')"));
    }

    #[test]
    fn token_overrides_are_scoped_and_important() {
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("body[' + DARK + '] {"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("!important;"));
    }

    #[test]
    fn covers_reference_palette_anchors() {
        // Content base, sidebar, elevated surfaces, text ladder, primary
        // button, and the reference success green — the sampled palette in
        // docs/main-view-theme.md.
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-alias-bg-base', '#161616']"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-specific-sidebar-fill', '#3a3b3b']"));
        assert!(MAIN_VIEW_THEME_SCRIPT
            .contains("['--dsw-specific-sidebar-nav-item-active', '#4e4f4e']"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-specific-input-major', '#2b2b2b']"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-alias-bg-layer-3', '#2b2b2b']"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-alias-label-primary', '#e6e6e6']"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-alias-label-secondary', '#9b9b9b']"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-alias-brand-primary', '#ffffff']"));
        assert!(MAIN_VIEW_THEME_SCRIPT
            .contains("['--dsw-alias-label-primary-foreground', '#161616']"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("['--dsw-alias-state-success-primary', '#46bf72']"));
        assert!(MAIN_VIEW_THEME_SCRIPT
            .contains("['--dsw-alias-markdown-code-block-banner', '#2b2b2b']"));
    }

    #[test]
    fn stays_on_token_extension_surface_not_hashed_class_names() {
        assert!(!MAIN_VIEW_THEME_SCRIPT.contains("querySelector"));
        assert!(!MAIN_VIEW_THEME_SCRIPT.contains(".module.css"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("--dsw-alias-"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("--dsw-specific-"));
    }

    #[test]
    fn observes_only_dark_attribute_and_root_style_without_write_loop() {
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("MutationObserver"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("attributeFilter: [DARK]"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("attributeFilter: ['style']"));
        // Every corrective write is compare-before-write, so the observer's
        // own re-fire finds nothing to do (rAF-coalesced, one extra pass).
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("if (!body.hasAttribute(DARK))"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("!== 'dark'"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("requestAnimationFrame"));
    }

    #[test]
    fn is_es5_with_no_arrow_functions_or_block_bindings() {
        assert!(!MAIN_VIEW_THEME_SCRIPT.contains("=>"));
        assert!(!MAIN_VIEW_THEME_SCRIPT.contains("const "));
        assert!(!MAIN_VIEW_THEME_SCRIPT.contains("let "));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("(function () {"));
    }

    #[test]
    fn installs_a_single_deduplicated_stylesheet() {
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("dsh-desktop-theme-style"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("if (document.getElementById(STYLE_ID)) return;"));
    }

    #[test]
    fn opaque_titlebar_uses_semantic_frame_anchor() {
        assert!(MAIN_VIEW_THEME_SCRIPT
            .contains("[data-dsh-desktop-frame=\"titlebar\"], .dshDesktopFrameTitlebar"));
        assert!(MAIN_VIEW_THEME_SCRIPT.contains("background: #161616"));
    }
}
