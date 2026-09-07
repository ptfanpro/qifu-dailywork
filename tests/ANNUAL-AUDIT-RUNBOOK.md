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
