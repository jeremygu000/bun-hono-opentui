# 改动时间线 / Change Timeline

| Commit | 改动概要 / Summary |
| --- | --- |
| `556b57d` | 改善 LLM streaming/chat integration，修复输入与 stream handling，新增双语学习笔记。 / Improved LLM streaming/chat integration and added bilingual learning notes. |
| `0a41f6b` | 合并为 `POST /chat`，引入三种 strategy 和 CLI `CHAT_STRATEGY` env 配置，共享 prompt UI；新增详尽双语 refactor 文档。 / Unified `/chat` with three strategies, CLI env selection, shared prompt UI, and detailed bilingual refactor notes. |
| 未提交 / Uncommitted | 升级 workspace dependencies 和 bun.lock；修复 onEnd response deprecation，新增双语升级记录。 / Upgraded workspace dependencies and bun.lock, fixed onEnd response deprecation, and added bilingual upgrade notes. |
| 未提交 / Uncommitted | 按完整调用链拆分三个后端 strategy，简化 registry，新增双语结构说明。 / Split backend strategies into complete per-strategy flows, simplified the registry, and added bilingual layout notes. |
| 未提交 / Uncommitted | 移除重复 CLI LLM Test/Hybrid 页面和路由，通过 CHAT_STRATEGY env 选择后端 strategy。 / Removed duplicate CLI LLM Test/Hybrid pages and routes; select the backend strategy through CHAT_STRATEGY. |
