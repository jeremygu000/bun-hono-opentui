# 改动时间线 / Change Timeline

| Commit | 改动概要 / Summary |
| --- | --- |
| `556b57d` | 改善 LLM streaming/chat integration，修复输入与 stream handling，新增双语学习笔记。 / Improved LLM streaming/chat integration and added bilingual learning notes. |
| `0a41f6b` | 合并为 `POST /chat`，引入三种 strategy 和 CLI `CHAT_STRATEGY` env 配置，共享 prompt UI；新增详尽双语 refactor 文档。 / Unified `/chat` with three strategies, CLI env selection, shared prompt UI, and detailed bilingual refactor notes. |
| `fb835dc` | 升级 dependencies，拆分 backend strategies 与专属 util，改名 provider config，移除重复 CLI 页面；新增双语记录。 / Upgraded dependencies, clarified strategy/provider layout, removed duplicate CLI pages, and added bilingual notes. |
| `d6d5ac1` | 拆分可复用 chat components，支持 reasoning/tool/error 展示，简化 textarea 并修复 scrollbox layout。 / Extracted reusable chat components with reasoning/tool/error rendering and a minimal, shrink-safe textarea layout. |
| Uncommitted | 新增 OpenRouter 免费文本模型检查与测速工具、测试和双语说明。 / Added an OpenRouter free text model availability/latency checker, tests, and bilingual documentation. |
