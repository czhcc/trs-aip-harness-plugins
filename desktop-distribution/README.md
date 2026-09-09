# TRS AIP Desktop Distribution

此目录把当前 DeepSeek Harness Web Profile 与四个 TRS-AIP 插件封装为 Windows x64
Electron 应用。应用在 Electron 主进程内启动 Cordis/DSH generation，通过随机端口上的
loopback HTTP 服务加载 Web UI，并使用 DSH 的一次性启动 token 换取 HttpOnly 会话 Cookie。

桌面窗口启用 `contextIsolation`、sandbox、Web Security 并关闭 Node integration；渲染器不暴露
任何 Electron IPC。主导航仅允许当前本地 origin，外部 HTTP/HTTPS/mailto 链接交给系统浏览器。
关闭窗口只隐藏到托盘，托盘退出、重启和安装器升级都会先释放当前 DSH generation。

从插件工程根目录生成安装器与 ZIP：

```powershell
corepack pnpm run dist:win
```

仅生成免安装 ZIP：

```powershell
corepack pnpm run dist:win-portable
```

流水线依次同步固定版本 DSH tarball、构建并打包 TRS 插件、安装隔离的运行时闭包、生成
Electron 入口、执行发行前静态检查，最后调用固定版本的 Electron Builder。输出位于 `dist/`。
发行物不进行数字签名，Windows 因而可能显示“未知发布者”。
