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

`photo-capture-evidence-regression.mjs` 已加入普通入口，也可用 `node --test tests/photo-capture-evidence-regression.mjs` 单独执行。规范数字名、盲哈希名、缺失或无效时间戳都不证明连续拍摄；中间缺号必须检查直到右锚点的每一条边。正例必须提供真实格式的合成拍摄时间，不能为让旧断言通过而恢复“无时间即连续”。时间证据仅允许提出候选，不构成身份/归属验收。对保存后的计划重跑助手不等于冷回放：后续审核状态已影响输入，若未复现原失败，不得声称该实图已修复；从新固定源码和原始副本重新跑完整识别链，并单列普通灯阵/纸张的退化。

`audit-status` 只汇总数量，不把扫描覆盖当作识别验收；报告明确标为未验收。回放必须从单独冻结的仓库快照启动，不要一边运行一边修改其外部 OCR 脚本。重跑失败项不会把之前的错误缓存当成成功跳过。

历史文件名只是参考答案；任何冲突必须对照打印编号、PDF 或人工可见证据，不可直接按旧文件名改回。已经命中人工哈希证据的照片应单独统计，不能算作自动识别成功。

普通回归：`node tests/run-tests.mjs`。Windows 实测：`powershell.exe -NoProfile -File ui/Run-Tests.ps1` 与 `node tests/windows-ocr-batch-regression.mjs`。DPAPI 被测试沙箱跳过时应标为跳过，并在经授权的桌面用户上下文补测。

UI 回归同时运行 `windows-ocr-long-path-integration.mjs`：真实 WinRT 读取超过 300 字符路径的合成图，并验证中间文件缺失不影响其他文件。只创建、清理本次测试自己的 TEMP 子目录。

`node tests/windows-code-real-replay.mjs PRIVATE_OUTPUT PHOTO_SHA256 [...]` 只对指定库存照片探测严格 WinRT 窄框。SHA 只选择输入，不提供目标答案；报告另存为唯一轮次，不覆盖失败结果。`0` 个完整码与引擎异常分别统计，此专项不能代替整个产品流程或跨修订归属验收。

`node tests/experiments/inspect-detected-code.mjs PRIVATE_OUTPUT DETECTION_ROUND PHOTO_SHA256 [...]` 只按已保存的检测框生成私有查看副本，并核验源哈希未变化。它不重新 OCR、不改名、不向引擎提供参考编号。几十像素的小编号即使放大也不能当作恢复了原始笔画；应同时核对完整 PDF 正文，保留无法确认的类别。某些直接 JPEG 预览异常可用同一解码器输出的缩放 PNG 交叉检查，不能仅凭预览异常认定原文件损坏。

`node tests/experiments/body-text-probe.mjs PRIVATE_OUTPUT [--chinese] PHOTO_SHA256 [...]` 是独立正文证据试验，绝不生成改名/上传计划。默认以 Windows OCR 三个宽视图比较当日所有 PDF 文字页；`--chinese` 另用固定中文行识别模型及文字检测器。两个中文裁框是同引擎不同视图，不是双引擎。报告只有计数、PDF 内容哈希与页身份，不含客户正文。数字码不进入正文匹配，共用模板不算页面特有证据；最高计数、单个独有词或同名客户也不能直接确认为订单归属。

中文试验模型仅位于 `PRIVATE_OUTPUT/models/`：检测模型仍为上文固定版本；识别模型 `ch_PP-OCRv4_rec_mobile.onnx` 使用 RapidAI v3.9.2 清单中的 SHA-256 `48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b`。脚本不下载模型，拒绝哈希不一致；使用模型内嵌 6,623 项字典，不能用现用英文 436 项字典。`node tests/experiments/chinese-reader-smoke.mjs PRIVATE_OUTPUT/models` 是实际模型合成中文烟雾测试，缺模型时失败，不伪装跳过为成功。

`audit-status` 的 `bodyProbeRounds` 另列中文正文试验的证据可用性，不混入产品识别确认数。汇总只接受完成报告、相同源码/模型指纹及未变原件；缺少视图、读取异常、截断和 PDF 文字层不全分别标记。`stable-diagnostic-candidate` 只是同引擎两个边距视图的首选一致；即使只有一个特有片段也可能出现这一状态，所以绝不能当自动绑定或发布门槛。正文重复、旧页拆成多页以及背景文字仍需独立反例验证。

`body-text-probe.mjs PRIVATE_OUTPUT --chinese --vertical PHOTO_SHA256 [...]` 额外读取文字检测器提出的竖排块。先以原图像素比例判断方向，按短边设置边距、旋转 270 度后送同一个中文模型；不按 PDF 答案选方向/裁框。横排路径保持原状，竖排仍是试验开关，不进入产品。报告显式记录 `expectedLayouts`；四个视图仍只有一个中文引擎。

后续正文保护候选的横排路径也必须使用像素比例：`horizontal-body-regions-regression.mjs` 验证同一物理文字行在不同画布上的选择与边距一致，并拒绝非法坐标。旧快照仍保留旧运算，不原位替换。修正后须分别记录完整 PDF 语料与照片的实图读数，不能只验证 `readLine` 能读合成中文，不能把新增同引擎视图当作独立绑定证据。

`paper-orientation-regression.mjs` 对纸张方向另行验证：源图 EXIF 旋正尺寸必须与归一化纸色框一起保存，再按实际像素比较长宽。动态编号框、版式候选方向筛选和重复号版式修复共用该计算；旧缓存缺维度时方向未知，不能默认为正方形。测试包含同一物理纸张跨画幅、非法/缺失尺寸、实际重复号修复反例，以及真实生成 JPEG 的 EXIF 1/6/8。它已经加入普通入口。几何结果一致不证明纸色边界正确，不证明完整码或订单绑定；新旧整日冷回放仍必须独立冻结，保留现有场景语义失败与新增未决。

正文汇总 schema 2 要求完整的逐页排名，拒绝漏页/重复页。即使两个视图第一名相同，只要同一视图还读到另一个页面的特有正文，标为 `multi-page-body-evidence`；横竖路径指向不同页面则为 `conflicting-layout-evidence`。这可能来自旧页拆分、背景文字或噪声，不凭排名武断判断原因。

`vertical-body-probe.mjs PRIVATE_OUTPUT PHOTO_SHA256 [...]` 保留 90/270 度方向的对照诊断，不赋号。合成中文烟雾测试仅证明固定模型能读横排及已旋转的竖排文字，不代表检测器一定会把竖排整列聚合成一个框；逐字分开的竖排仍是待验证限制。

`pdf-visual-body-probe.mjs PRIVATE_OUTPUT YYYY-MM-DD [PHOTO_SHA256 ...]` 是同一照片观察、两套 PDF 正文来源的独立 A/B 试验。不给照片 OCR 历史编号；先读取该日全部 PDF 页的文字层，并把完整页面按最长边 1800 像素渲染，使用固定中文横排/竖排四视图读取，再把每个来源的片段集合并集用于页面频率统计。不能串接不同来源制造新片段。缺 PDF 页、重复页、缺视图、异常或截断会停止诊断，而不是用不完整的集合认定某段文字独有。四个视图仍是同引擎，完成渲染和读取也不代表 OCR 覆盖全部可见文字。

未传照片哈希时读取显式日期的全部库存照片；传值时必须全部唯一属于该日期。输出 `pdf-visual-body-probe-*` 为新的私有轮次，保留页面 PNG、计数/哈希报告及失败记录，不保存 OCR 原文，不进入产品/上传路径。这一试验不能替代打印修订与订单集合验证。

`audit-status` 在 `visualBodyProbeRounds` 单列这类 A/B 结果，从逐照片报告重新计算，不信任完成文件自报计数。必须核对同一照片、日期、源码/模型、完整 PDF 页身份集合；相同页数但不同集合也不接受。未完成、失败和无效轮次分别显示，不混入生产确认数。

`pdf-visual-body-probe.mjs PRIVATE_OUTPUT YYYY-MM-DD --fields [PHOTO_SHA256 ...]` 在同一批 OCR 观察上追加独立字段诊断，不替换四字片段基线。字段来自逐个 PDF 文字项，不跨项、来源或数字拼接；两至三字完整汉字字段可以形成诊断候选，但须排除在其他页面更长文字或可见模板中的子串。重复姓名、旧页拆分、两个边距/横竖视图不一致分别保留。输出 `fieldDiagnostic` 只含身份、计数和哈希，没有原文、赋号或可上传标记；即使全部提取字段都读到，也不能证明纸面完整、卡片数量、空间位置或订单集合相同。现有 `audit-status` 校验同轮原四字片段 A/B 报告，不把追加字段候选算作产品确认数。

逐字提取的竖排 PDF 可另使用 `visibleFieldViews` 中同布局两视图一致的完整汉字行作为诊断字段；不可把 PDF 文字流中的邻接汉字直接拼成姓名。报告分开记录 `distinctExtractedFields`、`visibleConsensusFields` 与两种来源的特有字段命中。零个提取字段绝不算完整覆盖。可见来源必须与同页补充语料精确一致，不能缺视图或混入别页。不同 PDF 文字项、不同 OCR 行和来源之间也不能拼接四字片段；因而新旧源码的文字层可用性计数可能不同，不能混合计算通过率。

`node tests/scene-category-replay.mjs PRIVATE_OUTPUT BASELINE_SOURCE [YYYY-MM-DD ...]` 仅对库存中已有场景参考标签的照片做类别/容量 A/B，文件名以哈希匿名化，分别测试整批空位、单张空位、供灯位置已满和供水位置已满。旧/新源码必须冻结并记录指纹，输入前后核验哈希；照片、报告留在本机专用临时目录。旧标签仅选取语料，不是真值；该专项不测试福单/场景入口、不执行 OCR 或订单绑定、改名、上传。不可将其计数当作全年自动识别验收。`scene-category-capacity-regression.mjs` 的生成图反例已纳入普通 Node 全套回归。

正文否决保护候选使用随仓库携带的 `models/paddleocr-zh-v4` 两份固定模型，`ui/Run-Tests.ps1` 强制执行实际模型横排/旋转竖排行烟雾测试；模型缺失或哈希错误必须失败，不能跳过。生产 `bodyClaimReview` 只表示当前 PDF 的正文观察检查，不证明完整订单集合。冻结完整计划回放必须同时检查该字段、最终 assignments 与允许上传编号；不能仅看早先 `pdfClaimRecheck.confirmed` 数量。共用读取/语料原语移入 `src` 后，试验源码指纹也须包括实际 `src` 依赖，旧冻结副本保持不变。

续跑输入保护由 `photo-upload-body-gate-regression.mjs`、`photo-upload-input-regression.mjs` 验证混合目录、过期计划、同名替换及精确处理回执；`photo-upload-receipt-integration.mjs` 实际生成 JPEG 并调用处理事务，验证真实回执可续跑、被替换的成品不可复用。均已纳入普通 Node 入口。新原图不会自动成为可上传文件，也不会单因出现而使不变的已验证成品失效。旧数字图待改号时，不得仅完成只读计划就沿用旧名上传。上述只证明文件身份和续跑入口保护，不能替代 OCR/订单归属验收。

完整短字段原语已移至 `src/body-field-evidence.mjs`，试验入口只转导出，产品和诊断指纹均覆盖实际依赖。`body-short-field-guard-regression.mjs` 验证四字片段漏掉的三字外页字段会触发否决，并覆盖同名、子串、模板、跨行及逐字 PDF。完整产品回放应同时检查 `bodyClaimReview.results[].fieldEvidence`，不能把字段读数一致当作 `bindingVerified=true`，也不能使用已知历史答案自动改号。既有冻结诊断目录不可原位更新。

产品回放汇总由 `audit-replay-summary.mjs` 独立处理 `pdfPages/assignments`，显示 `pages/assignedPhotos`，不把分配写成已验证归属（`confirmed=null`）。只取每日期的 `report.json`，不与同目录 `summary.json` 重复累加。缺源日期、失败日期、报告无效、原件变化分别列出；逐图哈希多重集须与库存一致，分配/未决/参考差异须与逐行计数一致。`audit-replay-summary-regression.mjs` 先复现旧页数为零，再覆盖上述情况和私有内容不泄漏，已纳入实际普通测试入口。历史结构第一版的源文件未变证据保存在每个 `rows[].sourceUnchanged`，不能因顶层字段缺失直接当作有变更，也不能未核对逐行就标通过。

`full-code-prefix-retention-regression.mjs` 验证完整码不同前缀不能在 Windows 汇总或独立引擎收集前被删除；同尾不同月、不同预处理读到不同前缀、引擎中途失败、后续成功覆盖失败和规范名复用分别覆盖。新增固定模型诊断只比较既有自动框，不把同家族中文/英文模型计为独立订单确认；新源码须冻结另跑完整日期，不能修改正在进行的旧年度快照。

`node tests/experiments/scene-semantic-counterexamples.mjs` 是新增的已知失败安全检查，须在发布前显式运行。它以脱敏指标重放纸张与背景颜色区域合并、阴影供水被暗暖色规则判成供灯的三个真实反例；当前退出码 1、失败 3，不纳入“普通套件已通过”的表述。测试没有原图、日期、文件名、页码答案或人工哈希。零失败只表示不再做出这些错误类别判断，不代表未决恢复、完整流水线通过或业务绑定成立；后续实图验收仍须同时涵盖正常灯阵、供水、纸张及相关退化，禁止针对这几组指标编写特例。

`portable-code-retention-regression.mjs` 已加入普通入口。先在旧版复现“单次完整码被场景覆盖”，再验证实际异步便携收集器保留全前缀、低分完整观察、范围外四位尾号和失败前结果；生成图实际跑 `recognizePreparedImage` 分派，避免只验证手造历史。合成 OCR 结果只验证流程，不是模型准确率。私有产品回放需同时检查 `recognized[].portableCodeRead`、未决历史、最终分配、正文证据和实际提示分类，扫描没有完整码、扫描未完成、码不在当前 PDF 中必须区分。保留原三个场景失败门槛及正常灯阵退化，不得因为新流程测试通过就宣布这些实图已修复。

同一收集器另覆盖“反复读到三位尾号却有零条完整码观察”的失败样本；弱候选不得直接升级为可靠完整码。`partialCodeObserved` 表示读到不完整代码候选，不能据“完整码列表为空”改判场景；仍可继续获取独立证据。真实回放必须从最新固定快照启动，并检查是否只是转为未决，而非已经恢复正确识别。

检测式编号试验的 `readDetectedCodes` 现在在期望前缀、分数和候选集合过滤前保存严格完整码，两个边距及两个引擎均实际读取，不由第一引擎是否命中来决定第二引擎是否检查。保留低分、不同前缀、范围外长尾码、拆分尾号、无结果和固定错误码；不保存客户正文。裁框复用像素比例原语，超出区域预算或读取异常不能给出诊断候选。`detected-code-observation-regression.mjs` 先复现旧过滤路径误给候选，再验证上述行为，已加入普通入口。`confirmed` 是历史字段名，仅指同一批观察得到的诊断候选，始终 `bindingVerified=false`；不能解除产品已有的冲突或直接生成改名/上传计划。新的试验源码指纹包含裁框实际依赖，不覆盖旧年度检测报告。实图对照必须记录所有完整读数，不能仅输出成功的两个视图。

检测式年度脚本续跑使用 schema 2 的结果身份和内容摘要：原图哈希必须现场重算，日期、源码、模型及语言数据指纹须一致，两个引擎/两个边距的读取记录完整且没有异常。旧格式、损坏或不匹配记录先保留为 `.prior-*`，再生成新的当前记录，不覆盖旧冻结轮次。区域预算耗尽的完整测量可以作为未决缓存，但不能带确认候选；读取失败与空读数分开计数。`detection-cache-regression.mjs` 已纳入普通入口；`detection-cache-integration.mjs` 以生成图片和实际模型调用正式审计 CLI，验证有效续跑不重写、错误版本被拒绝并保留、原图同名替换不能被缓存掩盖，已纳入 Windows 全套。它检验的是离线证据完整性，不是生产识别或归属通过。

便携来源回归另核对旋正图像尺寸、实际裁框坐标及 `physicalCodeExtent=unverified`；不能从旧 `fullCodeValidated` 名称推断物理字段已完整读取。`tests/experiments/code-window-context-regression.mjs` 已纳入普通入口，测试局部上下文扩展、检测框回投、预算/异常、边界关系不得解除冲突。该助手仅为诊断，不由产品赋号路径调用。实际对照需保留所有检测/预处理视图及不同引擎读数，零完整码与引擎错误分开；不得只统计某个成功视图，更不能将候选检测框当完整字符范围证明。

`tests/experiments/db-map-reader.mjs` 仅提取与产品相同预处理/固定模型的 DB 概率图。`node tests/experiments/db-map-reader-smoke.mjs [APP_ROOT]` 显式加载真实模型，比较四种合成输入与产品连通域结果，缺模型/依赖或错误哈希必须失败。它不是照片验收，不进入产品赋号路径。

`tests/experiments/db-reference-geometry.py` 是 Apache-2.0 的 PaddleOCR 2.7 参考几何适配：轮廓、最小旋转矩形、fast score、unclip、透视裁图；不自动旋转竖行，超过候选预算直接拒绝，返回 `physicalCodeExtentVerified=false` 和 `mayClearCodeConflict=false`。显式测试命令为 `python -B tests/experiments/db-reference-geometry-tests.py`。运行前将经过验证的隔离依赖目录放入本进程 `PYTHONPATH`；本轮使用 opencv-python-headless 4.13.0.92 和 pyclipper 1.3.0.post6，没有安装到全局或产品运行时，缺依赖不得跳过伪装通过。

真实几何 A/B 必须使用相同输入像素与同一次概率图，保留旧/新路径所有视图、相反读数、无读数和异常；原件前后哈希核验，地图、裁图、OCR 编号与试验输出仅放本机私有目录，不进 Git 或网络。无既有自动窗口的照片单列未测试。旋转框、严格完整码语法、两个引擎同号，都不证明物理字段完整、编号正确或订单归属；本轮实图已观察到双引擎同号但前缀错误。不能将该候选接入赋号，或据它删除先前冲突。
