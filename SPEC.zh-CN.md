# pi 工具结果上下文卸载规格

## 问题

大型工具结果在模型已使用后仍占用后续 Context。pi 原生 compaction 能摘要历史，但会丢失细节。本 extension 将可恢复文本放进 session sidecar，并在模型有一次完整使用机会后，后续请求只携带 reference。

## 范围

仅处理内建 `bash`、`read` 的纯文本结果，合并 UTF-8 文本大于 4 KiB。其他工具、图片、混合结果保持不变。

## 用户故事

1. 作为用户，我希望大 bash 输出首次就成为 preview 与路径，从而不主导 Context。
2. 作为用户，我希望大 read 输出完整保留给下一次模型响应，从而模型能直接分析刚读取的内容。
3. 作为用户，我希望 read 结果被快照，从而源文件后来变化也不改变模型当时看到的历史。
4. 作为用户，我希望模型使用过完整 read 后，后续请求自动只带 reference，从而尽早回收 Context。
5. 作为用户，我希望模型需要旧正文时直接原生 `read(sidecar path)`，而不是依赖自定义工具。
6. 作为用户，我希望 sidecar 回读复用原文件，不递归复制。
7. 作为用户，我希望 sidecar 缺失或写入失败时完整结果不被隐藏。
8. 作为用户，我希望 fork 共享源 sidecar，接受它不具可移植性。
9. 作为用户，我希望原生 compaction、手动 compact 与 overflow recovery 不被 extension 改变。

## 实现决策

- `tool_result` hook：大 bash 写 sidecar 后立即返回 `reference`；大普通 read 写快照但保留完整 `hydrated`；`read(sidecar path)` 复用该 sidecar 并保持 hydrated。
- `context` hook：每次请求前投影全部符合条件的 hydrated result。条件只有：`state === "hydrated"`、其后已有 assistant 消息、sidecar 仍存在。
- reference 的 `content` 含首/尾各 1 KiB preview、绝对路径、字节数和原生 `read(path=...)` 提示；`details.piToolOffloading` 含 `{ path, bytes, state }`，并保留原有 details 与错误状态。
- Sidecar 位于 `dirname(session JSONL)/offloads/<session-id>/<uuid>.txt`；目录 `0700`、文件 `0600`；UUID 命名、永久保留、无去重与自动清理。
- 写入失败 fail open：原 result 原样进入 Context 和 JSONL，不新建插件日志。
- Projection 只改写某次发送给模型的 messages，不改写 JSONL。
- 不注册 `session_before_compact`，不使用 Context usage、reserve、token 估算或 `projectionPending`，也不取消 pi 原生 compaction。

## Compaction 取舍

pi 可能在 assistant 使用 hydrated result 后、下一次 context hook 前运行原生 compaction。此时结果会由 pi 摘要，插件不会先投影。原始 JSONL 和 sidecar 仍存在，但摘要未必含 sidecar 路径；本版本接受此限制，以换取简单、无 token 估算依赖的实现。

## 测试决策

- 验证 bash reference、普通 read hydrated、sidecar 回读复用。
- 验证 consumed hydrated 在没有 usage 信息时仍由 context hook 投影。
- 验证未消费或 sidecar 缺失的 hydrated 结果保持完整。
- 验证 details、错误状态、权限与 fail-open 行为。
- 不需要模型 provider、网络或交互式 pi session。

## 不做

- 原生截断前的 bash 捕获、其他工具或多模态结果。
- `read_offload`、fork 复制、清理、配置、去重、token 估算、compaction deferral、JSONL 改写。
