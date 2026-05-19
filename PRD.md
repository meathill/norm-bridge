# NormBridge PRD v0.1

## 1. 背景

出口型制造企业在向不同国家销售电气元件时，需要确认产品、元器件、材料、证书和测试报告是否满足目标国家或地区的技术标准要求。

这些技术标准通常以 PDF 形式存在，页数多、结构复杂、引用关系密集，并且不同国家、国际标准、区域标准之间可能存在等同、引用、修改采用或版本差异。销售在制作报价单、销售清单和申报材料时，需要大量人工查阅标准、核对产品参数、确认可引用证书和识别缺口。

NormBridge 的目标不是做一个在线 SaaS 或通用标准问答系统，而是做一个本地优先的 AI Agent 应用，把技术标准 PDF 转换为可审阅、可版本化、可查询、可追溯的结构化索引，再基于该索引检查 Excel、BOM、报价单和相关证据文件。

## 2. 产品定位

NormBridge 是一个本地化 AI 标准索引工作台。

它帮助出口型制造企业把目标国家技术标准 PDF 编译为本地结构化索引，并基于该索引完成产品清单检查、报价可写性判断、缺口识别和报告生成。

核心理念：

> NormBridge 不是“问 PDF”，而是把 PDF 编译成可追溯的数据结构；后续报告只能从这个数据结构和原始引用中生成。

## 3. 目标用户

### 3.1 主要用户

- 外贸销售
- 售前工程师
- 认证/质量/合规同事

### 3.2 典型使用场景

- 销售需要判断某个产品能否写入目标国家报价单。
- 销售需要知道报价材料中应写哪些标准、证书或测试依据。
- 销售需要知道某些产品缺少哪些认证、测试报告或技术证据。
- 企业需要把目标国家标准 PDF 建立成本地可复用索引，并在团队内部同步。

## 4. 问题定义

### 4.1 当前痛点

1. 技术标准文档体量大，人工查阅耗时。
2. 标准之间存在复杂引用关系，销售难以快速判断适用范围。
3. 产品通常由多个元器件组成，不同元器件可能对应不同标准。
4. 中国标准、国际标准、目标国家标准之间可能存在等同或近似关系，但名称和版本不同。
5. 报价单或销售清单中的合规描述需要准确，不能凭经验随意填写。
6. 同一份标准被多人重复查阅，缺少可复用的结构化索引。
7. AI 问答或 RAG 难以满足稳定、客观、可复查、可审计的要求。

### 4.2 本产品要解决的问题

NormBridge 需要建立一条可逆、可复查、可审计的数据链路：

```txt
PDF -> Schema -> SQLite -> Excel/Product Query -> Report
```

其中：

- PDF 到 Schema：由 AI Agent 辅助分析技术标准结构。
- Schema 到 SQLite：由确定性程序写入本地数据库。
- Excel 到查询结果：由结构化提取、SQLite 查询和规则匹配完成。
- 查询结果到报告：报告中的所有实质性结论必须能回溯到原始文件。

## 5. 产品目标

### 5.1 v0.1 目标：Can Quote

回答销售最直接的问题：

- 这个产品现在能不能写进报价单？
- 如果可以写，应该引用哪些标准、条款、证书或测试依据？
- 如果不能确定，缺少哪些证据？
- 如果不适用或不满足，原因是什么？
- 报告中的每个判断能否 100% 找到引用原文？

### 5.2 后续目标：How to Qualify

回答更进一步的问题：

- 如果销售想卖某个利润更高但当前证据不足的产品，需要补哪些认证？
- 是否存在等效认证或可转换的认证路径？
- 哪些证书、测试报告或标准优先级最高？
- 认证路径的成本、周期和风险如何？

该能力涉及认证制度、监管规则、互认关系、认证机构要求等更复杂信息，暂不纳入 v0.1。

## 6. 非目标

v0.1 不做以下事情：

- 不做 SaaS。
- 不建设公开标准库。
- 不用 RAG 作为事实查询基础。
- 不自动宣称产品已获得目标国认证。
- 不替代认证机构、律师或合规工程师的最终判断。
- 不承诺一次性支持所有国家、所有行业、所有标准格式。
- 不在没有原文引用的情况下生成合规结论。

## 7. 核心原则

### 7.1 本地优先

用户创建一个本地项目目录，标准 PDF、提取结果、索引、SQLite 数据库、审阅记录和报告都保存在该目录中。

该目录可以由用户自行通过 Git、网盘、NAS 或企业内部工具同步。

### 7.2 可逆与可复查

任何一步生成的结果都必须可反查：

- Schema 字段能回到 PDF 原文。
- SQLite 记录能回到 Schema artifact。
- 查询结果能回到 SQLite 记录和源文件引用。
- 报告结论能回到标准原文、页码、条款和输入文件位置。

### 7.3 有引用才有结论

报告中的任何实质性判断必须有来源引用。

没有来源引用的内容只能作为：

- 未确认项
- 待人工审核项
- 缺证项
- 风险提示

不能作为正式结论输出。

### 7.4 AI 负责建模，规则负责判断

AI Agent 主要负责：

- 理解 PDF 结构。
- 识别目录、条款、表格、引用关系。
- 抽取候选 requirement。
- 从 Excel 或规格书中抽取候选产品属性。
- 生成可读报告草稿。

确定性系统负责：

- Schema 校验。
- SQLite 写入和查询。
- 数值比较。
- 单位换算。
- 引用完整性检查。
- 报告输出前的 citation gate。

## 8. 用户流程

### 8.1 创建标准索引项目

1. 用户打开 Electron App。
2. 用户选择或创建一个本地项目目录。
3. 系统生成项目配置文件。
4. 用户拖入目标国家技术标准 PDF。
5. AI Agent 启动标准分析任务。
6. 系统生成 Schema artifact 和 SQLite 数据库。
7. 用户审阅低置信度项、缺失项、冲突项。
8. 用户确认后，标准索引进入可使用状态。

### 8.2 检查产品 Excel

1. 用户拖入 Excel、BOM 或报价单。
2. 系统提取产品行、产品名称、型号、关键参数和描述字段。
3. 系统将产品属性写入本地 artifact 和 SQLite。
4. 系统基于标准索引进行查询和规则匹配。
5. 系统输出产品-标准匹配结果。
6. 用户审阅结果。
7. 系统导出合规矩阵或报价附件报告。

## 9. 本地项目目录建议

```txt
project/
  normbridge.project.json

  sources/
    standards/
      target-standard.pdf
    inputs/
      quotation.xlsx
    evidence/
      certificates/
      test-reports/
      product-specs/

  artifacts/
    pdf-pages.json
    pdf-text.json
    pdf-tables.json
    standard-schema.v0.1.json
    excel-extraction.json
    match-query-results.json

  db/
    normbridge.sqlite

  review/
    unresolved-items.json
    human-overrides.jsonl
    audit-log.jsonl

  reports/
    compliance-matrix.xlsx
    compliance-report.docx
```

## 10. 核心数据链路

### 10.1 PDF -> Schema

输入：

- 原始 PDF

输出：

- 页面文本
- 页码映射
- 条款树
- 表格抽取结果
- 引用标准列表
- 候选 requirement
- 待审核项

要求：

- 保留 PDF 文件 hash。
- 保留页码和原文片段。
- 尽量保留文本 offset 或页面坐标。
- 低置信度结果必须进入 review 队列。

### 10.2 Schema -> SQLite

输入：

- 标准 Schema artifact

输出：

- SQLite 数据库

要求：

- SQLite 是查询层，不是唯一事实来源。
- 每条数据库记录必须能回到 artifact。
- 每条 requirement 必须能回到 citation。

### 10.3 Excel -> 查询 -> 报告

输入：

- Excel、BOM 或报价单

输出：

- 产品属性 artifact
- 查询结果 artifact
- 合规矩阵
- 报告文件

要求：

- Excel 中提取出的字段必须保留 sheet、row、column 或 cell 引用。
- 产品判断必须同时引用产品输入来源和标准来源。
- 报告导出前必须执行 citation gate。

## 11. v0.1 功能需求

### 11.1 项目管理

- 创建本地项目目录。
- 打开已有项目目录。
- 显示项目内标准、输入文件、报告和审阅状态。
- 记录项目配置和版本信息。

### 11.2 标准 PDF 导入

- 支持拖入 PDF。
- 记录文件名、路径、hash、导入时间。
- 判断 PDF 是否为文本型或扫描型。
- 对扫描型 PDF 标记 OCR 需求。

### 11.3 标准结构分析

- 提取目录。
- 提取章节层级。
- 提取条款编号和标题。
- 提取正文。
- 提取表格。
- 提取附录。
- 识别 normative reference。
- 识别疑似强制性要求。

### 11.4 Schema 生成

- 生成标准级 metadata。
- 生成 clause tree。
- 生成 requirements 列表。
- 生成 references 列表。
- 生成 citations 列表。
- 生成 unresolved review items。

### 11.5 人工审阅

- 展示条款树。
- 展示 requirement 与来源原文。
- 展示低置信度项。
- 支持用户确认、修改、忽略或标记待处理。
- 记录人工修改日志。

### 11.6 SQLite 查询库

- 将已确认或待确认 Schema 写入 SQLite。
- 支持按标准、条款、产品类别、关键词、引用关系查询。
- 支持追溯到 citation。

### 11.7 Excel/BOM 导入

- 支持拖入 Excel。
- 识别 sheet。
- 识别表头。
- 提取产品行。
- 提取产品型号、名称、类别、描述和关键参数候选。
- 保留单元格来源。

### 11.8 产品匹配

- 基于产品属性查询适用 requirement。
- 输出匹配状态：
  - 可写入报价单
  - 缺少证据
  - 需要人工确认
  - 不适用
  - 存在冲突
  - 未能判断
- 每个状态必须有引用来源或明确说明缺失原因。

### 11.9 报告生成

- 生成产品-标准匹配矩阵。
- 生成缺证清单。
- 生成待人工确认清单。
- 生成报价附件草稿。
- 报告中每个实质性判断必须包含引用。

## 12. Agent/Skill 设计

### 12.1 Manager Agent

负责任务编排：

- 创建分析计划。
- 调用各 skill。
- 追踪任务状态。
- 汇总结果。
- 将低置信度项送入人工审阅。

### 12.2 PDF Intake Skill

负责：

- 识别 PDF 类型。
- 提取基础 metadata。
- 建立页码映射。
- 判断是否需要 OCR。

### 12.3 Layout Parser Skill

负责：

- 识别标题、正文、页眉页脚。
- 识别表格、脚注、附录。
- 产出页面级结构化数据。

### 12.4 Clause Compiler Skill

负责：

- 编译条款树。
- 识别条款编号。
- 建立父子层级。
- 保留条款到原文的引用。

### 12.5 Requirement Extractor Skill

负责：

- 从条款中抽取候选强制性要求。
- 识别适用对象、条件、参数、测试方法和证据要求。
- 标记置信度和审阅状态。

### 12.6 Table Normalizer Skill

负责：

- 把技术参数表转为结构化数据。
- 识别单位、阈值、范围、等级和条件。
- 标记复杂或无法解析表格。

### 12.7 Reference Resolver Skill

负责：

- 抽取引用标准。
- 识别引用条款。
- 建立标准之间的引用关系。
- 标记可能的等同、采用、替代或版本关系候选。

### 12.8 Product Sheet Parser Skill

负责：

- 解析 Excel/BOM。
- 提取产品行和候选属性。
- 保留单元格来源。

### 12.9 Compliance Matcher Skill

负责：

- 基于 SQLite 查询和规则进行匹配。
- 输出匹配状态、证据来源和缺口。
- 不直接生成无来源结论。

### 12.10 Report Writer Skill

负责：

- 将查询结果转为人类可读报告。
- 保持每个结论的引用。
- 输出合规矩阵和报价附件。

## 13. 初始 Schema 假设

以下字段为 v0.1 设计假设，后续需要结合真实标准、销售流程和业务专家反馈调整。

### 13.1 Standard

- id
- title
- country_or_region
- version
- publication_date
- source_file
- source_hash
- scope
- status

### 13.2 Clause

- id
- standard_id
- clause_no
- title
- parent_clause_id
- page_start
- page_end
- raw_text
- citation_ids
- review_status

### 13.3 Requirement

- id
- standard_id
- clause_id
- subject
- applies_to
- condition
- requirement_text
- parameter_name
- operator
- value
- unit
- test_method
- evidence_required
- severity
- citation_ids
- confidence
- review_status

### 13.4 Reference

- id
- from_standard_id
- from_clause_id
- referenced_standard_code
- referenced_clause
- relation_type
- citation_ids
- review_status

### 13.5 Citation

- id
- source_id
- source_hash
- page
- clause_no
- text_start
- text_end
- bbox
- quote

### 13.6 Product Attribute

- id
- product_id
- attribute
- value
- unit
- source_file
- sheet
- cell
- confidence
- review_status

### 13.7 Match Result

- id
- product_id
- requirement_id
- status
- reason
- product_source_ids
- standard_citation_ids
- review_status

## 14. 报告规则

### 14.1 允许输出的判断

- 可写入报价单
- 可写入但需要限定描述
- 缺少证据
- 需要人工确认
- 不适用
- 存在冲突
- 未能判断

### 14.2 禁止输出的判断

在没有足够证据和引用时，禁止输出：

- 已认证
- 完全合规
- 一定满足目标国要求
- 可替代某认证
- 与某标准完全等同

### 14.3 Citation Gate

报告导出前必须检查：

- 每个实质性判断是否至少引用一个标准原文 citation。
- 每个产品相关判断是否引用输入文件来源。
- 每个缺证判断是否说明缺少的证据类型。
- 无来源判断必须降级为待审核项。

## 15. MVP 验收标准

建议使用一个真实目标国家标准 PDF 和一个真实 Excel 报价模板进行验证。

v0.1 验收标准：

- 能导入一份标准 PDF。
- 能生成条款树。
- 能抽取引用标准列表。
- 能抽取候选 requirement。
- 能生成 SQLite 查询库。
- 能导入一个 Excel 产品清单。
- 能生成产品-标准匹配矩阵。
- 报告中的每个实质性判断都能回到原文引用。
- 低置信度或无引用项不会被当作正式结论输出。
- 人工可以审阅并修正抽取结果。

## 16. 技术建议

### 16.1 应用形态

- Electron 桌面应用。
- 本地项目目录存储。
- 本地 SQLite。
- 本地 artifact 文件。
- AI Agent 通过 OpenAI Agents SDK 编排。

### 16.2 数据存储

- 原始文件不可修改。
- Artifact 使用 JSON 或 JSONL。
- 查询层使用 SQLite。
- 人工修改使用 append-only audit log。

### 16.3 同步方式

NormBridge 不内置团队云同步。

用户可以自行使用：

- Git
- 网盘
- NAS
- 企业内部文件同步工具

## 17. 风险与待验证问题

### 17.1 标准版权

标准 PDF 可能受版权保护。产品应按用户本地上传、本地使用、本地索引处理，不建设公共标准库，不再分发原文。

### 17.2 OCR 和版面复杂度

扫描件、双栏排版、跨页表格、脚注、附录和图形化表格会显著影响抽取质量。

### 17.3 Schema 适用性

当前 Schema 只是初始假设，需要通过真实标准文档和真实业务流程验证。

### 17.4 认证路径复杂性

等效认证、互认规则、认证机构要求和监管实践比技术标准更复杂，建议后续版本单独建模。

### 17.5 责任边界

产品必须明确区分：

- 标准原文事实
- 系统结构化抽取
- AI 推断
- 人工确认
- 报告建议
- 最终认证结论

## 18. 后续版本方向

### 18.1 v0.2

- 多标准交叉引用图。
- 标准版本差异对比。
- 更完善的人工审阅工作台。
- 产品证书和测试报告导入。

### 18.2 v0.3

- 认证路径推荐。
- 等效标准和认证关系管理。
- 缺证补齐优先级建议。
- 成本、周期、风险评估。

### 18.3 v1.0

- 面向特定行业和国家的稳定模板。
- 企业内部团队协作流程。
- 标准索引版本管理。
- 审计包导出。

