# NormBridge 部署 / 运行指南

> 本文档面向 v0.1 dev 验证阶段。打包分发（macOS .dmg / Windows .exe / Linux AppImage）
> 留到 v0.2 再做。

## 1. 环境准备

- macOS 12+ / Windows 11 / Linux x64
- Node.js ≥ 22.12（推荐 24+，仓库已经在 Node 26 上验证）
- pnpm 10+
- 任一 OpenAI 兼容的 LLM 服务：OpenAI、DeepSeek、阿里通义千问、Azure OpenAI、
  OpenRouter、本地 vLLM 等

## 2. 拉取与安装

```bash
git clone https://github.com/meathill/norm-bridge.git
cd norm-bridge
pnpm install
```

如果 `esbuild` / `electron` 的 postinstall 没自动跑（pnpm 11 默认拦截构建脚本），
执行：

```bash
pnpm approve-builds --all
```

## 3. 配置 LLM

把仓库根目录的 `.env.example` 复制为 `.env`，填入你自己的 key：

```bash
cp .env.example .env
$EDITOR .env
```

最少要填：

```env
OPENAI_API_KEY=sk-...
```

可选项见 `.env.example` 注释。常见组合：

### OpenAI 官方

```env
OPENAI_API_KEY=sk-...
NORMBRIDGE_AGENT_MODEL=gpt-4.1-mini
```

### DeepSeek

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com/v1
NORMBRIDGE_AGENT_MODEL=deepseek-chat
```

### 阿里通义千问（兼容模式）

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
NORMBRIDGE_AGENT_MODEL=qwen-plus
```

### Azure OpenAI

```env
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://<resource>.openai.azure.com/openai/deployments/<deployment>
NORMBRIDGE_AGENT_MODEL=<deployment-name>
```

## 4. 启动

```bash
pnpm dev
```

应用启动后会自检 LLM 运行时：

- 绿色「LLM 已就绪」 → 显示模型、endpoint（如果有自定义）、key 后四位
- 红色「LLM 配置未就绪」 → 显示 `MissingOpenAiConfigError` 详情。修 .env 后重启 app

修改 `.env` 必须重启 app 才生效（dotenv 只在启动时读一次）。

## 5. 验收路径（v0.1 demo）

1. **打开应用**，看到聊天界面
2. **新建工作目录**（chat 空状态卡片里的「新建工作目录」按钮）
3. **第一条系统消息**确认项目已打开 + LLM 已就绪
4. **拖入一份标准 PDF** 到下方输入框 → 会先做 inspection（页数、文本层、加密检测）
5. **点击「开始分析」** → chat 流式显示抽取与编译进度 → 完成时统计「N 条款 / M 要求」
6. **输入产品文本**（例如 `1A 微型断路器` 或 `RCBO 1.5kV insulation`） → LLM 把它展开为
   关键词 + SQLite 命中 → 卡片展示相关 requirement + 页码 + 系统打开按钮
7. **点「在系统中打开 PDF」** → 用你系统默认的 PDF 阅读器打开原文，肉眼核对页码

## 6. 故障排查

| 现象 | 可能原因 | 修法 |
|---|---|---|
| 启动横幅红色「LLM 配置未就绪」 | `.env` 缺 `OPENAI_API_KEY` 或拼写错 | 检查 .env，重启 |
| 编译 / 搜索失败 `404 <html>...openresty...` | endpoint 不支持 `/v1/responses` 新接口 | 默认已经是 `chat_completions`；若你显式设过 `OPENAI_API_STYLE=responses` 就改回来 |
| 分析 / 搜索一直转圈 | 自定义 `OPENAI_BASE_URL` 不通或限流 | 命令行直接 curl 一下 endpoint；检查代理 |
| `agent_output_invalid` | 模型不支持 structured output / json_schema | 换成 `gpt-4.1-mini` / `gpt-4o-mini` / `deepseek-chat` / Azure 上启用 structured outputs 的部署 |
| 编译卡在 clauses 阶段返回 token / context 错误 | PDF 太长一次塞不下模型上下文 | 调小 `NORMBRIDGE_MAX_BLOCKS_PER_PROMPT`（默认 2000）或换支持更长 context 的模型；v0.1 不分片 |
| 拖入 PDF 后 inspection 显示「无文本层」 | 是扫描件 | v0.1 不做 OCR，需要先用 Adobe / `ocrmypdf` 跑过文字层 |
| 编译完成但 clauses 数量很少 | 截断生效（chat 里有黄色警告） | 看警告里的截断比例；调高 `NORMBRIDGE_MAX_BLOCKS_PER_PROMPT` 或换大上下文模型 |
| 搜索返回 0 条 | 关键词没命中要求文本 | 看上面卡片里的 token 列表，换一种描述 |

## 7. 数据存储

所有内容都在你选定的工作目录里：

```
project/
├── normbridge.project.json
├── sources/standards/<sha256>-<原文件名>      # 原始 PDF（复制，sha256 去重）
├── artifacts/
│   ├── standards/<sourceId>/
│   │   ├── pages.json                          # 页面级元信息
│   │   ├── text-blocks.json                    # 全部文本块 + bbox + reading order
│   │   ├── clauses.json
│   │   ├── requirements.json
│   │   ├── citations.json
│   │   ├── references.json
│   │   └── standard-schema.v0.1.json           # 编译结果总包
│   └── jobs/<jobId>/{plan.json, events.jsonl}  # 任务追踪
├── db/normbridge.sqlite                        # 查询层；artifact 可重建
└── review/                                     # 预留人工审阅记录
```

Git / 网盘 / NAS 自行同步。`.env` 不要进版本库。
