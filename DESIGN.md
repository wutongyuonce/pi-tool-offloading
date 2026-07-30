# pi-tool-offloading 设计方案

## 目标与范围

extension 处理超过 4 KiB 的纯文本内建 `bash` 与 `read` 结果：把可恢复正文保存到 session sidecar，并在模型已经有一次使用机会后，不再把完整正文带入后续请求。

它不改写 append-only session JSONL；sidecar 之外的原始结果仍在 JSONL 中。其他工具、图片及混合文本/图片结果不处理。

## 核心概念

- **Sidecar（旁路文件）**：工具结果原文的独立文本文件。
- **Reference（引用结果）**：模型看到的紧凑文本，含首 1 KiB、尾 1 KiB、字节数、绝对路径及原生 `read(path=...)` 提示。
- **Hydrated（展开态）**：完整正文仍在本次模型 Context 中，同时已有 sidecar 快照。
- **Projection（投影）**：`context` hook 在发送请求前，临时把符合条件的 hydrated result 换成 reference；不改写 JSONL。

`content` 是模型实际阅读的 reference 文本。`details` 保留原工具 metadata，并增加：

```ts
details.piToolOffloading = {
  path: string,
  bytes: number,
  state: "reference" | "hydrated"
}
```

插件不改变工具原有的错误状态。

## Sidecar

```text
<session-directory>/
  <timestamp>_<session-id>.jsonl
  offloads/
    <session-id>/
      <uuid>.txt
```

- UUID 文件名；目录 `0700`、文件 `0600`（Unix/macOS）。
- 写入失败时 fail open：不改写工具结果，也不额外记日志。
- 不做去重、自动清理或配置；用户自行删除。
- fork 不复制 sidecar。fork transcript 保留源 session 的绝对路径，因此源 sidecar 被移走或删除后，fork 也不能再读取它。

## 工具生命周期与 hook

| 来源 | `tool_result` hook | 后续 `context` hook |
| --- | --- | --- |
| 大 `bash` | 保存 pi 已原生截断的结果，立刻改为 reference。 | 若模型后来原生 `read(sidecar path)`，回读结果按 `read` 规则处理。 |
| 大普通 `read` | 保存此次实际返回文本的快照，完整结果保持 hydrated。 | assistant 使用过一次后，投影为 reference。 |
| 大 `read(sidecar path)` | 复用已有 sidecar，不创建副本；完整结果保持 hydrated。 | assistant 使用过一次后，投影为 reference。 |

普通 read 快照保存的是 pi 本次返回的范围和截断结果，不是整个源文件；文件日后变化不影响历史快照。

### 已消费即投影

`context` hook 在**每一次**模型请求前运行，并调用投影。一个结果仅在同时满足以下条件时被替换：

```text
1. details.piToolOffloading.state === "hydrated"
2. 它之后至少已有一条 assistant 消息
3. 对应 sidecar 文件仍存在
```

第二条保证模型至少获得过一次完整正文：

```text
assistant 调用 read
→ tool_result hook 写 sidecar；完整结果以 hydrated 进入 Context
→ 模型下一次响应可基于完整正文推理
→ 之后出现 assistant 消息，结果成为已消费
→ 下一次模型请求的 context hook 投影为 reference
```

投影不依赖 Context usage、reserve、`projectionPending` 或 `session_before_compact`。这避免 token 估算和 compaction 延后机制的复杂性。模型第二次需要正文时，从 reference 给出的绝对路径调用原生 `read`。

若 sidecar 被用户删除，插件保留完整 hydrated result，绝不生成悬空 reference。

## 与 pi 原生 compaction 的关系

本插件**不注册** `session_before_compact` hook，也不取消或延后 pi 的自动、手动或 overflow compaction。

pi 可能在 assistant 使用 hydrated result 后、下一次 `context` hook 前执行原生 compaction。发生时，该旧结果会按 pi 自己的摘要策略处理，而不会先被插件投影；JSONL 与 sidecar 仍保留原文，但后续摘要不保证保留 sidecar 路径。这是本版本接受的取舍。

## 明确不做

- 不捕获 pi 原生截断前的无限 bash stdout/stderr。
- 不处理 `bash` / `read` 之外的工具或多模态结果。
- 不添加 `read_offload`；只用 pi 原生 `read`。
- 不复制 fork sidecar，也不做 portable fork。
- 不做自动清理、内容去重、配置系统、token 估算或 compaction deferral。
- 不替换 pi 原生 compaction summary generator，也不重写历史 JSONL。

## 测试重点

- `tool_result`：bash reference、read hydrated、sidecar 回读复用、fail open、details 与错误状态保留。
- `context`：已消费的 hydrated 投影；尚未消费或 sidecar 缺失时保留全文。
- 文件系统：路径、权限与 sidecar 写入失败。
