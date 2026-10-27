# 本地解析合成夹具

本目录文件复制自 TsLightRAG 0.1.0 的 `tests/fixtures/documents`，适用该工程 MIT 许可（见本包 `third_party/TsLightRAG-LICENSE`）。原工程通过 `tests/fixtures/build-documents.mjs` 确定性生成这些合成文件；本目录仅保留插件解析测试使用的样本，不包含用户文档或下载资产，也没有复制原工程的验收结论。

- TXT/Markdown/HTML/CSV/JSON：UTF-8 中文、emoji、标题、外链、不执行的脚本、引号与跨行记录、JSON Pointer 转义。
- DOCX/XLSX/PPTX：真实 ZIP/OOXML 小文件，包含段落、表格、共享字符串、公式缓存及幻灯片顺序等用例。
- PDF：带完整 xref/页树的真实 PDF。sample 含 Helvetica 文本与自编 ToUnicode CMap 的中文/emoji；scanned 含本地 1×1 图片且无文本层；encrypted 使用 PDF Standard R2/RC4 合成口令，仅用于拒绝加密文件测试。

本包仅测试 `tests/parsers.test.ts` 中明确列出的格式及拒绝情形；未复制原工程的全部夹具、安全变体测试或验收文档。夹具不覆盖复杂排版、真正 VBA 字节码或扫描 OCR。

`.gitattributes` 保留 PDF/Office 原字节及 TXT/CSV 的 BOM/CRLF 用例，不经 Git 换行转换。PDF xref 固定宽度记录中的尾空格属于文件格式，不应按源码格式化。
