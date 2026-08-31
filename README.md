# TRS-AIP Harness 插件

本项目为 DeepSeek Harness 提供 TRS-AIP 白标客户端插件。当前插件会替换系统内置的三个品牌展示插槽，将新建对话输入框上方的标题替换为“驱动智能探索图谱”，添加由部署方维护的主题令牌覆盖层，并通过随包提供的 Bundle 补丁自动安装到 Web 配置中。

## 包说明

- `@trs-aip/dsh-client-branding`：可安装的 Bundle 和浏览器端 Client 插件，负责侧边栏品牌图标、侧边栏品牌名称、空白会话页 Hero 品牌图标与标题，以及浅色、深色主题令牌覆盖。

## 开发环境

插件面向 DeepSeek Harness `0.1.2-alpha.1`。由于这些预发布 Client 包可能尚未发布到当前 npm 仓库，开发依赖会链接到同级的 `../deepseek-harness` 源码目录；发布后的 peerDependencies 仍保留精确的运行时兼容版本。

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
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

也可以停留在 `trs-aip-harness-plugins` 目录，通过 `--dir` 显式指定 Harness 工程：

```sh
pnpm --dir ../deepseek-harness dsh plugin --profile web add file:../trs-aip-harness-plugins/packages/client-branding
pnpm --dir ../deepseek-harness dsh --profile web --dump-config
pnpm --dir ../deepseek-harness dsh --profile web
```

使用 `file:` 安装时，每次重新构建后都需要再次执行 `dsh plugin ... add`，以便配置刷新复制到其中的插件包。正式发布时，可以发布 Client 包，也可以将已生成的 `lib/` 产物打包为 tarball 后交付。

本地开发更适合使用 `link:` 安装：

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add link:../trs-aip-harness-plugins/packages/client-branding
```

`link:` 会让 Web profile 中的包直接指向当前插件目录。首次安装后，修改源码只需重新执行 `pnpm run build` 并重启 Harness，不需要再次执行 `plugin add`。

## 品牌图形

`packages/client-branding/src/client/Brand.tsx` 内置了跟随当前主题颜色的 TRS-AIP SVG 标记：方形标记用于侧边栏和空白会话页 Hero 区域，完整的 `TRS-AIP` 字标用于展开状态的侧边栏。建议继续使用内联 SVG 或 data URL，以免动态加载的 Client 插件额外依赖公共静态资源路由。

空白会话页插槽只显示 Hero 标题旁约 34 像素的品牌标记。若要展示通栏 Hero 插图，需要在 DeepSeek Harness 中新增独立插槽，不属于本插件当前范围。

## 新建对话标题

插件会在 TRS-AIP Hero 品牌标记挂载时，通过 `conversation.hero.brand.mark` 的 DOM slot 锚点定位相邻的新建对话标题，并将其改为“驱动智能探索图谱”。当前版本的 DeepSeek Harness 尚未提供标题插槽或同名 locale 字典覆盖接口，因此该逻辑由品牌标记组件的生命周期管理：仅作用于 Hero 标题节点，不会改变其他国际化文本，并会在组件卸载时恢复原始内容。
