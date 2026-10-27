# DSH 知识库插件

复用 TsLightRAG 的本地解析、快照存储、GraphRAG 索引和检索引擎，以 DSH Host + Client 插件运行，不启动独立 HTTP 服务。

## 使用

1. 将本包作为 DSH profile bundle 安装并启用；桌面发行配置已包含本包。
2. 在 DSH 模型设置中配置服务商和文本模型；在“设置 → 知识库 → 文本模型”选择“跟随 DSH”或固定一个已配置的模型。跟随模式使用 DSH 最近保存的默认选择，通常由中间对话的模型选择器更新。
3. 在“设置 → 知识库”填写向量服务的 Base URL、模型名、维度；例如 OpenAI 兼容地址应为 `http://localhost:11434/v1`，不要追加 `/embeddings`。重排使用完整接口地址，默认关闭。
4. 如服务要求密钥，使用 `RAG_EMBEDDING_KEY` 等凭据引用，通过页面上的 DSH Credentials 入口写入密钥。
5. 右侧打开“知识库”，导入文档；缺少模型配置时仍可本地解析，配置后手动重试任务。
6. 中间对话标题栏的“知识库：关闭 / 自动使用”只影响当前 DSH 对话，默认关闭。启用后，每次请求会提示模型优先用 `knowledge_search` 回答资料性问题，无需用户在问句里写工具名；同时说明知识库独立于工作区，文件搜索无结果不代表知识库没有资料。自动模式仍由模型执行工具选择，不是每次发送前强制检索。关闭后已写入历史的证据不会消失。

四个标签为知识问答、检索预览、知识图谱、文档。侧栏支持 DSH 展开面板，颜色、字体和图谱跟随宿主主题即时更新。

新建的空白会话在工作区、智能体选择旁显示同一个知识库开关，可以在发送首条消息前启用；开始对话后，标题栏保留该会话的选择。尚未选择工作区、没有会话 ID 的初始页面不显示会话开关。每个新会话默认关闭。

### 本地 Web 启动

在插件仓库执行 `pnpm install` 只安装开发依赖，不会自动把本包加入 DSH 的 Web profile。先停止正在运行的 DSH，再构建和安装：

```powershell
cd D:\myprog\webstorm\dsh\plugins-test\trs-aip-harness-plugins
pnpm --filter @trs-aip/dsh-knowledge-rag build
cd ..\deepseek-harness
pnpm dsh plugin --profile web add link:../trs-aip-harness-plugins/packages/knowledge-rag
pnpm dsh web
```

`plugin add` 将安装信息写入用户的 Web profile，不修改主体工程源码。`link:` 适合本地开发，后续修改只需重新构建并重启 DSH。启动后在右侧栏打开“知识库”；向量及重排在“设置 → 知识库”配置。若未显示，先通过 `pnpm dsh --profile web --dump-config` 检查是否包含 `trs-aip-knowledge-rag`，再查看启动日志中的加载错误。

## 数据与模型

- 数据位于当前 profile 的 `data/trs-aip-knowledge-rag/`，包含原文、解析产物、索引快照、问答历史及会话开关。整个目录一起备份，勿同时由多个 Host 写入。
- 文本模型通过 `ctx.llm.prepareCall` 使用知识库选定的 DSH 模型，默认跟随 DSH。固定选择仅保存服务商和模型标识，不复制地址或密钥；用于问答、图谱抽取、摘要和关键词。固定模型不可用时明确失败，不自动改用其它模型。中间对话最终回答仍使用该对话自己的模型。仅转发正文，思考内容不进入回答或抽取结果。
- 向量和重排通过插件配置调用外部服务；凭据每次请求从 DSH Credentials 解析。索引元数据保存模型身份和凭据引用，不保存密钥。
- 更换向量模型、维度、服务版本后，在文档的“索引维护”中完整重建。旧快照继续使用原向量配置；重建失败保留旧索引。同名模型升级请递增“向量服务版本”。
- 文件上限 20 MiB，内存上传最多同时两份；解析 Worker 有资源和时间限制。扫描 PDF 不提供 OCR。内存向量扫描适合有限规模的本地语料。
- 导入、检索和生成会向相应配置的模型服务发送文本。删除文档后旧快照仍可能保留原文，清理状态可在索引维护查看。

## 开发

在插件仓库根目录安装依赖后执行：

```powershell
pnpm --filter @trs-aip/dsh-knowledge-rag build
pnpm --filter @trs-aip/dsh-knowledge-rag test
```

浏览器测试需要 Playwright Chromium；Windows 已安装 Edge 时，可先设置 `$env:RAG_BROWSER_CHANNEL='msedge'`。测试使用本地合成文档和确定性模型，不调用个人模型账号。构建后可在本包目录运行以下命令验证发行包：

```powershell
npm pack --ignore-scripts --pack-destination .test-data
node tests/packed.mjs
```

压缩包测试在隔离目录解包，并链接当前安装的依赖；它不替代干净环境依赖安装或完整桌面安装器验收。

构建产物包含 Host、Client、独立解析 Worker 和动态解析资源。开发时只读取同级 `deepseek-harness` 的公共依赖，不在主体工程执行生成或构建。

上游 MIT 许可及第三方说明见 `third_party/`。实施和验收记录见仓库 `docs/TsLightRAG插件开发验收.md`。
