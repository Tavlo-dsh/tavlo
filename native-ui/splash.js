// 壳通过 window.dshSplash.status(text) 推送启动进度。
window.dshSplash = {
  status(text) {
    const el = document.getElementById('status')
    if (el && typeof text === 'string' && text) el.textContent = text
  },
}
