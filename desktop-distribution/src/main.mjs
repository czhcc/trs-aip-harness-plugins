import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} from 'electron'

const PRODUCT_NAME = 'TRS AIP Desktop'
const PROFILE_NAME = 'trs-desktop'
const INSTALLER_QUIT_FLAG = '--trs-installer-quit'
const STARTUP_TIMEOUT_MS = 90_000
const STARTUP_WINDOW_READY_TIMEOUT_MS = 2_000
const PROFILE_RESTART_DELAY_MS = 500
const AUTH_TOKEN_PATTERN = /([?&]token=)[A-Za-z0-9_-]+/gu
const REQUIRED_CORE_CLIENT_MODULES = [
  '@trs-aip/dsh-client-branding',
  '@trs-aip/dsh-mcp-settings',
  '@trs-aip/dsh-theme-manager',
  '@trs-aip/dsh-knowledge-rag',
]
const MANAGED_THEME_CLIENT_MODULES = [
  '@trs-aip/dsh-skin-china-police',
]

let mainWindow
let startupWindow
let tray
let hostGeneration
let quitting = false
let shutdownPromise
let profilePatchWatchers = []
let profileRestartTimer

function desktopRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

function runtimeRoot() {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'runtime')
    : join(desktopRoot(), 'runtime')
}

function appResource(...parts) {
  return join(app.getAppPath(), ...parts)
}

function redact(value) {
  return String(value).replace(AUTH_TOKEN_PATTERN, '$1<redacted>')
}

function log(message) {
  const line = `${new Date().toISOString()} ${redact(message)}\n`
  try {
    const logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logDir, { recursive: true })
    appendFileSync(join(logDir, 'desktop.log'), line, 'utf8')
  } catch {
    // Logging must never turn a recoverable desktop failure into a crash.
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function profileDirectory() {
  return join(app.getPath('home'), '.deepseek-harness', 'profiles', PROFILE_NAME)
}

function packageDirectory(root, packageName) {
  return join(root, 'node_modules', ...packageName.split('/'))
}

function sameRealPath(left, right) {
  try {
    const actualLeft = realpathSync.native(left)
    const actualRight = realpathSync.native(right)
    return process.platform === 'win32'
      ? actualLeft.toLowerCase() === actualRight.toLowerCase()
      : actualLeft === actualRight
  } catch {
    return false
  }
}

function projectRuntimePackage(profileDir, packageName, expectedVersion) {
  const target = packageDirectory(runtimeRoot(), packageName)
  const runtimePackage = readJson(join(target, 'package.json'))
  if (runtimePackage.name !== packageName || runtimePackage.version !== expectedVersion) {
    throw new Error(
      `desktop runtime package ${packageName} has unexpected identity `
      + `${String(runtimePackage.name)}@${String(runtimePackage.version)}; expected ${packageName}@${expectedVersion}`,
    )
  }

  const projection = packageDirectory(profileDir, packageName)
  mkdirSync(dirname(projection), { recursive: true })
  let existing
  try {
    existing = lstatSync(projection)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
      const installed = readJson(join(projection, 'package.json'))
      if (installed.name === packageName && installed.version === expectedVersion) return
      throw new Error(
        `desktop profile package ${projection} is not managed by TRS AIP Desktop and has identity `
        + `${String(installed.name)}@${String(installed.version)}; expected ${packageName}@${expectedVersion}`,
      )
    }
    if (sameRealPath(projection, target)) return
    // Remove only the stale reparse point. User-owned physical directories are preserved above.
    unlinkSync(projection)
  }

  try {
    symlinkSync(target, projection, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    // Two desktop instances can race before Electron's single-instance handoff completes.
    if (error?.code !== 'EEXIST' || !sameRealPath(projection, target)) throw error
  }
}

function projectProfileRuntime(profileDir, dependencies) {
  for (const [packageName, version] of Object.entries(dependencies)) {
    if (typeof version !== 'string') throw new Error(`desktop profile dependency ${packageName} has no version`)
    projectRuntimePackage(profileDir, packageName, version)
  }
}

function materializeProfile() {
  const profileDir = profileDirectory()
  const templateDir = appResource('resources', 'profile')
  const runtimeManifest = readJson(join(runtimeRoot(), 'runtime-manifest.json'))
  const versions = runtimeManifest.versions
  if (typeof versions?.dsh !== 'string') throw new Error('desktop runtime manifest has no DSH version')

  const replacements = new Map([
    ['__DSH_VERSION__', versions.dsh],
    ['__BRANDING_VERSION__', versions['@trs-aip/dsh-client-branding']],
    ['__MCP_VERSION__', versions['@trs-aip/dsh-mcp-settings']],
    ['__THEME_VERSION__', versions['@trs-aip/dsh-theme-manager']],
    ['__SKIN_VERSION__', versions['@trs-aip/dsh-skin-china-police']],
    ['__RAG_VERSION__', versions['@trs-aip/dsh-knowledge-rag']],
  ])
  let templateText = readFileSync(join(templateDir, 'package.json'), 'utf8')
  for (const [placeholder, version] of replacements) {
    if (typeof version !== 'string') throw new Error(`desktop runtime manifest has no version for ${placeholder}`)
    templateText = templateText.replaceAll(placeholder, version)
  }
  const template = JSON.parse(templateText)

  mkdirSync(profileDir, { recursive: true })
  const manifestPath = join(profileDir, 'package.json')
  const current = existsSync(manifestPath) ? readJson(manifestPath) : {}
  const requiredBundles = template.dsh.profile.bundles
  const additionalBundles = Array.isArray(current.dsh?.profile?.bundles)
    ? current.dsh.profile.bundles.filter(name => typeof name === 'string' && !requiredBundles.includes(name))
    : []
  current.name = template.name
  current.private = true
  current.dependencies = { ...(current.dependencies ?? {}), ...template.dependencies }
  current.dsh = {
    ...(current.dsh ?? {}),
    profile: {
      ...(current.dsh?.profile ?? {}),
      patchReload: 'startup',
      bundles: [...requiredBundles, ...additionalBundles],
    },
  }
  writeJson(manifestPath, current)

  for (const filename of ['cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
    const destination = join(profileDir, filename)
    if (!existsSync(destination)) {
      writeFileSync(destination, readFileSync(join(templateDir, filename)))
    }
  }
  // The packaged profile is intentionally never installed with pnpm. Project its fixed
  // dependencies into the writable profile so bare Cordis rows resolve from the exact
  // runtime carried by this EXE. Windows junctions do not require Developer Mode and are
  // reconciled on every launch, so moving an extracted portable directory self-heals.
  projectProfileRuntime(profileDir, template.dependencies)
  return profileDir
}

function packageEntry(packageName) {
  const packageDir = join(runtimeRoot(), 'node_modules', ...packageName.split('/'))
  const manifest = readJson(join(packageDir, 'package.json'))
  const exported = manifest.exports?.['.']
  const relativeEntry = typeof exported === 'string'
    ? exported
    : exported?.default ?? manifest.main
  if (typeof relativeEntry !== 'string') throw new Error(`${packageName} has no runtime entry`)
  return join(packageDir, relativeEntry)
}

async function loadProfileRunner() {
  const dshDir = join(runtimeRoot(), 'node_modules', '@deepseek-ai', 'dsh')
  const bin = readFileSync(join(dshDir, 'lib', 'bin.js'), 'utf8')
  const chunkMatch = /["']\.\/(profile-boot-[^"']+\.js)["']/u.exec(bin)
  const candidates = chunkMatch === null
    ? readdirSync(join(dshDir, 'lib')).filter(name => /^profile-boot-.+\.js$/u.test(name))
    : [chunkMatch[1]]
  for (const candidate of candidates) {
    const module = await import(pathToFileURL(join(dshDir, 'lib', candidate)).href)
    if (typeof module.runProfile === 'function') return module.runProfile
  }
  throw new Error('the bundled @deepseek-ai/dsh package exposes no profile runner')
}

async function withTimeout(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${STARTUP_TIMEOUT_MS / 1000} seconds`)), STARTUP_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function bootHarness() {
  const profileDir = materializeProfile()
  const home = resolve(profileDir, '..', '..')
  process.env.DSH_HOME = home
  process.env.DSH_PROFILE = PROFILE_NAME
  process.env.DSH_TELEMETRY_DISABLED ??= '1'

  const [{ loadLayeredEnv }, runProfile] = await Promise.all([
    import(pathToFileURL(packageEntry('@deepseek-ai/dsh-app-boot')).href),
    loadProfileRunner(),
  ])
  const generation = await withTimeout(runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: PROFILE_NAME,
    patchFiles: [],
    args: ['--host', '127.0.0.1', '--port', '0', '--no-open'],
  }), 'DSH profile startup')
  const clientModules = generation.ctx.get('clientModules')
  const clientGraph = clientModules?.graph()
  const clientIds = new Set(clientGraph?.entries.map(entry => entry.id) ?? [])
  const missingClientModules = REQUIRED_CORE_CLIENT_MODULES.filter(packageName => !clientIds.has(packageName))
  if (missingClientModules.length > 0) {
    await generation.shutdown.shutdown(1)
    throw new Error(`desktop client graph is missing required modules: ${missingClientModules.join(', ')}`)
  }
  const activeThemeClientModules = MANAGED_THEME_CLIENT_MODULES.filter(packageName => clientIds.has(packageName))
  log(
    `verified TRS AIP core client modules: ${REQUIRED_CORE_CLIENT_MODULES.join(', ')}; `
    + `active theme modules: ${activeThemeClientModules.join(', ') || '(DeepSeek Harness original)'}`,
  )
  const webServer = generation.ctx.get('webServer')
  const connection = generation.ctx.get('connection')
  if (webServer === undefined || connection === undefined) {
    await generation.shutdown.shutdown(1)
    throw new Error('the desktop profile did not provide its Web server and authenticated connection')
  }
  const cleanUrl = `http://127.0.0.1:${String(webServer.port)}/`
  return {
    ...generation,
    profileDir,
    cleanUrl,
    authenticatedUrl: connection.authenticatedUrl(cleanUrl),
  }
}

function windowIcon() {
  const path = app.isPackaged ? join(process.resourcesPath, 'app-icon.png') : appResource('build', 'app-icon.png')
  const icon = nativeImage.createFromPath(path)
  return icon.isEmpty() ? undefined : icon
}

function waitForStartupWindowFirstPaint(window) {
  return new Promise(resolve => {
    let timer
    const finish = painted => {
      window.removeListener('ready-to-show', onReady)
      if (timer !== undefined) clearTimeout(timer)
      resolve(painted)
    }
    const onReady = () => finish(true)
    window.once('ready-to-show', onReady)
    timer = setTimeout(() => finish(false), STARTUP_WINDOW_READY_TIMEOUT_MS)
  })
}

async function createStartupWindow() {
  const window = new BrowserWindow({
    title: `${PRODUCT_NAME} 正在启动`,
    width: 460,
    height: 300,
    center: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f7fa',
    icon: windowIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'trs-aip-desktop-startup',
    },
  })
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('closed', () => {
    if (startupWindow === window) startupWindow = undefined
  })
  const firstPaint = waitForStartupWindowFirstPaint(window)
  try {
    await window.loadFile(appResource('resources', 'splash.html'))
    const painted = await firstPaint
    if (!painted) log('startup window first paint timed out; showing the loaded page as a fallback')
    if (!window.isDestroyed() && !quitting) {
      window.show()
      // Give Electron's native window/compositor one turn before Host startup begins
      // synchronous profile discovery and module initialization on the main thread.
      await new Promise(resolve => setImmediate(resolve))
    }
    return window
  } catch (cause) {
    if (!window.isDestroyed()) window.destroy()
    log(`startup window failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    return undefined
  }
}

function destroyStartupWindow() {
  if (startupWindow !== undefined && !startupWindow.isDestroyed()) startupWindow.destroy()
  startupWindow = undefined
}

function allowOnlyApplicationOrigin(window, origin) {
  const rejectForeignNavigation = (event, url) => {
    try {
      if (new URL(url).origin !== origin) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  }
  window.webContents.on('will-navigate', rejectForeignNavigation)
  window.webContents.on('will-redirect', rejectForeignNavigation)
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (['https:', 'http:', 'mailto:'].includes(target.protocol)) void shell.openExternal(target.href)
    } catch {
      // Malformed and non-Web targets are denied.
    }
    return { action: 'deny' }
  })
  session.fromPartition('persist:trs-aip-desktop').setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

async function createMainWindow(generation) {
  const origin = new URL(generation.cleanUrl).origin
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f7fa',
    icon: windowIcon(),
    webPreferences: {
      preload: appResource('lib', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:trs-aip-desktop',
    },
  })
  allowOnlyApplicationOrigin(window, origin)
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(PRODUCT_NAME)
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  const readyToShow = new Promise(resolve => window.once('ready-to-show', resolve))
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`renderer exited: ${details.reason}, code ${String(details.exitCode)}`)
  })
  try {
    const authenticated = await window.webContents.session.fetch(generation.authenticatedUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    })
    if (authenticated.status !== 200) {
      throw new Error(`browser authentication failed with HTTP ${String(authenticated.status)}`)
    }
    await authenticated.body?.cancel()
    await window.loadURL(generation.cleanUrl)
    await withTimeout(readyToShow, 'desktop renderer first paint')
  } catch (cause) {
    window.destroy()
    throw cause
  }
  return window
}

function buildTray() {
  const icon = windowIcon()
  if (icon === undefined) return undefined
  const instance = new Tray(icon.resize({ width: 20, height: 20 }))
  instance.setToolTip(PRODUCT_NAME)
  instance.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 TRS AIP Desktop', click: () => showMainWindow() },
    { label: '重新启动', click: () => void restartApplication() },
    { type: 'separator' },
    { label: '退出', click: () => requestQuit() },
  ]))
  instance.on('click', () => showMainWindow())
  return instance
}

function showMainWindow() {
  const window = mainWindow !== undefined && !mainWindow.isDestroyed()
    ? mainWindow
    : startupWindow
  if (window === undefined || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function stopProfilePatchWatchers() {
  if (profileRestartTimer !== undefined) {
    clearTimeout(profileRestartTimer)
    profileRestartTimer = undefined
  }
  for (const { filename, listener } of profilePatchWatchers) unwatchFile(filename, listener)
  profilePatchWatchers = []
}

function watchProfilePatches(profileDir) {
  stopProfilePatchWatchers()
  const home = resolve(profileDir, '..', '..')
  const filenames = [
    join(profileDir, 'cordis.patch.yml'),
    join(home, 'cordis.patch.yml'),
  ]
  for (const filename of filenames) {
    const listener = (current, previous) => {
      if (quitting || (current.mtimeMs === previous.mtimeMs && current.size === previous.size)) return
      if (profileRestartTimer !== undefined) clearTimeout(profileRestartTimer)
      profileRestartTimer = setTimeout(() => {
        profileRestartTimer = undefined
        if (quitting) return
        log(`profile patch changed; relaunching: ${filename}`)
        void restartApplication()
      }, PROFILE_RESTART_DELAY_MS)
    }
    watchFile(filename, { interval: 250, persistent: false }, listener)
    profilePatchWatchers.push({ filename, listener })
  }
}

async function shutdownHost() {
  if (shutdownPromise !== undefined) return shutdownPromise
  shutdownPromise = (async () => {
    stopProfilePatchWatchers()
    tray?.destroy()
    tray = undefined
    destroyStartupWindow()
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.destroy()
    mainWindow = undefined
    if (hostGeneration !== undefined) {
      const generation = hostGeneration
      hostGeneration = undefined
      await generation.shutdown.shutdown(0)
    }
  })()
  return shutdownPromise
}

function requestQuit() {
  quitting = true
  app.quit()
}

async function restartApplication() {
  if (quitting) return
  quitting = true
  await shutdownHost()
  app.relaunch()
  app.exit(0)
}

async function startApplication() {
  app.setAppUserModelId('com.trs.aip.desktop')
  await app.whenReady()
  startupWindow = await createStartupWindow()
  hostGeneration = await bootHarness()
  watchProfilePatches(hostGeneration.profileDir)
  mainWindow = await createMainWindow(hostGeneration)
  tray = buildTray()
  mainWindow.show()
  destroyStartupWindow()
  log(`started ${PRODUCT_NAME} with profile ${hostGeneration.profileDir}`)
}

const installerQuitRequested = process.argv.includes(INSTALLER_QUIT_FLAG)
const acquiredLock = app.requestSingleInstanceLock()
if (!acquiredLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes(INSTALLER_QUIT_FLAG)) requestQuit()
    else showMainWindow()
  })
  app.on('activate', () => showMainWindow())
  app.on('window-all-closed', () => {
    // The system tray owns the application lifetime.
  })
  app.on('before-quit', (event) => {
    if (shutdownPromise !== undefined) return
    event.preventDefault()
    quitting = true
    void shutdownHost().then(() => app.exit(0), cause => {
      log(`shutdown failed: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
      app.exit(1)
    })
  })

  if (installerQuitRequested) {
    quitting = true
    app.quit()
  } else {
    startApplication().catch(async (cause) => {
      const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
      log(`startup failed: ${message}`)
      await app.whenReady()
      quitting = true
      try {
        await shutdownHost()
      } catch (shutdownCause) {
        log(`startup cleanup failed: ${shutdownCause instanceof Error ? shutdownCause.stack ?? shutdownCause.message : String(shutdownCause)}`)
      }
      const result = await dialog.showMessageBox({
        type: 'error',
        title: `${PRODUCT_NAME} 启动失败`,
        message: '无法启动本地 DeepSeek Harness 服务。',
        detail: `${redact(message)}\n\n日志：${join(app.getPath('userData'), 'logs', 'desktop.log')}`,
        buttons: ['重试', '退出'],
        defaultId: 0,
        cancelId: 1,
      })
      if (result.response === 0) {
        app.relaunch()
      }
      app.exit(1)
    })
  }
}
