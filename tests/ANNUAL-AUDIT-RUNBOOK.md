# 年度离线审计

所有 PRIVATE_OUTPUT 都必须使用当前用户 TEMP 下预先创建的专用子目录。脚本拒绝 TEMP 根目录、仓库或 NAS 等外部目录，并检查真实路径，避免经目录链接误写。不得把报告、图片或 PDF 提交 Git。仅枚举明确业务日期目录，不进入 NAS `@自动化处理`。

```text
node tests/annual-replay.mjs inventory BUSINESS_ROOT PRIVATE_OUTPUT
node tests/annual-replay.mjs structure BUSINESS_ROOT PRIVATE_OUTPUT
node tests/annual-replay.mjs replay BUSINESS_ROOT PRIVATE_OUTPUT [YYYY-MM-DD ...]
node tests/annual-pdf-replay.mjs PRIVATE_OUTPUT 0 1 [YYYY-MM-DD ...]
node tests/experiments/annual-detection-replay.mjs PRIVATE_OUTPUT PINNED_MODEL_FILE 0 1 [YYYY-MM-DD ...]
node tests/audit-status.mjs PRIVATE_OUTPUT
```

`replay` 只生成计划，不改原图；副本文件名隐藏历史编号，不制造拍摄顺序。`structure` 不执行 OCR，不能当作识别通过。`annual-pdf-replay` 不处理订单。实验性检测器的第二引擎结果不达标时仍为未决，不能替代产品验收。

大批复核按输入内容哈希保存进度。中断后使用相同输入及源码快照继续；不要在同一组对照中修改算法，也不要把跨快照结果合并成通过率。原文件发生变化时停止该项并重新盘点。

`audit-status` 只汇总数量，不把扫描覆盖当作识别验收；报告明确标为未验收。回放必须从单独冻结的仓库快照启动，不要一边运行一边修改其外部 OCR 脚本。重跑失败项不会把之前的错误缓存当成成功跳过。

历史文件名只是参考答案；任何冲突必须对照打印编号、PDF 或人工可见证据，不可直接按旧文件名改回。已经命中人工哈希证据的照片应单独统计，不能算作自动识别成功。

普通回归：`node tests/run-tests.mjs`。Windows 实测：`powershell.exe -NoProfile -File ui/Run-Tests.ps1` 与 `node tests/windows-ocr-batch-regression.mjs`。DPAPI 被测试沙箱跳过时应标为跳过，并在经授权的桌面用户上下文补测。

UI 回归同时运行 `windows-ocr-long-path-integration.mjs`：真实 WinRT 读取超过 300 字符路径的合成图，并验证中间文件缺失不影响其他文件。只创建、清理本次测试自己的 TEMP 子目录。

`node tests/windows-code-real-replay.mjs PRIVATE_OUTPUT PHOTO_SHA256 [...]` 只对指定库存照片探测严格 WinRT 窄框。SHA 只选择输入，不提供目标答案；报告另存为唯一轮次，不覆盖失败结果。`0` 个完整码与引擎异常分别统计，此专项不能代替整个产品流程或跨修订归属验收。

`node tests/experiments/inspect-detected-code.mjs PRIVATE_OUTPUT DETECTION_ROUND PHOTO_SHA256 [...]` 只按已保存的检测框生成私有查看副本，并核验源哈希未变化。它不重新 OCR、不改名、不向引擎提供参考编号。几十像素的小编号即使放大也不能当作恢复了原始笔画；应同时核对完整 PDF 正文，保留无法确认的类别。某些直接 JPEG 预览异常可用同一解码器输出的缩放 PNG 交叉检查，不能仅凭预览异常认定原文件损坏。

`node tests/experiments/body-text-probe.mjs PRIVATE_OUTPUT [--chinese] PHOTO_SHA256 [...]` 是独立正文证据试验，绝不生成改名/上传计划。默认以 Windows OCR 三个宽视图比较当日所有 PDF 文字页；`--chinese` 另用固定中文行识别模型及文字检测器。两个中文裁框是同引擎不同视图，不是双引擎。报告只有计数、PDF 内容哈希与页身份，不含客户正文。数字码不进入正文匹配，共用模板不算页面特有证据；最高计数、单个独有词或同名客户也不能直接确认为订单归属。

中文试验模型仅位于 `PRIVATE_OUTPUT/models/`：检测模型仍为上文固定版本；识别模型 `ch_PP-OCRv4_rec_mobile.onnx` 使用 RapidAI v3.9.2 清单中的 SHA-256 `48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b`。脚本不下载模型，拒绝哈希不一致；使用模型内嵌 6,623 项字典，不能用现用英文 436 项字典。`node tests/experiments/chinese-reader-smoke.mjs PRIVATE_OUTPUT/models` 是实际模型合成中文烟雾测试，缺模型时失败，不伪装跳过为成功。

`audit-status` 的 `bodyProbeRounds` 另列中文正文试验的证据可用性，不混入产品识别确认数。汇总只接受完成报告、相同源码/模型指纹及未变原件；缺少视图、读取异常、截断和 PDF 文字层不全分别标记。`stable-diagnostic-candidate` 只是同引擎两个边距视图的首选一致；即使只有一个特有片段也可能出现这一状态，所以绝不能当自动绑定或发布门槛。正文重复、旧页拆成多页以及背景文字仍需独立反例验证。
