export function renderDevtoolsPage(tab: 'logs' | 'network'): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>DSH Desktop · Developer</title>
    <style>
      :root { color-scheme: dark; --bg:#121214; --line:#2c2c30; --text:#ececef; --muted:#8e8e93; --accent:#3d7dff; }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; }
      [data-tauri-drag-region] { height: 36px; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 12px; }
      nav { display: flex; gap: 8px; padding: 0 16px 12px; }
      nav a { color: var(--muted); text-decoration: none; padding: 6px 10px; border-radius: 999px; }
      nav a[aria-current="page"] { background: #1c1c1f; color: var(--text); }
      .bar { display: flex; gap: 8px; padding: 0 16px 12px; }
      input, select { background: #0e0e10; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
      input { flex: 1; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; font-variant-numeric: tabular-nums; }
      th { color: var(--muted); font-weight: 600; font-size: 11px; letter-spacing: .04em; }
      .error { color: #ff5c5c; }
      .warn { color: #ffb020; }
    </style>
  </head>
  <body>
    <div data-tauri-drag-region>Developer</div>
    <nav>
      <a href="/_dsh/dev/ui?tab=logs" data-devtools-tab="logs"${tab === 'logs' ? ' aria-current="page"' : ''}>日志</a>
      <a href="/_dsh/dev/ui?tab=network" data-devtools-tab="network"${tab === 'network' ? ' aria-current="page"' : ''}>网络</a>
    </nav>
    <div class="bar">
      <input id="q" placeholder="${tab === 'network' ? '过滤 URL / 状态' : '过滤来源 / 消息'}" />
      ${tab === 'network'
        ? '<select id="method"><option value="">全部方法</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>'
        : '<select id="level"><option value="">全部级别</option><option value="debug">debug+</option><option value="info">info+</option><option value="warn">warn+</option><option value="error">error</option></select>'}
    </div>
    <table>
      <thead id="head"></thead>
      <tbody id="body"></tbody>
    </table>
    <script>
      const tab = ${JSON.stringify(tab)};
      const head = document.getElementById('head');
      const body = document.getElementById('body');
      const q = document.getElementById('q');
      const extra = document.getElementById(tab === 'network' ? 'method' : 'level');
      head.innerHTML = tab === 'network'
        ? '<tr><th>时间</th><th>方法</th><th>状态</th><th>耗时</th><th>URL</th></tr>'
        : '<tr><th>时间</th><th>级别</th><th>来源</th><th>消息</th></tr>';
      async function refresh() {
        const params = new URLSearchParams();
        if (q.value) params.set('q', q.value);
        if (extra && extra.value) params.set(tab === 'network' ? 'method' : 'level', extra.value);
        const url = tab === 'network' ? '/_dsh/dev/network?' + params : '/_dsh/dev/logs?' + params;
        const data = await (await fetch(url)).json();
        body.innerHTML = (data.records || []).map((row) => {
          if (tab === 'network') {
            return '<tr><td>' + row.ts + '</td><td>' + row.method + '</td><td>' + (row.status ?? row.error ?? '') + '</td><td>' + (row.durationMs ?? '') + '</td><td>' + row.url + '</td></tr>';
          }
          const cls = row.level === 'error' ? 'error' : row.level === 'warn' ? 'warn' : '';
          return '<tr class="' + cls + '"><td>' + row.ts + '</td><td>' + row.level + '</td><td>' + row.source + '</td><td>' + row.message + '</td></tr>';
        }).join('');
      }
      q.addEventListener('input', () => { void refresh(); });
      extra.addEventListener('change', () => { void refresh(); });
      void refresh();
      setInterval(() => { void refresh(); }, 1500);
    </script>
  </body>
</html>`
}
