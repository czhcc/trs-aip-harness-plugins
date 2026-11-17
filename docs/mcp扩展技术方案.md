# MCP 扩展技术方案

> DSH `0.2.2-rc.3` 适配说明：当前实现使用插件导出的 volatile `Config.servers` 和浏览器 `configForms`，表单命名空间为 Cordis entry id `trs-aip-mcp-settings`，保存位置为当前 Profile patch。实例配置补齐新版 MCP Client 的 `closeTimeoutMs: 5000` 与 `expandTemplates: false`，继续由插件解析凭据引用，字面值不进行模板展开。下文的 `settings.register`、`settingsScope` 和 `settings.yaml` 属于旧版设计。旧配置 `trs-aip-mcp.servers` 可从 `settings.yaml` 或主体迁移后的 `settings.yaml.imported` 取出，在 MCP 页面导入保存。

## 1. 背景

当前 `trs-aip-harness-plugins` 只提供 TRS-AIP 品牌标记、品牌名称和主题令牌覆盖。宿主入口没有运行逻辑，浏览器端也只依赖插槽和主题服务，尚未提供设置命名空间、MCP 配置持久化、MCP 客户端生命周期管理或连接状态展示。

现有 MCP 客户端需要在 Cordis 组合中为每个服务器配置一条 `@deepseek-ai/dsh-mcp-client` 记录。随着 MCP 服务器数量增加，直接维护 `cordis.patch.yml` 不便于普通用户操作，也不适合在运行期间动态启停。

本方案拟在 Web“设置”中增加 MCP 客户端配置功能，使用户可以通过界面维护多个 MCP 客户端，而不再为每个 MCP 服务器手工编辑 `cordis.patch.yml`。

## 2. 结论

该功能可以实现，基础版本可以只在 `trs-aip-harness-plugins` 仓库内完成，不要求修改 DeepSeek Harness 主仓库。

需要明确区分以下两个目标：

- 可以取消“每个 MCP 客户端都通过 `cordis.patch.yml` 配置”的方式。MCP 服务器列表改由 Harness 用户设置持久化，并由插件在运行时动态创建客户端。
- 不能取消插件自身的首次安装入口。当前 Harness 仍需要通过 Cordis 组合加载插件；现有插件本身也由随包提供的 `cordis.patch.yml` 自动加入 Web 配置。用户无需手工编辑该文件，但安装机制仍会使用它。

仅增加前端设置表单不能完成目标。插件还必须增加宿主端 MCP 管理器，把保存的配置转换为真实的 `dsh-mcp-client` 实例。

## 3. 建设目标

### 3.1 功能目标

- 在 Web“设置”中提供独立的“MCP 客户端”页面。
- 支持添加、编辑、启用、禁用和删除多个 MCP 客户端。
- 支持 `stdio` 和 `streamable-http` 两类传输。
- 支持为每个客户端配置唯一的 `serverName`。
- 支持参数、工作目录、URL、请求头引用、环境变量引用、工具调用超时和自动重连策略。
- 将配置保存到 Harness 用户设置文档中。
- 配置变更后动态创建、替换或销毁 MCP 客户端，无需修改 Cordis 配置文件。
- MCP 工具注册到全局工具层，使 Web 会话中的 Agent 可以继承并使用。

### 3.2 非目标

- 不修改 MCP 协议实现。
- 不增加 MCP Resources 和 Prompts 支持；当前 Harness MCP 桥接只支持 Tools。
- 不把 MCP 密钥明文返回浏览器。
- 不保证修改同名客户端时完全无中断。
- 基础版本不要求修改运行中的 Agent preset 文件。

## 4. 现有能力分析

DeepSeek Harness 已具备实现本方案所需的主要扩展点：

- Web 基础组合已安装文件设置提供者，用户设置可以持久化到 `$DSH_HOME/settings.yaml` 并支持热更新。
- Web 基础组合已安装凭据提供者，可以保存凭据引用对应的实际密钥，并只向浏览器返回是否已配置等安全信息。
- Client 设置系统提供 `settings.section`、`settings.plugins.tab` 等插槽，外部 Client 插件可以贡献独立设置页面。
- 设置服务支持命名空间注册、Schema 校验、运行时监听、版本冲突检查和持久化。
- `@deepseek-ai/dsh-mcp-client` 的一个插件实例对应一个 MCP 服务器；多个实例可以同时存在，但同一注册作用域中的 `serverName` 必须唯一。
- Harness 已有通过 `ctx.plugin(McpClient, config)` 动态挂载 MCP 客户端的实现先例。
- 工具注册表会把宿主全局工具合并到 Agent 的可见工具集合，因此宿主端创建的 MCP 工具可以被各 Web Agent 继承。

## 5. 总体架构

建议将 MCP 管理功能作为独立的双面插件包，例如：

```text
packages/
├─ client-branding/
└─ mcp-settings/
   ├─ src/index.ts             # 宿主端设置注册和 MCP 实例管理
   ├─ src/client/index.ts      # 浏览器端设置页面注册
   ├─ src/client/*.tsx         # MCP 配置表单
   ├─ src/client/*.module.css  # 设置页面样式
   ├─ package.json
   └─ tsdown.config.ts
```

将该能力直接放进现有 `client-branding` 包在技术上也可行，并且可以复用现有安装行，但会把品牌展示和 MCP 运行管理耦合在一起。为保持职责清晰、便于独立升级和卸载，推荐新增 `mcp-settings` 包，由插件仓库随包补丁自动安装。

整体数据流如下：

```text
设置页面
  → settingsScope / settings Remote
  → $DSH_HOME/settings.yaml
  → 宿主端 MCP 配置管理器
  → 为每个启用项创建一个 dsh-mcp-client 实例
  → MCP 工具注册到全局 tools
  → Web Agent 在后续模型请求中继承这些工具
```

## 6. 配置模型

建议注册独立设置命名空间 `trs-aip-mcp`，配置根对象包含 `servers` 数组。

示例：

```yaml
trs-aip-mcp:
  servers:
    - id: github
      enabled: true
      serverName: github
      transport: stdio
      command: npx
      args:
        - -y
        - "@modelcontextprotocol/server-github"
      cwd: ""
      envCredentialRefs:
        GITHUB_TOKEN: GITHUB_TOKEN
      toolCallTimeoutMs: 60000
      failOnStartupError: false
      reconnect:
        enabled: true
        initialDelayMs: 500
        maxDelayMs: 30000
        maxAttempts: 10

    - id: internal-search
      enabled: true
      serverName: search
      transport: streamable-http
      url: https://example.test/mcp
      headerCredentialRefs:
        Authorization: MCP_AUTHORIZATION
      toolCallTimeoutMs: 60000
      failOnStartupError: false
      reconnect:
        enabled: true
        initialDelayMs: 500
        maxDelayMs: 30000
        maxAttempts: 10
```

### 6.1 公共字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `id` | 是 | 设置记录自身的稳定标识，用于前端列表和宿主端差异计算 |
| `enabled` | 是 | 是否创建对应 MCP 客户端 |
| `serverName` | 是 | MCP 工具名称空间，必须满足 `[A-Za-z0-9_-]{1,32}` 且全局唯一 |
| `transport` | 是 | `stdio` 或 `streamable-http` |
| `toolCallTimeoutMs` | 否 | 单次 MCP 工具调用超时，默认 60000 毫秒 |
| `failOnStartupError` | 否 | 初始连接失败时是否让该实例激活失败 |
| `reconnect` | 否 | 自动重连策略 |

### 6.2 stdio 字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `command` | 是 | 要启动的可执行程序 |
| `args` | 否 | 原样传给程序的参数数组 |
| `cwd` | 否 | MCP 子进程工作目录 |
| `envCredentialRefs` | 否 | 环境变量名到 Harness 凭据引用的映射 |
| `envLiterals` | 否 | 明确允许保存的非敏感环境变量 |

### 6.3 Streamable HTTP 字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `url` | 是 | MCP HTTP 端点，建议只接受 `http:` 和 `https:` |
| `headerCredentialRefs` | 否 | 请求头名称到 Harness 凭据引用的映射 |
| `headerLiterals` | 否 | 明确允许保存的非敏感请求头 |

## 7. 宿主端设计

### 7.1 设置注册

宿主插件注册 `trs-aip-mcp` 设置命名空间，并声明为运行时生效。Schema 至少应验证：

- `id` 非空且不可重复。
- `serverName` 满足 MCP 插件的命名规则且不可重复。
- `transport` 对应的专用字段完整。
- 超时和重连参数为合法正数及整数。
- `stdio.command` 非空。
- HTTP URL 协议在允许范围内。
- 凭据引用符合 Harness 凭据名称规则。

设置服务的同步校验只负责配置结构和本地不变量，不进行网络连接或启动子进程。

### 7.2 MCP 实例协调器

宿主端维护以下状态：

```text
Map<serverName, {
  fingerprint: string
  fiber: CordisPluginHandle
  status: RuntimeStatus
}>
```

每次设置变化后，对“期望配置”和“当前实例”做差异计算：

- 配置未变化：保留现有实例。
- 新增且启用：解析凭据，调用 `ctx.plugin(McpClient, config)` 创建实例。
- 删除或禁用：等待对应实例 dispose。
- 同名配置变化：先 dispose 旧实例，再创建新实例。
- `serverName` 变化：视为删除旧实例并新增新实例。

所有协调操作必须串行执行。新的设置版本到达时不能与上一次卸载、连接或工具发现交错，否则可能出现重复名称、旧实例覆盖新实例或资源泄漏。

### 7.3 生命周期

- 插件启动时读取设置快照并创建全部启用项。
- 设置提交或文件热更新后触发协调。
- 插件卸载时依次停止所有 MCP 实例，并等待 MCP 连接监督器完成清理。
- 单个实例失败不应阻止其他 MCP 客户端继续工作。
- 未变化的实例不应因为列表重排而重启。

### 7.4 生效范围

本方案把 MCP 工具注册在宿主全局工具层，因此：

- 所有 Web 会话和 Agent preset 默认继承同一组 MCP 工具。
- 新增或删除 MCP 工具会影响已有会话后续轮次的工具 Schema。
- Agent 的工具限制仍可以屏蔽继承来的 MCP 工具。

如果未来要求“每个会话或每个 Agent preset 使用不同 MCP 列表”，需要另行设计 Agent 作用域配置，不属于本方案基础范围。

## 8. 浏览器端设计

### 8.1 页面位置

推荐注册独立的 `settings.section` 页面，导航名称为“MCP 客户端”。相比放入通用“插件配置”卡片，独立页面更适合呈现可增删的服务器数组、传输类型切换、连接状态和凭据输入。

也可以注册为 `settings.plugins.tab`，但会依赖“插件”设置页面始终存在。

### 8.2 页面功能

- MCP 客户端列表。
- 添加客户端。
- 展开或折叠单个客户端。
- 启用、禁用、复制和删除。
- 传输类型切换。
- `stdio` 与 HTTP 专用字段。
- 参数、环境变量、请求头的动态列表编辑。
- 重连策略高级设置。
- 保存、放弃修改和恢复继承值。
- 重复名称、必填字段、URL、数字范围等本地校验。
- 使用设置命名空间 revision 提交，拒绝覆盖并发修改。

### 8.3 状态展示

建议区分设置状态和运行状态：

- 未保存。
- 保存中。
- 已保存。
- 正在连接。
- 已连接，可显示发现的工具数量。
- 连接失败。
- 正在重连。
- 已禁用。

现有 MCP 客户端没有直接面向浏览器的连接状态服务。基础版本可以只展示配置保存状态，把连接问题写入宿主日志；如果产品要求展示实时连接状态，则需要由宿主 MCP 管理器额外提供只读状态 Remote 和状态变更事件。

阶段二在不修改 Harness 主仓库的约束下采用可验证的状态口径：插件只读 Remote 返回协调器实例的启动、重新启动、停止和激活失败状态，并统计 `mcp__<serverName>__` 命名空间下已注册的工具数。由于当前 MCP Client 未暴露协议连接和自动重连回调，页面不会把“实例已激活”表述为“协议已连接”；底层连接与重连细节仍保留在宿主日志中。

## 9. 凭据安全

MCP 配置中的以下内容可能是密钥：

- `stdio.env` 中的 Token、Password、Secret、Key。
- HTTP `Authorization`、Cookie 或自定义认证请求头。

不应把这些值作为普通设置字段保存，因为设置描述会发送到浏览器，且数组、联合 Schema 中的秘密字段不宜依赖通用 Schema 脱敏器证明安全。

推荐方案：

1. 设置文档只保存凭据引用，例如 `GITHUB_TOKEN`、`MCP_AUTHORIZATION`。
2. 实际密钥通过 Harness credentials Remote 写入受管凭据文件。
3. 浏览器只读取“是否已配置、来源、是否可写”，不读取实际值。
4. 宿主端创建或重启 MCP 实例时解析凭据引用，并组装最终 `env` 或 `headers`。
5. 收到凭据更新事件时，重启引用该凭据的 MCP 客户端，使新凭据生效。
6. 日志和错误信息不得输出解析后的密钥。

## 10. 一致性与失败处理

### 10.1 保存与连接不是同一事务

设置持久化完成时，MCP 连接和工具发现可能仍未完成。无响应 MCP 服务器可能使初始化或清理等待 SDK 默认请求超时。因此：

- “保存成功”只表示配置通过校验并已持久化。
- “连接成功”必须由运行状态单独表示。
- 连接失败不自动回滚已经保存的配置，以便重连策略或用户修正后继续使用。

### 10.2 同名客户端更新

MCP 插件不允许同一注册作用域内同时存在相同 `serverName`。修改同名客户端时不能先创建新实例再无缝替换，通常需要：

1. 停止旧实例。
2. 释放名称和工具注册。
3. 创建新实例。

该过程会产生短暂不可用窗口。页面应显示“正在重连”，而不是承诺无中断切换。

### 10.3 部分失败

一个配置列表中某个客户端连接失败时：

- 其他已连接客户端保持不变。
- 失败客户端保留设置和错误状态。
- 不产生半注册的工具集合。
- 用户可以修改、禁用或删除失败项。

## 11. 安全约束

`stdio` MCP 命令属于宿主信任域，运行在 Agent 沙箱之外。设置页面必须明确说明：添加或启用 `stdio` MCP 等同于授权宿主执行指定程序。

建议至少采取以下措施：

- 只在本机 loopback 页面允许持久化和启用 MCP 配置。
- 对远程浏览器禁用所有写操作。
- 启用 `stdio` 客户端前显示安全提示。
- 不通过 shell 拼接命令；`command` 与 `args` 分开传递。
- URL 仅允许明确支持的协议。
- 不把密钥写入普通设置、日志或错误详情。
- 对客户端数量、参数数量和文本长度设置合理上限。
- `serverName`、配置 `id` 和凭据引用必须严格校验。

## 12. 构建与依赖影响

当前插件自定义的 `dshClientPlugin` 构建器足以构建品牌组件，但尚未包含 Harness 官方 Client Bundle 的 CSS Modules 内联处理。设置页面若采用标准 CSS Modules，需要扩展该构建器，使样式被编译并注入 `client.js`，避免依赖额外静态资源路由。

新增包预计需要以下依赖类型：

- 宿主端：Cordis、MCP Client、Settings、Credentials、Schemastery。
- 浏览器端：Settings Client 类型、Remote 类型、Locale、Slots、UI Primitives、React。
- 构建端：用于 CSS Modules 的 `lightningcss` 或与 Harness 官方构建预设等价的处理逻辑。

浏览器业务组件不应直接访问 Cordis Context；Context 只在 Client `apply` 中使用，组件通过注入的 props、Store 和回调读取状态与提交操作。

## 13. 版本兼容性

当前 `trs-aip-harness-plugins` 文档和 peerDependencies 声明目标为 DeepSeek Harness `0.1.2-alpha.1`，但本地检出的 Harness、Settings 和 MCP Client 为 `0.1.2-alpha.2`。

本方案的可行性基于当前本地 `0.1.2-alpha.2` 源码。正式实现前需要：

- 明确实际部署版本。
- 对齐插件 peerDependencies。
- 确认目标版本包含 `settings.section`、`settingsScope`、Settings Remote、凭据 Remote 和当前 MCP Client 生命周期能力。
- 如果必须继续支持 `alpha.1`，单独验证上述扩展点，不能直接假定与 `alpha.2` 二进制兼容。

## 14. 实施拆分建议

### 阶段一：基础配置与动态挂载

- 新增 `mcp-settings` 双面插件包。
- 注册 `trs-aip-mcp` 设置命名空间。
- 完成服务器数组 Schema 和唯一性校验。
- 完成宿主端实例协调器。
- 支持 stdio 和 Streamable HTTP。
- 增加独立设置页面和基本增删改功能。
- 使用凭据引用，不在设置中保存密钥。
- 连接结果先通过宿主日志观察。

### 阶段二：运行状态与体验完善

- 增加 MCP 状态服务和只读 Remote。
- 展示连接、工具发现、失败和重连状态。
- 增加凭据配置控件。
- 增加复制配置、导入和导出功能。
- 增加操作安全确认和更完整的错误提示。

### 阶段三：高级作用域能力

- 按 Agent preset 选择 MCP 客户端。
- 按会话启用或屏蔽 MCP 客户端。
- 增加工具级可见性配置。
- 评估配置变化对现有会话工具 Schema 和 KV Cache 的影响。

## 15. 验收标准

- 用户可以在设置中创建至少两个不同 `serverName` 的 MCP 客户端。
- 重启 Harness 后配置仍存在，并自动恢复启用的连接。
- 新增客户端后，其工具在后续 Agent 请求中可见。
- 禁用或删除客户端后，其工具被注销。
- 修改未变化客户端以外的配置不会重启无关客户端。
- 重复 `serverName`、非法 URL、空命令和非法数值无法保存。
- MCP 密钥不会出现在 Settings 描述响应、浏览器状态、日志或普通设置文件中。
- 单个客户端连接失败不会影响其他客户端。
- 非 loopback 页面不能修改 MCP 配置。
- 用户无需为每个 MCP 服务器手工编辑 `cordis.patch.yml`。

## 16. 最终建议

建议采用“独立 `mcp-settings` 双面插件包 + Harness Settings 持久化 + 宿主端动态 MCP 实例协调器”的方案。

该方案能够在不修改 DeepSeek Harness 主仓库的前提下实现多个 MCP 客户端的可视化管理，并保留 Harness 现有 MCP Client 的工具注册、重连和清理能力。实施时应优先解决凭据引用、串行生命周期协调、同名实例替换和版本对齐问题；实时连接状态可以作为第二阶段能力交付。
