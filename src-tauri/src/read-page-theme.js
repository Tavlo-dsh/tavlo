// 只读 CSS 取色；不修改 DSH 的 DOM、偏好设置，也不向页面暴露 IPC。
(() => {
  try {
    if (!document.body) return null
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    // 让浏览器解释所有 CSS 颜色格式，并合成透明的 body / html 背景。
    for (const element of [document.documentElement, document.body]) {
      context.fillStyle = getComputedStyle(element).backgroundColor
      context.fillRect(0, 0, 1, 1)
    }
    const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data
    if (alpha >= 128) return [r, g, b]
    const scheme = getComputedStyle(document.documentElement).colorScheme
    if (scheme === 'dark') return [18, 18, 20]
    if (scheme === 'light') return [255, 255, 255]
    return null
  } catch {
    return null
  }
})()
