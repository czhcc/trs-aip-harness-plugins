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

Profile 或桌面模式切换时，不应热修改存活的插件树。正确流程是：

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

## 11. Windows 安装器升级行为

NSIS 安装器不应仅通过“安装目录中是否存在任意进程”判断应用正在运行。建议实现以下流程：

1. 精确检测 `TRS AIP Desktop.exe`；
2. 如果应用正在运行，使用专用参数（例如 `--trs-installer-quit`）启动第二实例；
3. 由 Electron 单实例事件将退出请求交给当前实例；
4. 当前实例有序释放 Cordis Host、BrowserWindow、Tray 和子进程；
5. 安装器等待进程退出；
6. 超时后提示用户，再执行限制在目标应用进程名内的强制关闭回退；
7. 应用完全退出后才覆盖安装文件。

## 12. 建议的构建脚本

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

## 13. 预期产物

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

## 14. 验收清单

### 版本与依赖

- DSH Host、Web Client 和所有 DSH 包来自同一 Harness commit、同一版本和同一次 official 构建；
- 四个 TRS-AIP 插件的 peerDependencies 与打包运行时一致；
- 安装包不依赖开发机的 workspace symlink；
- 安装包不从开发机绝对路径加载模块。

### 插件加载

- 品牌插件替换预期的官方品牌占位；
- MCP 设置页可以打开并持久化配置；
- MCP Host 协调器可以创建和释放实例；
- 主题管理器可以发现中国警察主题；
- 可以恢复 DeepSeek Harness 原版主题；
- Host 和 Client Loader 均没有未激活条目。

### 桌面生命周期

- 应用只能运行一个主实例；
- 窗口关闭、托盘退出和安装器退出都能有序释放 Host；
- WebServer 只监听预期地址；
- BrowserWindow 能完成认证，认证信息不会泄漏到外部 origin；
- Renderer 加载失败进入恢复或诊断流程；
- 应用重启不会残留 Host 或 MCP 子进程。

### 安装包

- 全新安装成功；
- 同版本覆盖安装成功；
- 旧版本升级成功；
- 卸载成功；
- 安装目录可选择；
- 桌面和开始菜单快捷方式正确；
- 未安装 Node.js 的干净 Windows x64 环境可以启动；
- 最终签名版本通过 Authenticode 验证。

## 15. 最终结论

从当前工程生成 EXE 安装包，需要先在 `trs-aip-harness-plugins/` 内建设 Desktop 发行层。核心工作不是单纯调用 Electron Builder，而是同时解决：

1. DSH alpha.4 与 TRS-AIP 插件版本对齐；
2. 将当前 Harness 构建为可复现的本地 tarball 运行时；
3. 将 TRS-AIP 插件作为生产依赖和 Profile Bundle 预装；
4. 在 Electron main 中启动并管理 Cordis/DSH Host；
5. 使用经过认证的本地 Web Carrier 承载官方 Web UI；
6. 正确打包 native module、pnpm 和物理运行时入口；
7. 通过 Electron Builder 和 NSIS 生成、验证并最终签名 Windows 安装包。

在这些发行能力实现前，文档中的 `dist:win` 是目标命令，不是当前仓库已经存在并可直接执行的命令。
