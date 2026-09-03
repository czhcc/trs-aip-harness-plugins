# TRS-AIP Harness 插件

本项目为 DeepSeek Harness 提供 TRS-AIP 扩展插件。除品牌展示与 MCP 客户端设置外，当前版本还提供可发现多个主题、互斥切换并恢复 Harness 原版界面的主题管理能力。

## 包说明

- `@trs-aip/dsh-client-branding`：可安装的 Bundle 和浏览器端 Client 插件，负责侧边栏品牌图标、侧边栏品牌名称、空白会话页 Hero 品牌图标与标题，以及浅色、深色主题令牌覆盖。
- `@trs-aip/dsh-mcp-settings`：双面插件，负责注册 `trs-aip-mcp` 设置命名空间、解析凭据引用、串行协调 MCP Client 实例，并贡献独立的“MCP 客户端”设置页面。
- `@trs-aip/dsh-theme-manager`：常驻的主题管理器，通过已安装包的 `skin.json` 自动发现主题，在设置页完成互斥切换，并提供“DeepSeek Harness 原版”选项。
- `@trs-aip/dsh-skin-china-police`：首个主题包，提供“中国警察”浅色/深色配色、卡通场景背景和可完整回收的浏览器展示层。

## 开发环境

插件面向 DeepSeek Harness `0.1.2-alpha.2`。由于这些预发布包可能尚未发布到当前 npm 仓库，开发依赖会链接到同级的 `../deepseek-harness` 源码目录；发布后的 peerDependencies 仍保留精确的运行时兼容版本。

目录结构应如下：

```text
plugins-test/
├─ deepseek-harness/
└─ trs-aip-harness-plugins/
```

请先安装并构建 DeepSeek Harness，确保各链接包已经生成 `lib/` 类型声明和运行时产物，然后在本项目中安装依赖并执行校验、类型检查和构建：

```sh
pnpm install
pnpm run validate
pnpm run typecheck
pnpm run build
```

## 安装到本地 Web 配置

首先构建 Client 插件：

```sh
pnpm run build
```

同级源码目录模式不会安装全局 `dsh` 命令。请进入 `../deepseek-harness`，使用该工程提供的 pnpm 脚本，并从该目录填写插件相对路径：

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/client-branding
pnpm dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/mcp-settings
pnpm dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/theme-manager
pnpm dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/skin-china-police
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

也可以停留在 `trs-aip-harness-plugins` 目录，通过 `--dir` 显式指定 Harness 工程：

```sh
pnpm --dir ../deepseek-harness dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/client-branding
pnpm --dir ../deepseek-harness dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/mcp-settings
pnpm --dir ../deepseek-harness dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/theme-manager
pnpm --dir ../deepseek-harness dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/skin-china-police
pnpm --dir ../deepseek-harness dsh --profile web --dump-config
pnpm --dir ../deepseek-harness dsh --profile web
```

使用 `file:` 安装时，每次重新构建后都需要再次执行 `dsh plugin ... add`，以便配置刷新复制到其中的插件包。正式发布时，可以发布 Client 包，也可以将已生成的 `lib/` 产物打包为 tarball 后交付。

本地开发更适合使用 `link:` 安装：

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add link:../trs-aip-harness-plugins/packages/client-branding
pnpm dsh plugin --profile web add link:../trs-aip-harness-plugins/packages/mcp-settings
pnpm dsh plugin --profile web add link:../trs-aip-harness-plugins/packages/theme-manager
pnpm dsh plugin --profile web add link:../trs-aip-harness-plugins/packages/skin-china-police
```

`link:` 会让 Web profile 中的包直接指向当前插件目录。首次安装后，修改源码只需重新执行 `pnpm run build` 并重启 Harness，不需要再次执行 `plugin add`。

## 风格主题

同时安装主题管理器与主题包后，在 Web“设置”中打开“风格主题”即可切换。当前提供“中国警察”和“DeepSeek Harness 原版”两个选项；原版选项只停用扩展主题，不会改变 `client-branding` 等独立品牌与 Logo 插件的启停状态。

主题管理器不硬编码“中国警察”：后续主题只需作为独立包导出合法 `skin.json`，即可出现在同一设置页。管理器只负责本地发现和切换，不包含版本识别、远端请求或更新检查。

“中国警察”背景素材位于 `packages/skin-china-police/assets/`，由 `docs/参考图/` 中的卡通民警图片作为配色与风格参考生成；构建时以内嵌资源打入浏览器 bundle，不依赖外部静态服务器。

## MCP 客户端设置

安装 `@trs-aip/dsh-mcp-settings` 后，在 Web“设置”中打开“MCP 客户端”页面即可维护配置。当前支持：

- 添加、编辑、启用、禁用和删除多个客户端；
- `stdio` 与 `streamable-http` 传输；
- 参数、工作目录、URL、普通环境变量/请求头和凭据引用；
- 工具调用超时、初始失败策略和自动重连参数；
- revision 冲突保护和非 loopback 页面只读保护。
- 每个实例的启动、重新启动、停止、激活失败状态，以及宿主已发现的工具数量；
- 引用凭据的配置状态查询、只写更新和删除，凭据值不会回显；
- 客户端复制、JSON 导入和导出（导出内容仅含凭据引用）；
- 启用 stdio 前的明确确认，切换为 stdio 或复制客户端时默认禁用。

设置文档只保存凭据引用。实际密钥仍应通过 Harness 的 Credentials 能力写入 `.credentials.yaml` 或由受支持的环境来源提供。例如页面中的 `GITHUB_TOKEN=GITHUB_TOKEN` 表示把环境变量 `GITHUB_TOKEN` 解析自同名 Harness 凭据引用，密钥值不会进入 `settings.yaml` 或浏览器状态。

保存成功仅代表配置已经持久化。状态徽标来自插件协调器的实例生命周期和宿主工具注册表：显示“实例已激活”不等同于底层 MCP 协议连接已建立，“已发现 N 个工具”表示对应命名空间中当前可见的工具数。当前 Harness MCP Client 没有暴露协议连接/重连回调，因此更底层的连接与自动重连细节仍应结合宿主日志判断。

## 品牌图形

`packages/client-branding/src/client/Brand.tsx` 内置了跟随当前主题颜色的 TRS-AIP SVG 标记：方形标记用于侧边栏和空白会话页 Hero 区域，完整的 `TRS-AIP` 字标用于展开状态的侧边栏。建议继续使用内联 SVG 或 data URL，以免动态加载的 Client 插件额外依赖公共静态资源路由。

空白会话页插槽只显示 Hero 标题旁约 34 像素的品牌标记。若要展示通栏 Hero 插图，需要在 DeepSeek Harness 中新增独立插槽，不属于本插件当前范围。

## 新建对话标题

插件会在 TRS-AIP Hero 品牌标记挂载时，通过 `conversation.hero.brand.mark` 的 DOM slot 锚点定位相邻的新建对话标题，并将其改为“驱动智能探索图谱”。当前版本的 DeepSeek Harness 尚未提供标题插槽或同名 locale 字典覆盖接口，因此该逻辑由品牌标记组件的生命周期管理：仅作用于 Hero 标题节点，不会改变其他国际化文本，并会在组件卸载时恢复原始内容。
