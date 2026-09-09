# TRS-AIP Desktop Windows 安装包建设与打包方案

## 1. 目标

基于同级目录中的 DeepSeek Harness 源码和本仓库的 TRS-AIP 插件，生成一个可独立安装、无需用户额外安装 Node.js、pnpm 或 DeepSeek Harness 的 Windows x64 桌面应用。

目标安装包应包含：

- Electron 和内置 Node.js 运行时；
- 当前 `deepseek-harness/` 构建出的固定版本 DSH Host、Web UI 和插件系统；
- `@trs-aip/dsh-client-branding`；
- `@trs-aip/dsh-mcp-settings`；
- `@trs-aip/dsh-theme-manager`；
- `@trs-aip/dsh-skin-china-police`；
- 预配置的 TRS-AIP Desktop Profile；
- Windows 原生窗口、系统托盘、单实例、退出、恢复和安装升级能力；
- Electron Builder 与 NSIS 生成的 `Setup.exe`。

最终运行关系如下：

```text
TRS AIP Desktop.exe
  -> Electron main 进程
  -> 启动 DSH/Cordis Host
  -> 加载 TRS-AIP Desktop Profile
  -> 加载官方 Bundle 和 TRS-AIP Bundle
  -> 在 127.0.0.1 启动 HTTP/WebSocket Web Carrier
  -> BrowserWindow 完成认证并加载本地 Web UI
```

## 2. 修改边界

桌面发行功能必须在 `trs-aip-harness-plugins/` 内实现。

- `deepseek-harness/` 仅作为接口、类型、行为和构建产物来源，不得修改。
- `dsh-desktop/` 仅作为 Electron 宿主、Profile 组合、运行时闭包和 NSIS 配置的参考，不得修改。
- 新增桌面入口、运行时同步脚本、Profile 模板、Electron Builder 配置和安装器资源均放在 `trs-aip-harness-plugins/` 内。
- 构建 Harness 时可以执行其已有命令，但不得生成或提交针对 Harness 源码的修改。

建议新增独立发行目录：

```text
trs-aip-harness-plugins/
├─ packages/
│  ├─ client-branding/
│  ├─ mcp-settings/
│  ├─ theme-manager/
│  └─ skin-china-police/
└─ desktop-distribution/
   ├─ package.json
   ├─ src/
   │  ├─ main.ts
   │  ├─ preload.ts
   │  └─ ...
   ├─ resources/
   │  └─ profile/
   ├─ vendor/
   │  ├─ dsh-runtime/<version>/
   │  └─ trs-plugins/
   ├─ build/
   │  ├─ app-icon.png
   │  └─ installer.nsh
   └─ scripts/
      ├─ sync-dsh-runtime.mjs
      ├─ pack-trs-plugins.mjs
      └─ package-win.ts
```

## 3. 当前状态与前置问题

当前三个相关工程使用的 DSH 版本并不一致：

- `deepseek-harness/`：`0.1.2-alpha.4`；
- TRS-AIP 插件的 `peerDependencies`：`0.1.2-alpha.2`；
- 参考工程 `dsh-desktop/` 的内置运行时：`0.1.2-alpha.1`。

另外，当前 `trs-aip-harness-plugins/` 尚未包含 Electron、Electron Builder、NSIS、桌面主进程入口或运行时闭包检查，因此现在不能直接执行一条已有命令生成安装包。

直接在 `dsh-desktop/` 执行 `dist:win` 也不满足目标：它会使用自身固定的 alpha.1 DSH 运行时，并且不会自动发现相邻目录中的 TRS-AIP 插件。

## 4. 阶段一：统一版本

以当前本地 `deepseek-harness/` 为事实来源，将所有 TRS-AIP 插件的 DSH `peerDependencies` 对齐到 `0.1.2-alpha.4`，Cordis 对齐到 Harness 当前使用的 `4.0.2`。

示例：

```json
{
  "peerDependencies": {
    "@deepseek-ai/cordis": "4.0.2",
    "@deepseek-ai/dsh-client-ui-renderer": "0.1.2-alpha.4",
    "@deepseek-ai/dsh-client-ui-settings": "0.1.2-alpha.4"
  }
}
```

需要对四个插件逐一检查，而不是只机械修改版本字符串。重点确认：

- Host service 和 Cordis 生命周期 API；
- Client Loader 包装格式；
- Client slots 与 settings section；
- Settings Remote 和 Credentials Remote；
- MCP Client 配置与动态实例生命周期；
- Web UI 样式和主题扩展点。

完成版本适配后，再执行插件现有的校验、类型检查和构建。

## 5. 阶段二：生成固定版本 DSH 运行时

桌面安装包不应直接携带整个 Harness 源码仓库。应先使用 Harness 自带的发布命令，将当前 workspace 构建为发布 tarball。

在项目总目录下执行：

```powershell
cd D:\myprog\webstorm\dsh\plugins-test\deepseek-harness

corepack pnpm install --frozen-lockfile
corepack pnpm run build:official
corepack pnpm run release:pack --family dsh --out dist/npm
```

预期输出位于：

```text
deepseek-harness/dist/npm/
├─ publish-order.txt
├─ deepseek-ai-dsh-0.1.2-alpha.4.tgz
├─ deepseek-ai-dsh-base-0.1.2-alpha.4.tgz
├─ deepseek-ai-dsh-web-app-0.1.2-alpha.4.tgz
└─ ...
```

`desktop-distribution/scripts/sync-dsh-runtime.mjs` 应负责：

1. 读取 `publish-order.txt`；
2. 校验每个 tarball 的名称和版本；
3. 将 tarball 复制到 `desktop-distribution/vendor/dsh-runtime/0.1.2-alpha.4/`；
4. 计算并记录每个文件的 SHA-256；
5. 生成运行时 manifest；
6. 生成桌面发行包使用的依赖映射；
7. 拒绝 DSH 版本混装或缺失包。

桌面依赖必须指向这些本地 tarball，使安装包使用当前 Harness 的确定构建结果，而不是在打包时从 npm 获取一个可能不同的版本。

运行时安装不能只把 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-web-app` 声明为根依赖。Cordis Loader 会按照 patch 中的包名从自身所在目录动态导入插件；如果 pnpm 仅把这些包放在某个 Bundle 的嵌套 `node_modules` 中，Node.js 无法从 Loader 位置解析它们。运行时准备脚本必须从三个官方根包和四个 TRS-AIP 插件出发，递归收集本地 DSH `dependencies`、当前平台可用的 `optionalDependencies` 和非 optional 的 `peerDependencies`，并将所得闭包全部物化到运行时根级 `node_modules`。

运行时 manifest 应记录根级包闭包以及因操作系统或 CPU 不匹配而排除的包。构建前校验必须确认闭包中每个包都能从根级解析、名称和版本与 manifest 一致，并再次验证闭包内不存在遗漏的必需本地依赖。

闭包中的 DSH 包应直接通过 vendored `.tgz` 安装，不能把 `runtime/local-packages` 声明为 pnpm workspace 后依赖 workspace symlink 或 Windows Junction。进入 Electron Builder 前，整个 `runtime/` 必须是无符号链接、无目录联接的自包含物理文件树；否则 ASAR 在普通 Windows 用户权限下创建 unpacked 链接时会失败，并错误地要求构建机开启开发者模式。

pnpm 的构建脚本白名单必须与依赖的实际来源标识一致。对于 `@deepseek-ai/dsh-subprocess-local` 这类 vendored tarball，`allowBuilds` 应使用包含 `@file:../vendor/...tgz` 的完整依赖标识，并由准备脚本根据当前 DSH 版本和 tarball 文件名动态生成；仅配置包名无法匹配 pnpm 11 的本地 tarball build identity。

## 6. 阶段三：构建并打包 TRS-AIP 插件

在插件工程中执行：

```powershell
cd D:\myprog\webstorm\dsh\plugins-test\trs-aip-harness-plugins

corepack pnpm install --frozen-lockfile
corepack pnpm run validate
corepack pnpm run typecheck
corepack pnpm run build
```

然后将四个插件分别打成 tarball：

```powershell
corepack pnpm --filter @trs-aip/dsh-client-branding pack --pack-destination desktop-distribution/vendor/trs-plugins
corepack pnpm --filter @trs-aip/dsh-mcp-settings pack --pack-destination desktop-distribution/vendor/trs-plugins
corepack pnpm --filter @trs-aip/dsh-theme-manager pack --pack-destination desktop-distribution/vendor/trs-plugins
corepack pnpm --filter @trs-aip/dsh-skin-china-police pack --pack-destination desktop-distribution/vendor/trs-plugins
```

不能只复制插件源码。打包结果必须包含各插件声明的发布文件：

- `lib/index.js`；
- `lib/client.js`；
- Source Map 和必要的运行文件；
- `cordis.patch.yml`；
- `skin.json`；
- 主题图片等静态资源。

桌面发行工程应把四个插件 tarball 声明为生产依赖，确保 Electron Builder 将它们包含在最终应用中。

## 7. 阶段四：创建预装插件的 Desktop Profile

插件出现在应用的 `node_modules` 中并不表示 DSH 会自动加载它。插件还必须加入 Desktop Profile 的 `dsh.profile.bundles`。

建议提供如下 Profile 模板：

```json
{
  "name": "@trs-aip/desktop-profile",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-base": "0.1.2-alpha.4",
    "@deepseek-ai/dsh-web-app": "0.1.2-alpha.4",
    "@trs-aip/dsh-client-branding": "0.1.0",
    "@trs-aip/dsh-mcp-settings": "0.1.0",
    "@trs-aip/dsh-theme-manager": "0.1.0",
    "@trs-aip/dsh-skin-china-police": "0.1.0"
  },
  "dsh": {
    "profile": {
      "patchReload": "startup",
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@trs-aip/dsh-client-branding",
        "@trs-aip/dsh-mcp-settings",
        "@trs-aip/dsh-theme-manager",
        "@trs-aip/dsh-skin-china-police"
      ]
    }
  }
}
```

Bundle 顺序应保持为：

1. 官方基础 Bundle；
2. 官方 Web Bundle；
3. 品牌插件；
4. MCP 设置插件；
5. 主题管理器；
6. 具体主题包。

每个 TRS-AIP 包已经通过 `dsh.bundle.patch` 声明 Cordis patch，并通过 `dsh.client` 声明浏览器端 Client face。Profile 加载后：

- Host 端加载插件的 `lib/index.js`；
- Web Client 加载插件的 `lib/client.js`；
- `cordis.patch.yml` 插入对应 Cordis row；
- MCP 设置管理器运行在 Host；
- 品牌、主题管理器和皮肤运行在 BrowserWindow 内的 Web Client。

首次启动时，桌面入口应将 Profile 模板物化到用户的 DSH Home，而不是直接在安装目录内运行可写 Profile。典型位置为：

```text
%USERPROFILE%\.deepseek-harness\profiles\trs-desktop\
```

Profile 的 `dependencies` 只是依赖声明，不会让免安装版在用户目录中自动执行 `pnpm install`。桌面入口必须在每次启动时，把模板中的固定依赖从随包 `runtime/node_modules` 投影到该 Profile 的 `node_modules`。Windows 使用不要求开发者模式的目录联接（junction）；如果免安装目录被移动，则只替换旧联接并指向当前运行时。已有的用户实体目录不得被覆盖。否则 Bundle patch 虽然可以从安装锚点读取，但 patch 插入的裸包名 Cordis row 无法从 Profile 根解析，Host 和 Web Client 都不会装载对应插件。

桌面入口还必须同时设置 `DSH_HOME` 和 `DSH_PROFILE=trs-desktop`。`runProfile({ profile })` 选择了启动配置，但不会替依赖插件设置 `DSH_PROFILE`；主题管理器等 Host 插件需要该环境变量定位当前 Profile 的可写 patch。缺少它时会回退到 `web` Profile，导致主题发现和切换对桌面 Profile 无效。

Host 启动完成后还应读取 `ctx.clientModules.graph()`，确认品牌、MCP 设置和主题管理器这三个始终启用的 `@trs-aip` Client 模块都在浏览器启动图中；缺少任意基础模块都应让桌面启动失败并写入日志，不能以功能不完整的降级状态继续运行。中国警察皮肤属于主题管理器控制的可选 Client 模块：选择中国警察主题时应存在，选择“DeepSeek Harness 原版”时应从启动图中移除，不能将它作为无条件启动依赖。

Desktop Profile 必须使用 `patchReload: startup`。Electron 主进程不是通过带 `--expose-internals` 的 Node CLI 启动，不能挂载 Cordis HMR 的 live reload 后备服务，否则应用会在启动时以 `--expose-internals is required for HMR service` 失败。主题管理器将选择结果写入 Profile 与 Home 两层 `cordis.patch.yml` 后，桌面主进程应监控这两个文件、合并短时间内的重复事件，并自动执行有序重启；新 Host generation 随后从启动阶段加载新的 Client 模块图。这样切换“DeepSeek Harness 原版”可以真正卸载皮肤，同时不向 Electron 开放 Node 内部 API。

用户的设置、凭据、MCP 配置、会话和缓存都必须保存在用户目录，不得写入安装目录或 `app.asar`。

## 8. 阶段五：实现 Electron 宿主

桌面宿主建议采用与 DSH Desktop 相同的总体边界，但根据 Harness alpha.4 的实际 API 实现和验证：

```text
Electron main
  -> 读取或创建 trs-desktop Profile
  -> 组合官方 Bundle、TRS-AIP Bundle 和用户 patch
  -> 在 main 进程启动 DSH/Cordis Host
  -> WebServer 监听 127.0.0.1
  -> 使用 DSH Connection 完成 BrowserWindow 认证
  -> BrowserWindow.loadURL(localUrl)
  -> 管理窗口、托盘、重启、退出和子进程
```

至少需要实现以下能力：

- Electron 主入口；
- 单实例锁；
- DSH Home 和 Profile 选择；
- TRS-AIP Desktop Profile 初始化；
- Cordis/DSH `boot()` 调用；
- Host service 注册；
- 本地 WebServer 端口选择和冲突处理；
- DSH Connection token/Cookie 认证；
- BrowserWindow 创建与导航限制；
- Renderer Client Loader 健康检查；
- 系统托盘和关闭行为；
- Cordis generation 有序释放；
- 内置 pnpm 和 Electron RunAsNode；
- Windows 子进程树管理；
- ASAR 与物理 unpacked 路径转换；
- 启动失败恢复和诊断日志；
- NSIS 覆盖安装时的有序退出。

Windows 原生目录选择器的已构建实现通过 `process.execPath` 启动 `worker.cjs`。在 Electron 主进程中，`process.execPath` 是应用 EXE 而不是系统 `node.exe`；运行时准备阶段必须对随包 picker 的 worker `spawn` 环境应用桌面兼容补丁，只给该子进程注入 `ELECTRON_RUN_AS_NODE=1`，并保持 Electron Builder 的 `runAsNode` fuse 开启。不能把这个变量长期写进主进程环境，否则 Agent/MCP 命令也会继承它，并可能把它们启动的其他 Electron 程序误切换到 Node 模式。局部注入后，目录对话框 worker 使用安装包内的 Electron Node 运行时，不依赖用户安装 Node.js，也不会因单实例锁提前退出。

目录选择器从 `IFileDialog` 取得所选路径后，还不能使用 `koffi.view()` 创建指向 COM 字符串的外部 `ArrayBuffer`。Electron 的 Node 运行时禁止这种 external buffer，确认目录后会触发 N-API fatal error，使 worker 以退出码 `134` 终止且来不及发送结果。运行时兼容补丁应改用 `koffi.decode.string16(address)`，在调用 `CoTaskMemFree` 前直接解码 NUL 结尾的 UTF-16 指针；构建前检查必须拒绝仍包含不安全读取方式的 picker worker。

Profile、主题或桌面运行模式切换时，不应热修改存活的插件树。桌面主进程监控 Profile 与 Home patch，使用防抖把主题管理器的连续写入合并成一次完整重启。正确流程是：

```text
停止 Renderer 健康监控
  -> dispose 当前 Cordis Host generation
  -> 终止其拥有的子进程
  -> 释放 BrowserWindow、Tray 和事件监听器
  -> Electron relaunch
  -> 创建新 generation
```

## 9. BrowserWindow 安全边界

主窗口至少应使用：

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
}
```

安全要求：

- 不向网页暴露 Node.js；
- 不向网页暴露任意 Electron API；
- 不提供任意命令执行 IPC；
- 页面操作优先通过同源 DSH Remote/HTTP 路由进入 Host service；
- Desktop 私有路由必须经过 DSH Connection 鉴权；
- BrowserWindow 主页面只允许导航到当前本地 Web Carrier origin；
- 外部 HTTP、HTTPS 和 `mailto:` 链接交给系统浏览器；
- 如果确实需要 preload bridge，只暴露单一、可验证、最小权限的能力。

MCP `stdio` 命令运行在 Host 信任域。桌面化不能降低现有的显式确认、凭据引用、非 loopback 只读和日志脱敏要求。

## 10. 阶段六：Electron Builder 和 NSIS 配置

桌面发行包可以采用以下基础配置：

```json
{
  "main": "lib/main.js",
  "build": {
    "appId": "com.trs.aip.desktop",
    "productName": "TRS AIP Desktop",
    "asar": true,
    "asarUnpack": [
      "lib/**",
      "node_modules/**",
      "resources/**"
    ],
    "directories": {
      "output": "dist",
      "buildResources": "build"
    },
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "build/app-icon.png"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "artifactName": "TRS-AIP-Desktop-${version}-${arch}-Setup.${ext}"
    }
  }
}
```

以下内容通常必须位于 `app.asar.unpacked` 或其他真实物理路径：

- `node_modules` 中的原生模块；
- pnpm 执行入口；
- `node-pty`；
- Windows ACL runner；
- 需要作为子进程入口运行的 JavaScript；
- Profile module fallback 指向的包目录；
- 依赖真实文件路径的静态或 native 资源。

打包后应验证：

- `resources/app.asar` 存在；
- `resources/app.asar.unpacked` 中所需物理入口完整；
- `TRS AIP Desktop.exe` 是有效的 Windows PE 文件；
- NSIS 安装程序是有效 PE 文件；
- Profile fallback 不指向 Node 无法解析的虚拟 ASAR 路径；
- 所有 Host 和 Client 插件依赖形成闭合运行图。
- 运行时 manifest 中记录的每个根级包都存在于 `app.asar.unpacked/runtime/node_modules`；
- `runtime/` 中不存在符号链接或 Windows 目录联接，构建不依赖开发者模式或管理员创建链接权限；
- Portable ZIP 中包含完整的根级运行时依赖闭包，而不只是 `dsh/lib/bin.js`。

## 11. Windows 安装器升级行为

NSIS 安装器不应仅通过“安装目录中是否存在任意进程”判断应用正在运行。建议实现以下流程：

1. 精确检测 `TRS AIP Desktop.exe`；
2. 如果应用正在运行，使用专用参数（例如 `--trs-installer-quit`）启动第二实例；
3. 由 Electron 单实例事件将退出请求交给当前实例；
4. 当前实例有序释放 Cordis Host、BrowserWindow、Tray 和子进程；
5. 安装器等待进程退出；
6. 超时后提示用户，再执行限制在目标应用进程名内的强制关闭回退；
7. 应用完全退出后才覆盖安装文件。

## 12. 构建机外部依赖

构建环境依赖与最终用户的运行环境依赖需要分开管理。构建机需要完整的源码构建和安装包生成工具，最终安装包则应尽量携带 Electron、Node.js、DSH 和应用自身所需的运行时。

### 12.1 构建机必须安装的软件

| 程序或环境 | 建议版本 | 用途 |
|---|---|---|
| Windows x64 | Windows 10/11 x64 | Windows 安装包必须在原生 Windows x64 环境生成 |
| Node.js x64 | 推荐 Node 24.x | 执行 Harness、插件和 Electron 构建脚本 |
| Corepack | 与 Node.js 配套 | 管理项目固定版本的 pnpm 或 Yarn |
| pnpm | 11.7.0 | 构建当前 Harness 和 TRS-AIP 插件 |
| Git for Windows | 当前稳定版 | 读取 Harness Git commit、初始化子模块和生成 official Client 构建标识 |
| PowerShell 和 cmd | Windows 自带版本 | 执行打包、验证和 NSIS 辅助脚本 |

推荐在开始构建前检查：

```powershell
git --version
node --version
corepack --version
corepack pnpm --version
```

建议统一使用 Node.js 24 x64。不要仅依据 `engines` 中开放的上限选择未来主版本；桌面打包脚本应显式验证经过测试的 Node.js 主版本，避免 Corepack 行为或原生依赖安装方式发生变化。

### 12.2 由项目依赖提供的工具

以下工具应作为 `desktop-distribution` 的开发依赖安装，一般不需要操作者单独安装为系统软件：

- Electron；
- Electron Builder；
- TypeScript；
- tsdown；
- Vite；
- React 构建工具；
- ASAR 工具；
- NSIS；
- 7-Zip/app-builder 辅助程序。

可以先参考现有 Desktop 工程使用的 Electron `43.3.0` 和 Electron Builder `26.15.7`，但最终版本必须根据 Harness alpha.4、目标 Windows 版本和原生模块 ABI 验证后锁定。

Electron Builder 通常会自动下载 Electron、NSIS、app-builder 和相关 Windows 工具，因此通常不需要另外安装 NSIS IDE 或 7-Zip。构建脚本必须锁定版本并校验产物，不能依赖开发机上碰巧存在的全局安装。

### 12.3 包管理器选择

当前 Harness 和 TRS-AIP 插件均使用 pnpm `11.7.0`。如果新的 `desktop-distribution` 也统一使用 pnpm，则不需要 Yarn。

只有在直接移植 `dsh-desktop` 原有 Yarn workspace 和发布脚本时，才需要额外使用 Corepack 提供的 Yarn `4.18.0`：

```powershell
corepack yarn --version
```

新的 TRS-AIP Desktop 发行层建议统一使用 pnpm，减少双包管理器、双锁文件和依赖布局差异带来的维护成本。

### 12.4 网络和下载源

首次安装依赖和生成安装包通常需要访问：

- npm/pnpm 包仓库；
- Electron 二进制下载源；
- Electron Builder 使用的 NSIS、app-builder 和 winCodeSign 下载源；
- Git 仓库或子模块源；
- 需要重建原生模块时使用的 Electron native headers；
- 正式签名时使用的时间戳服务器。

企业网络环境需要提前确认代理、HTTPS 证书和相关下载站点可以访问。下载超时、TLS 中间证书不受信任或 GitHub 资源被拦截，都可能表现为依赖安装或 Electron Builder 打包失败。

如果要求完全离线构建，需要提前缓存或纳入内部制品库：

```text
Node.js 安装介质
pnpm/Corepack 所需文件
全部 JavaScript 依赖包
Electron Windows x64 二进制
Electron Builder 工具
NSIS 工具集
全部 DSH tarball
全部 TRS-AIP 插件 tarball
Windows x64 原生模块预编译文件
```

离线构建还应禁止依赖解析退回公共网络，并验证清空普通网络访问后仍能从缓存或内部制品库完成完整构建。

### 12.5 原生模块与 C++ 工具链

Harness 运行时包含或可能传递依赖以下原生、预编译或平台相关组件：

- `node-pty`；
- `sharp`；
- `koffi`；
- `@vscode/ripgrep`；
- Windows ACL/native process 组件。

如果所有组件都提供与 Windows x64、Node/Electron ABI 匹配的预编译文件，就不需要在普通打包机上安装 C++ 编译环境。推荐的发布流程应关闭 Electron Builder 的自动 native rebuild，并在打包前验证所需预编译文件是否完整，例如：

```text
--config.npmRebuild=false
```

这意味着发布流程不能在缺少预编译文件时静默退回本机编译，而应明确失败并报告缺失的包、平台、架构和 ABI。

只有在某个原生模块确实没有匹配的预编译产物、并且发行策略允许源码编译时，才需要额外安装：

- Visual Studio 2022 Build Tools；
- “使用 C++ 的桌面开发”工作负载；
- Windows 10/11 SDK；
- MSVC v143；
- Python 3，供 `node-gyp` 使用。

生产发行更适合固定并校验预编译二进制，以避免安装包结果依赖某台开发机的 MSVC、Windows SDK 或 Python 环境。

### 12.6 Authenticode 正式签名

生成未签名的 `Setup.exe` 不需要证书。正式发布还需要：

- 有效的 Authenticode 代码签名证书；
- PFX 文件与密码，或硬件令牌/云签名服务；
- Windows 签名工具或 Electron Builder 支持的签名服务；
- 可访问的可信时间戳服务器；
- 受控的密钥和发布凭据注入机制。

签名密钥、密码和服务 Token 不得写入仓库、普通配置文件、构建日志或生成的诊断包。未签名安装包仍可以生成和安装，但 Windows SmartScreen 可能显示“未知发布者”。

### 12.7 不属于基础构建依赖的软件

当前基础桌面发行方案不要求安装以下程序：

- Docker；
- Java/JDK；
- .NET SDK；
- Rust；
- Go；
- 独立安装的 NSIS IDE；
- 独立安装的 7-Zip。

只有后续新增的插件、MCP 服务或 native component 明确使用这些工具时，才应将其加入对应功能的依赖说明，不能把它们默认视为 Desktop 构建前提。

### 12.8 最终用户的条件性外部依赖

正常安装后的 TRS-AIP Desktop 应自带 Electron、Node.js、pnpm、DSH Host、Web UI 和预装插件。普通用户不需要安装构建机上的 Git、Visual Studio、Python 或 Electron Builder。

但用户配置的扩展功能仍可能调用外部程序：

- `stdio` MCP 的命令是 `python` 时，需要目标机器安装 Python；
- MCP 命令使用系统 `npx` 时，需要 Node.js/npm，除非桌面端明确提供受控的内置 Node/npm 入口；
- MCP 命令调用容器时，需要 Docker Desktop 或相应容器运行时；
- 调用 Codex、Claude Code 等外部 CLI 时，需要安装对应 CLI；
- 调用云模型或 HTTP MCP 时，需要网络连接和相应凭据。

因此，应用只能承诺内置组件免安装，不能承诺用户填写的任意 MCP `command` 都随安装包提供。需要做到完全免外部依赖的 MCP 服务，必须作为受审计的运行时资源随 Desktop 一起打包，并通过受控路径调用。

## 13. 建议的构建脚本

桌面发行层完成后，插件仓库根目录应提供统一命令：

```powershell
corepack pnpm run dist:win
```

该命令内部建议依次执行：

```text
检查 Windows x64 和 Node 版本
  -> 校验 Harness 与 TRS-AIP 插件版本一致
  -> 构建 Harness official Client profile
  -> pack DSH release family
  -> 构建并 pack 四个 TRS-AIP 插件
  -> 同步并校验 vendored runtime
  -> 构建 Electron main/client/preload
  -> 验证运行时依赖闭包
  -> electron-builder --win nsis --x64
  -> 验证安装器和应用 EXE
```

建议同时提供以下命令：

```json
{
  "scripts": {
    "desktop:sync-runtime": "...",
    "desktop:pack-plugins": "...",
    "desktop:build": "...",
    "desktop:check": "...",
    "dist:win": "...",
    "dist:win-portable": "..."
  }
}
```

其中：

- `desktop:build` 只生成 Electron 所需 JavaScript 和页面资源；
- `desktop:check` 执行版本、类型、插件图和运行时闭包检查；
- `dist:win` 生成 NSIS 安装程序；
- `dist:win-portable` 生成免安装 ZIP。

## 14. 预期产物

当前版本号假设为 `0.1.0`，预期输出为：

```text
trs-aip-harness-plugins/desktop-distribution/dist/
├─ TRS-AIP-Desktop-0.1.0-x64-Setup.exe
├─ TRS-AIP-Desktop-0.1.0-x64-Portable.zip
└─ win-unpacked/
   └─ TRS AIP Desktop.exe
```

`Setup.exe` 应提供安装目录选择、桌面快捷方式和开始菜单快捷方式。普通用户安装后不需要系统 Node.js、pnpm 或全局 `dsh` 命令。

默认构建可以生成未签名安装包，但正式发布必须增加独立的 Authenticode 签名步骤，否则 Windows SmartScreen 可能显示“未知发布者”。签名密钥不应写入仓库或普通构建配置，应由受控发布环境注入。

## 15. 验收清单

### 版本与依赖

- DSH Host、Web Client 和所有 DSH 包来自同一 Harness commit、同一版本和同一次 official 构建；
- 四个 TRS-AIP 插件的 peerDependencies 与打包运行时一致；
- Cordis Loader 动态加载的所有 Host 和 Client 包都可从运行时根级 `node_modules` 解析；
- Desktop Profile 的固定依赖通过可自愈目录联接解析到当前随包运行时，移动免安装目录后不会保留旧绝对路径；
- 安装包不依赖开发机的 workspace symlink；
- 安装包不从开发机绝对路径加载模块。

### 插件加载

- 品牌插件替换预期的官方品牌占位；
- MCP 设置页可以打开并持久化配置；
- MCP Host 协调器可以创建和释放实例；
- 主题管理器可以发现中国警察主题；
- 可以恢复 DeepSeek Harness 原版主题；
- Host 和 Client Loader 均没有未激活条目。
- `ctx.clientModules.graph()` 始终包含品牌、MCP 设置和主题管理器三个基础 Client 模块；中国警察皮肤是否存在与当前主题选择一致。

### 桌面生命周期

- 应用只能运行一个主实例；
- 窗口关闭、托盘退出和安装器退出都能有序释放 Host；
- WebServer 只监听预期地址；
- BrowserWindow 能完成认证，认证信息不会泄漏到外部 origin；
- Renderer 加载失败进入恢复或诊断流程；
- 应用重启不会残留 Host 或 MCP 子进程；
- Windows “选择工作区”可以启动随包 Node 模式的原生目录对话框 worker，不创建 Electron 禁止的 external buffer，并正确处理选择和取消；
- 主题切换后桌面自动有序重启并重组 Client 图，“中国警察”和“DeepSeek Harness 原版”可以互相切换。

### 安装包

- 全新安装成功；
- 同版本覆盖安装成功；
- 旧版本升级成功；
- 卸载成功；
- 安装目录可选择；
- 桌面和开始菜单快捷方式正确；
- 未安装 Node.js 的干净 Windows x64 环境可以启动；
- 最终签名版本通过 Authenticode 验证。

## 16. 最终结论

从当前工程生成 EXE 安装包，需要先在 `trs-aip-harness-plugins/` 内建设 Desktop 发行层。核心工作不是单纯调用 Electron Builder，而是同时解决：

1. DSH alpha.4 与 TRS-AIP 插件版本对齐；
2. 将当前 Harness 构建为可复现的本地 tarball 运行时；
3. 将 TRS-AIP 插件作为生产依赖和 Profile Bundle 预装；
4. 在 Electron main 中启动并管理 Cordis/DSH Host；
5. 使用经过认证的本地 Web Carrier 承载官方 Web UI；
6. 正确打包 native module、pnpm 和物理运行时入口；
7. 通过 Electron Builder 和 NSIS 生成、验证并最终签名 Windows 安装包。

在这些发行能力实现前，文档中的 `dist:win` 是目标命令，不是当前仓库已经存在并可直接执行的命令。
