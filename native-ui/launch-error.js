// 失败信息由壳以 base64url(JSON) 放在 URL fragment 中，只做展示（textContent，不插入 HTML）。
function decode(hash) {
  try {
    const b64 = hash.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return {}
  }
}

const info = decode(location.hash.slice(1))
const text = (id, value) => {
  const el = document.getElementById(id)
  if (value) {
    el.textContent = String(value)
    el.hidden = false
  }
}
text('title', info.title)
text('detail', info.detail)
text('hint', info.hint)
text('output', info.output)

const meta = document.getElementById('meta')
for (const [label, value] of [
  ['dsh 版本', info.version],
  ['dsh 位置', info.launcher],
  ['退出码', info.exitCode],
  ['日志目录', info.logDir],
  ['运行模式', info.portable ? '便携版' : '安装版'],
]) {
  if (value === undefined || value === null || value === '') continue
  const dt = document.createElement('dt')
  dt.textContent = label
  const dd = document.createElement('dd')
  dd.textContent = String(value)
  meta.append(dt, dd)
}

const invoke = cmd => window.__TAURI_INTERNALS__?.invoke(cmd)
document.getElementById('restart').addEventListener('click', () => invoke('restart_dsh'))
document.getElementById('logs').addEventListener('click', () => invoke('open_log_dir'))
