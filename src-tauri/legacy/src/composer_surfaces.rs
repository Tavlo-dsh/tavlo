//! Composer surface adaptation: reshapes two kernel composer components to
//! the reference product form without touching the pinned kernel checkout.
//! Evaluated on every main-window page load, same mechanism as
//! `SETTINGS_FULLSCREEN_SCRIPT` / `MAIN_VIEW_THEME_SCRIPT`.
//!
//! 1. Permission select (`ui-conversation` PermissionSelect): the menu rows
//!    gain the two-line title+description layout with Chinese copy, and the
//!    trigger chip tints orange while full access is the current preset.
//! 2. Context meter panel (ContextMeter): the popover is recomposed into the
//!    reference layout — 上下文容量 headline with 万-unit figures, percent
//!    breakdown rows, and a trailing 剩余额度 block fed by the `dsh-quota`
//!    plugin's `/api/dsh-quota/state` (omitted silently when absent).
//!
//! Anchors are semantic (aria labels, role attributes, known English preset
//! labels — the kernel hardcodes those). Every write is compare-before-write
//! and re-applied by an rAF-coalesced sweep, so React re-renders and our own
//! writes converge instead of looping.

pub const COMPOSER_SURFACES_SCRIPT: &str = r#"(function () {
  if (window.__DSH_COMPOSER_SURFACES__) return;
  window.__DSH_COMPOSER_SURFACES__ = true;

  var MARK = 'data-dsh-cs';
  var QUOTA_BLOCK = 'dsh-quota-block';
  var QUOTA_FETCH_MS = 5000;

  // Preset copy: kernel English labels are hardcoded (optionLabel), so the
  // product Chinese names ride on top of them. Unknown presets fall through
  // untouched and degrade to the stock row.
  var PRESETS = {
    'Full access': { name: '完全访问', desc: '减少确认次数。', accent: true },
    'Workspace Write': { name: '自动编辑', desc: '工作区内自动编辑文件。', accent: false },
    'Read Only': { name: '只读模式', desc: '仅读取，不做修改。', accent: false }
  };

  var STYLE_TEXT = [
    // Permission trigger chip: two-line-capable, orange while full access.
    'button[aria-label^="访问模式"] { border-radius: 999px; }',
    'button[aria-label^="访问模式"][' + MARK + '-accent] { color: #f59e0b !important; }',
    'button[aria-label^="访问模式"][' + MARK + '-accent] svg { color: #f59e0b !important; }',
    // Permission menu rows: reference two-line layout via grid.
    'div[role="menu"] div[role="menuitem"][' + MARK + '] { display: grid !important; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: auto auto; align-items: center; column-gap: 10px; row-gap: 2px; padding: 10px 12px !important; border-radius: 10px !important; }',
    'div[role="menu"] div[role="menuitem"][' + MARK + '] > span:first-child { grid-column: 1; grid-row: 1 / span 2; display: flex; align-items: center; }',
    'div[role="menu"] div[role="menuitem"][' + MARK + '][data-dsh-cs-desc] { padding-bottom: 9px !important; }',
    'div[role="menu"] div[role="menuitem"][' + MARK + '] > svg:last-child { grid-column: 3; grid-row: 1 / span 2; }',
    'span[' + MARK + '-desc] { grid-column: 2; grid-row: 2; font-size: 12px; line-height: 1.35; opacity: .64; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    'div[role="menu"] { padding: 6px !important; min-width: 264px; }',
    // Context meter panel: reference card layout.
    'div[role="dialog"][aria-label="上下文已用"], div[role="dialog"][aria-label="of context used"] { width: 340px !important; padding: 16px 16px 12px !important; border-radius: 14px !important; }',
    'div[role="dialog"][aria-label="上下文已用"] > div:first-child, div[role="dialog"][aria-label="of context used"] > div:first-child { display: none !important; }',
    'div[' + MARK + '-ctx-head] { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }',
    'div[' + MARK + '-ctx-head] strong { font-size: 14px; font-weight: 600; }',
    'div[' + MARK + '-ctx-head] span { font-size: 12px; opacity: .72; font-variant-numeric: tabular-nums; }',
    'div[role="dialog"][aria-label="上下文已用"] .dsh-cs-rows, div[role="dialog"][aria-label="of context used"] .dsh-cs-rows { margin-top: 10px; }',
    'div[role="dialog"][aria-label="上下文已用"] dl div, div[role="dialog"][aria-label="of context used"] dl div { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }',
    'div[' + MARK + '-quota] { margin-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.08)); padding-top: 10px; }',
    'div[' + MARK + '-quota] .dsh-quota-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }',
    'div[' + MARK + '-quota] .dsh-quota-head strong { font-size: 14px; font-weight: 600; }',
    'div[' + MARK + '-quota] .dsh-quota-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 14px; }',
    'div[' + MARK + '-quota] .dsh-quota-item .dsh-quota-name { font-size: 12px; opacity: .64; margin-bottom: 3px; }',
    'div[' + MARK + '-quota] .dsh-quota-item .dsh-quota-value { font-size: 13px; font-weight: 600; margin-bottom: 5px; }',
    'div[' + MARK + '-quota] .dsh-quota-item .dsh-quota-value small { font-weight: 400; font-size: 11px; opacity: .64; margin-left: 3px; }',
    'div[' + MARK + '-quota] .dsh-quota-bar { height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3, rgba(127,127,127,.35)); overflow: hidden; }',
    'div[' + MARK + '-quota] .dsh-quota-bar > i { display: block; height: 100%; border-radius: 999px; }',
    'div[' + MARK + '-quota] .dsh-quota-cache { display: flex; align-items: center; justify-content: space-between; padding: 7px 0 2px; font-size: 13px; }',
    'div[' + MARK + '-quota] .dsh-quota-cache span:first-child { opacity: .72; }',
    'div[' + MARK + '-quota] .dsh-quota-error { font-size: 12px; opacity: .5; padding: 4px 0 2px; }'
  ].join('\n');

  function installStyle() {
    if (document.getElementById('dsh-composer-surfaces-style')) return;
    var tag = document.createElement('style');
    tag.id = 'dsh-composer-surfaces-style';
    tag.textContent = STYLE_TEXT;
    document.head.appendChild(tag);
  }

  function presetOf(text) {
    return PRESETS[text] || null;
  }

  // The trigger carries `访问模式，当前：{name}` (zh) — map the current
  // preset from its suffix; English locale degrades to the stock label.
  function adaptTrigger(trigger) {
    var label = trigger.getAttribute('aria-label') || '';
    var at = label.indexOf('：');
    if (at === -1) return;
    var preset = presetOf(label.slice(at + 1).trim());
    if (!preset) return;
    var nameSpan = trigger.querySelector('span:nth-of-type(2)') || trigger.querySelector('span');
    var accent = preset.accent ? 'true' : null;
    if (trigger.getAttribute(MARK + '-accent') !== accent) {
      if (accent === null) trigger.removeAttribute(MARK + '-accent');
      else trigger.setAttribute(MARK + '-accent', accent);
    }
    var spans = trigger.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var own = spans[i].getAttribute('aria-hidden') === 'true';
      if (!own && spans[i].textContent !== preset.name) { spans[i].textContent = preset.name; break; }
    }
    if (nameSpan === null) return;
  }

  function adaptMenu(menu) {
    var items = menu.querySelectorAll('div[role="menuitem"]');
    var matched = 0;
    for (var i = 0; i < items.length; i++) {
      var labelNode = items[i].querySelector('span:nth-of-type(1)');
      // The icon span is aria-hidden inside a span wrapper; the label span
      // carries the plain text. Find the first span with non-empty text.
      var spans = items[i].querySelectorAll('span');
      labelNode = null;
      for (var s = 0; s < spans.length; s++) {
        if (spans[s].childElementCount === 0 && spans[s].textContent) { labelNode = spans[s]; break; }
      }
      if (!labelNode) continue;
      var preset = presetOf(labelNode.textContent.trim());
      if (!preset) continue;
      matched++;
      if (labelNode.textContent !== preset.name) labelNode.textContent = preset.name;
      items[i].setAttribute(MARK, 'perm');
      var desc = items[i].querySelector('span[' + MARK + '-desc]');
      if (!desc) {
        desc = document.createElement('span');
        desc.setAttribute(MARK + '-desc', '');
        items[i].appendChild(desc);
      }
      if (desc.textContent !== preset.desc) desc.textContent = preset.desc;
    }
    return matched > 0;
  }

  function parseTokens(text) {
    // formatTokens: `912` | `31.8K` | `1M` (the panel prefixes `~`).
    var m = /^\s*~?\s*([\d.]+)\s*([KM]?)\s*$/.exec(text || '');
    if (!m) return null;
    var value = parseFloat(m[1]);
    if (isNaN(value)) return null;
    if (m[2] === 'K') value *= 1000;
    if (m[2] === 'M') value *= 1000000;
    return value;
  }

  function formatWan(tokens) {
    // Reference copy reads in 万 units: 318000 → `31.8万`, 1000000 → `100万`.
    var wan = tokens / 10000;
    if (wan >= 100 || Math.abs(wan - Math.round(wan)) < 0.05) return String(Math.round(wan)) + '万';
    return String(Math.round(wan * 10) / 10) + '万';
  }

  function adaptContextPanel(panel) {
    panel.setAttribute(MARK, 'ctx');
    var figures = panel.querySelector('div:first-child');
    if (!figures) return;
    var percentNode = null;
    var figuresNode = null;
    var kids = figures.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === 'SPAN' && /%$/.test(kids[i].textContent || '')) percentNode = kids[i];
      if (/\/\s*$/.test(kids[i].textContent || '') || /\/\s*[\d.]+[KM]?/.test(kids[i].textContent || '')) figuresNode = kids[i];
    }
    if (!percentNode || !figuresNode) return;
    var percent = (percentNode.textContent || '').trim();
    var parts = (figuresNode.textContent || '').split('/');
    var used = parseTokens(parts[0]);
    var window = parseTokens(parts.length > 1 ? parts[1] : '');
    if (used === null || window === null) return;

    var head = panel.querySelector('div[' + MARK + '-ctx-head]');
    if (!head) {
      head = document.createElement('div');
      head.setAttribute(MARK + '-ctx-head', '');
      panel.insertBefore(head, panel.firstChild);
    }
    var want = '<strong>上下文容量</strong><span>' + formatWan(used) + '/' + formatWan(window) + '（' + percent + '）</span>';
    if (head.getAttribute(MARK + '-html') !== want) {
      head.innerHTML = want;
      head.setAttribute(MARK + '-html', want);
    }

    // Percent-of-breakdown per row, computed from the `~tokens` cells.
    var rows = panel.querySelectorAll('dl div');
    var total = 0;
    var values = [];
    for (var r = 0; r < rows.length; r++) {
      var dd = rows[r].querySelector('dd');
      var tokens = dd ? parseTokens(dd.textContent) : null;
      values.push(tokens);
      if (tokens !== null) total += tokens;
    }
    for (var r2 = 0; r2 < rows.length; r2++) {
      var dd2 = rows[r2].querySelector('dd');
      if (!dd2 || values[r2] === null || total === 0) continue;
      var share = Math.round(values[r2] / total * 1000) / 10;
      var wantText = share + '%';
      if (dd2.getAttribute(MARK + '-pct') !== wantText) {
        dd2.textContent = wantText;
        dd2.setAttribute(MARK + '-pct', wantText);
      }
    }
    ensureQuotaBlock(panel);
  }

  var quotaCache = { at: 0, state: null };

  function fetchQuotaState(done) {
    var now = Date.now();
    if (now - quotaCache.at < QUOTA_FETCH_MS && quotaCache.state !== null) {
      done(quotaCache.state);
      return;
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/dsh-quota/state', true);
      xhr.timeout = 2500;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var state = null;
        if (xhr.status === 200) {
          try { state = JSON.parse(xhr.responseText); } catch (error) { state = null; }
        }
        quotaCache = { at: now, state: state };
        done(state);
      };
      xhr.send(null);
    } catch (error) {
      quotaCache = { at: now, state: null };
      done(null);
    }
  }

  function barColor(index) {
    var colors = ['#3b82f6', '#22c55e', '#8b5cf6', '#f59e0b'];
    return colors[index % colors.length];
  }

  function renderQuota(block, state) {
    var html = '';
    if (!state || !state.configured) {
      html = '<div class="dsh-quota-error">剩余额度未配置（设置 → 额度）</div>';
    } else {
      html = '<div class="dsh-quota-head"><strong>剩余额度</strong></div><div class="dsh-quota-grid">';
      var quotas = state.quotas || [];
      for (var i = 0; i < quotas.length && i < 6; i++) {
        var q = quotas[i];
        var pct = Math.max(0, Math.min(100, Math.round(q.remainingPercent)));
        html += '<div class="dsh-quota-item">'
          + '<div class="dsh-quota-name">' + q.name + '</div>'
          + '<div class="dsh-quota-value">' + pct + '%<small>' + (q.resetLabel || '') + '</small></div>'
          + '<div class="dsh-quota-bar"><i style="width:' + pct + '%;background:' + barColor(i) + '"></i></div>'
          + '</div>';
      }
      html += '</div>';
      if (state.cacheHitPercent !== null && state.cacheHitPercent !== undefined) {
        html += '<div class="dsh-quota-cache"><span>平均缓存命中率</span><span>' + state.cacheHitPercent + '%</span></div>';
      }
    }
    if (block.getAttribute(MARK + '-html') !== html) {
      block.innerHTML = html;
      block.setAttribute(MARK + '-html', html);
    }
  }

  function ensureQuotaBlock(panel) {
    var block = panel.querySelector('div[' + MARK + '-quota]');
    if (!block) {
      block = document.createElement('div');
      block.setAttribute(MARK + '-quota', '');
      block.id = QUOTA_BLOCK;
      panel.appendChild(block);
    }
    fetchQuotaState(function (state) {
      var alive = document.getElementById(QUOTA_BLOCK);
      if (alive) renderQuota(alive, state);
    });
  }

  function sweep() {
    installStyle();
    var triggers = document.querySelectorAll('button[aria-label^="访问模式"]');
    for (var t = 0; t < triggers.length; t++) adaptTrigger(triggers[t]);
    var menus = document.querySelectorAll('div[role="menu"]');
    for (var m = 0; m < menus.length; m++) adaptMenu(menus[m]);
    var zhPanels = document.querySelectorAll('div[role="dialog"][aria-label="上下文已用"]');
    for (var p = 0; p < zhPanels.length; p++) adaptContextPanel(zhPanels[p]);
    var enPanels = document.querySelectorAll('div[role="dialog"][aria-label="of context used"]');
    for (var e = 0; e < enPanels.length; e++) adaptContextPanel(enPanels[e]);
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      sweep();
    });
  }

  function start() {
    sweep();
    try {
      var observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
    use super::COMPOSER_SURFACES_SCRIPT;

    #[test]
    fn guards_against_double_injection() {
        assert!(COMPOSER_SURFACES_SCRIPT.contains("window.__DSH_COMPOSER_SURFACES__"));
    }

    #[test]
    fn anchors_are_semantic_not_hashed_classes() {
        assert!(COMPOSER_SURFACES_SCRIPT.contains(r#"button[aria-label^="访问模式"]"#));
        assert!(COMPOSER_SURFACES_SCRIPT.contains(r#"div[role="menu"]"#));
        assert!(COMPOSER_SURFACES_SCRIPT.contains(r#"div[role="menuitem"]"#));
        assert!(COMPOSER_SURFACES_SCRIPT.contains(r#"aria-label="上下文已用""#));
        assert!(!COMPOSER_SURFACES_SCRIPT.contains(".module.css"));
    }

    #[test]
    fn carries_chinese_preset_copy_matching_reference() {
        assert!(COMPOSER_SURFACES_SCRIPT.contains("完全访问"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("减少确认次数。"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("自动编辑"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("工作区内自动编辑文件。"));
    }

    #[test]
    fn context_panel_recomposes_headline_and_percent_rows() {
        assert!(COMPOSER_SURFACES_SCRIPT.contains("上下文容量"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("formatWan"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("平均缓存命中率"));
    }

    #[test]
    fn quota_block_reads_plugin_state_and_degrades_silently() {
        assert!(COMPOSER_SURFACES_SCRIPT.contains("'/api/dsh-quota/state'"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("剩余额度"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("剩余额度未配置"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("xhr.timeout = 2500"));
    }

    #[test]
    fn writes_are_compare_before_write() {
        assert!(COMPOSER_SURFACES_SCRIPT.contains("!== preset.name"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("!== preset.desc"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("!== want"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("!== wantText"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("-html'"));
    }

    #[test]
    fn observer_coalesces_through_raf() {
        assert!(COMPOSER_SURFACES_SCRIPT.contains("MutationObserver"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("requestAnimationFrame"));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("if (scheduled) return;"));
    }

    #[test]
    fn is_es5_with_no_arrow_functions_or_block_bindings() {
        assert!(!COMPOSER_SURFACES_SCRIPT.contains("=>"));
        assert!(!COMPOSER_SURFACES_SCRIPT.contains("const "));
        assert!(!COMPOSER_SURFACES_SCRIPT.contains("let "));
        assert!(COMPOSER_SURFACES_SCRIPT.contains("(function () {"));
    }
}
