# 大型本地行识别对照（仅试验）

使用 PP-OCRv5 中文 server 行识别模型，与当前英文 mobile 行识别器读取完全相同的已有自动裁图。`server` 是模型规模名称：实际用本机 CPU，不调用服务器、不上传照片。固定来源为 [RapidAI v3.9.2 清单](https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/default_models.yaml)，模型 SHA-256 `e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a`；只存私有 TEMP，不加入产品依赖或 Git。

预处理参照 [同版本行识别代码](https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/ch_ppocr_rec/main.py)：48 像素高，BGR、CHW、[-1,1]、右侧零填充，动态宽最少 320、上限 2048。使用 sharp linear 插值，不冒称与 OpenCV 逐像素一致。模型内嵌字典由已验证的 ONNX 元数据解析器提取；不复用英文 436 字表，不把模型得分当正确概率。

普通生成测试：`node --test tests/experiments/server-code-reader-regression.mjs`。实际模型烟雾及实图必须显式提供经哈希验证的模型，未安装是失败而非通过。先固定代码及全部输入裁图哈希，再读全部视图，不根据旧号或成功结果选择框，不修改已有失败报告。对照保留所有不同前缀/末号、空读数及异常，输出只有编号和哈希/计数，不保存客户正文。

额外的 `literalCodeObservations` 只测量原样数字串：保留行边界，不把字母转换成数字。它与现用解析结果并列记录，不替换产品、删除既有冲突或授予绑定权限。单个模型的读数改善、同家族模型一致及独立引擎同意都不等于完整字段、原打印修订/订单绑定。无既有自动编号窗口的照片不在这一局部对照内；此项不能当作场景识别或全年端到端验收。
