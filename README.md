# pi-tool-offloading

用于 Pi 的上下文卸载扩展：将过大的工具结果移到会话 sidecar 文件中，在需要时可用原生 `read` 取回，并在结果被模型使用后从后续请求中移除正文。

## Context Offloading（上下文卸载）

一次 `grep -rn`、`bash` 日志或大型文件读取常会产生数千 Token。模型在当轮根据结果完成决策后，这些内容通常不再影响后续推理；但只要仍留在 `messages` 历史中，后续每次 API 调用都会再次携带、计费并参与 attention，持续挤占上下文空间。

Context Offloading 不是压缩或摘要，而是搬家：把完整原文持久化到本地，只在 Context 中保留可恢复的引用。它特别适合返回大且难以可靠复现的结果，例如 `bash` 输出；`read` 的结果也会被快照，以免源文件之后发生变化。

## 具体实现

本扩展只处理超过 **4 KiB** 的纯文本内建 `bash` 与 `read` 结果；其他工具、图片和混合内容保持不变。

1. `tool_result` 钩子将完整文本写入会话 JSONL 同目录的 `offloads/<session-id>/<uuid>.txt`。目录权限为 `0700`，文件权限为 `0600`。
2. 大型 `bash` 结果会立刻替换为引用：包含绝对路径、字节数、首尾各 1 KiB 的预览，以及 `read(path=...)` 取回提示。
3. 普通大 `read` 结果会完整保留一次（`hydrated`），同时写入快照，让模型能直接分析刚读到的内容。
4. 当该 `read` 结果之后已有 assistant 消息，`context` 钩子会在下一次发送给模型前将其投影为引用（`reference`），回收正文占用。
5. 若读取的本来就是 sidecar，扩展复用该文件而不再复制；模型需要旧内容时，直接调用原生 `read` 即可。

引用结果大致如下：

```text
[OFFLOADED] 16384 bytes saved to /path/to/offloads/<session-id>/<uuid>.txt
Use read(path="/path/to/offloads/<session-id>/<uuid>.txt") to retrieve it.

<首尾预览>
```

卸载结果会在 `details.piToolOffloading` 中附带元数据，同时保留原有 `details`：

```ts
{
  path: string,
  bytes: number,
  state: "reference" | "hydrated",
}
```

- `hydrated`：Context 和 sidecar 都保留完整正文，供模型首次使用。
- `reference`：Context 仅保留引用和预览，完整正文仍在 sidecar 中。

## 效果与边界

- 已消费的大型 `read` 结果不再在每轮请求重复占用 Context；大型 `bash` 结果从一开始就以引用形式存在。
- Sidecar 会一直保留，需手动清理；不会去重、复制 fork 的文件或自动清理。
- 写入失败或 sidecar 已缺失时，扩展会保留完整结果（fail open），不隐藏数据。
- 投影只影响发送给模型的 Context，不改写会话 JSONL。
- 本扩展不延后或改写 Pi 原生 compaction，也不处理其他工具；详细取舍见 [DESIGN.md](./DESIGN.md) 和 [SPEC.zh-CN.md](./SPEC.zh-CN.md)。

## 使用

临时加载扩展：

```sh
pi --extension /absolute/path/to/pi-tool-offloading/index.ts
```

也可安装到本地 Pi，使其在后续启动时自动加载：

```sh
pi install /absolute/path/to/pi-tool-offloading/index.ts
```

大型工具输出会保存到会话 JSONL 同目录下的 `offloads/<session-id>/`，需要时请手动清理。

## 验证

```sh
node --experimental-strip-types index.test.ts
```
