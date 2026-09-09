# 本地图像角色模型试验（未通过，未接入产品）

## 目的与来源

调查全图明暗/颜色无法区分前景纸张、水碗、灯阵的问题。只评估角色，不读编号、不生成上传或改名计划。模型不接收日期、文件名、历史标签或客户正文。

- 原始模型：[OpenAI CLIP 模型卡](https://github.com/openai/CLIP/blob/main/model-card.md)。模型卡要求按实际应用情境验证，不能把零样本分类能力直接当作部署保证。
- ONNX 转换：[Xenova 固定提交 6ef1ebc8b0766a7a8d11b146462c99cdf74dd22d](https://huggingface.co/Xenova/clip-vit-base-patch32/commit/6ef1ebc8b0766a7a8d11b146462c99cdf74dd22d)。89,117,001 字节图像模型、64,504,507 字节文本模型；SHA-256 与发布的 LFS 对象逐项一致。
- 读取配置：[模型预处理](https://huggingface.co/Xenova/clip-vit-base-patch32/blob/6ef1ebc8b0766a7a8d11b146462c99cdf74dd22d/preprocessor_config.json)、[分词配置](https://huggingface.co/Xenova/clip-vit-base-patch32/blob/6ef1ebc8b0766a7a8d11b146462c99cdf74dd22d/tokenizer_config.json)。四份实际依赖的哈希固定在读取器内；缺失/变化必须失败。

模型仅下载到专用本机 TEMP。没有上传照片，没有安装全局依赖或更改执行器的模型、登录、日期、入口。使用已冻结候选的 CPU ONNX 运行库。第一次沙箱下载连接超时；正常授权桌面环境完成下载与校验，未关闭 TLS。

## 实现与限制

四类各四条固定英文描述，在看真实结果前冻结。ASCII BPE 只支持这些英文描述，不接收任意客户文本；77 个 token 上限禁止截断。真实词表的标准测试句 token 与参考编号一致。文本向量逐条归一化后均值再归一化，计算图文余弦相似度。相似度不是正确概率，不设置按成功样本调整的放行阈值。

图像转 RGB、EXIF 旋正，分别读取 224×224 居中裁切和保留全画幅加白边视图；使用发布的 RGB 均值/标准差和 CHW。图像缩放使用 sharp cubic，实现并不声称与 Pillow 每像素相同。居中裁切可丢掉边缘，完整视图也可能受背景影响，因此保留两者全部类别排名。两视图一致只称诊断候选，不是两引擎或前景位置证明。

五项普通测试覆盖 BPE、非法/超长输入、完整类别及视图、有限向量、真实像素通道与 EXIF、缺模型失败、稳定源码身份。显式 `clip-role-smoke.mjs` 实际加载两份模型，验证有限/确定的结果及 token；生成纯色图不是业务识别测试。

## 首轮冻结对照

6 个完整日期（3 月 3/4/28 日、6 月 16 日、8 月 28 日、9 月 6 日），168 张照片，固定模型、描述和两视图，共 89.497 秒。原件 SHA-256 前后不变；自动赋号、生产写入均为 0。

| 历史参考 | 纸张候选 | 灯阵候选 | 水景候选 | 视图不一致 |
| --- | ---: | ---: | ---: | ---: |
| 福单 | 49 | 73 | 0 | 25 |
| 供灯 | 0 | 12 | 0 | 0 |
| 供水 | 0 | 7 | 0 | 2 |

历史名不是独立真值，这不是准确率表。但此前已经完整人工查看的水碗全景仍被两个视图一致选为灯阵，足以否决直接部署本轮方案；大幅红纸个例取得纸张候选也不能抵消失败。两视图一致不等于类别正确。没有基于这些结果反复调整描述、挑选正确视图或将人工目标加入产品。

首轮独立脚本快照与失败报告保留。其旧 `fingerprint` 包含运行时间，是轮次身份；后续工具另以不含日期/时间的源码、模型和描述指纹标识算法，并补测试。此元数据调整不重跑已有 168 张，也不篡改首轮结果。下一步应验证前景区域/物体位置及独立留出材料；本轮通用 CLIP 整图零样本方法不能替代现用角色判断。

## 显式命令

```text
node --test tests/experiments/clip-role-reader-regression.mjs
node tests/experiments/clip-role-smoke.mjs FROZEN_APP_ROOT PRIVATE_MODEL_DIR
node tests/experiments/clip-role-replay.mjs PRIVATE_ROOT PRIVATE_MODEL_DIR FROZEN_APP_ROOT YYYY-MM-DD [...]
```

回放脚本和读取器必须先复制到独立只读使用的快照；生成数据只能保存在受校验的 TEMP 子目录。整个明确日期全部照片参与，不只选择旧场景文件。不得把此试验的候选并入产品分配、全年验收或模型正确率；显式场景语义反例仍须单独运行。
