// Windows 打包：NSIS 安装版（setup.exe）+ 便携版（zip：exe + portable 标记）。
//
//   node scripts/package-windows.mjs                 # x64（Intel / AMD 通用）
//   node scripts/package-windows.mjs --arch arm64    # Windows on ARM
//   node scripts/package-windows.mjs --arch x64,arm64
//
// 产物输出到 dist/windows/。DSH 不打进包：运行时使用用户环境中的 dsh。
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }

if (process.platform !== 'win32') {
  console.error('package-windows: 请在 Windows 上运行（NSIS 打包与 MSVC 工具链）')
  process.exit(1)
}

const archArg = (() => {
  const index = process.argv.indexOf('--arch')
  return index >= 0 ? process.argv[index + 1] : 'x64'
})()
const arches = archArg.split(',').map(arch => arch.trim()).filter(Boolean)
for (const arch of arches) {
  if (!TARGETS[arch]) {
    console.error(`package-windows: 不支持的架构 ${arch}（可选：${Object.keys(TARGETS).join(', ')}）`)
    process.exit(1)
  }
}

const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const version = conf.version
const productName = conf.productName
const fileStem = productName.replace(/\s+/g, '-')
// cargo 产出的可执行文件名 = Cargo.toml [package] name。
const binName = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^name\s*=\s*"([^"]+)"/m)[1]
const outDir = join(root, 'dist/windows')
mkdirSync(outDir, { recursive: true })

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, cwd: root, ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function ensureRustTarget(triple) {
  const result = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8', shell: true })
  if (result.status === 0 && !result.stdout.split(/\r?\n/).includes(triple)) {
    console.error(`package-windows: 缺少 Rust 目标 ${triple}，请先执行：rustup target add ${triple}`)
    if (triple.startsWith('aarch64')) console.error('  ARM64 还需要 Visual Studio Build Tools 的「MSVC ARM64 生成工具」组件。')
    process.exit(1)
  }
}

const tauriBin = join(root, 'node_modules/.bin/tauri.cmd')
const env = { ...process.env, DSH_PROFILE: 'production', DSH_DEV_TOOLS: '0' }

for (const arch of arches) {
  const triple = TARGETS[arch]
  ensureRustTarget(triple)
  console.log(`\n=== ${productName} ${version} · ${arch} (${triple}) ===`)
  run(existsSync(tauriBin) ? `"${tauriBin}"` : 'npx tauri', ['build', '--target', triple], { env })

  const releaseDir = join(root, 'src-tauri/target', triple, 'release')
  const nsisDir = join(releaseDir, 'bundle/nsis')
  // 按准确文件名取：bundle/nsis/ 会残留改名前或旧版本的安装包，不能靠模糊匹配。
  const setup = `${productName}_${version}_${arch}-setup.exe`
  if (!existsSync(join(nsisDir, setup))) {
    console.error(`package-windows: 在 ${nsisDir} 没找到 ${setup}（现有：${readdirSync(nsisDir).join(', ')}）`)
    process.exit(1)
  }
  const setupOut = join(outDir, `${fileStem}_${version}_${arch}-setup.exe`)
  copyFileSync(join(nsisDir, setup), setupOut)

  // 便携版：exe + portable 标记；数据写在 exe 旁的 data/。
  const portableName = `${fileStem}_${version}_${arch}_portable`
  const staging = join(outDir, portableName)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  copyFileSync(join(releaseDir, `${binName}.exe`), join(staging, `${productName}.exe`))
  writeFileSync(join(staging, 'portable'), '此文件存在时以便携模式运行：WebView 数据与日志写到同目录 data\。\r\n')
  writeFileSync(
    join(staging, 'README.txt'),
    [
      `${productName} ${version}（便携版，${arch}）`,
      '',
      '运行前提：',
      '  1. 已安装 Node.js >= 24.9',
      '  2. 已安装 DSH：npm i -g @deepseek-ai/dsh（或设置环境变量 DSH_BIN 指向 dsh）',
      '  3. 系统已有 Microsoft Edge WebView2 Runtime（Windows 10/11 通常自带）',
      '',
      '应用数据（WebView 缓存、日志）写在本目录的 data\ 下；DSH 自身的配置与会话仍在 %USERPROFILE%\.dsh。',
      '',
    ].join('\r\n'),
  )
  const zipOut = join(outDir, `${portableName}.zip`)
  rmSync(zipOut, { force: true })
  run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${staging}\*' -DestinationPath '${zipOut}'`])
  rmSync(staging, { recursive: true, force: true })

  console.log(`\n安装版：${setupOut}\n便携版：${zipOut}`)
}
