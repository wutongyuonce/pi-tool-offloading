# Pi Tool Offloading

Vocabulary and boundaries for the pi extension that keeps oversized `bash` and `read` results out of later model requests.

## Language

**Eligible result**: A built-in `bash` or `read` result made entirely of text blocks whose combined UTF-8 text exceeds 4 KiB. Images, mixed results, and other tools are unchanged.

**Captured bash result**: The result emitted by pi's built-in `bash` after pi has already applied native truncation. It is not raw, unlimited stdout/stderr.

**Sidecar payload**: The exact handled text stored outside the prompt at `dirname(session JSONL)/offloads/<sessionId>/<uuid>.txt`. Directories are `0700` and files `0600` on Unix-like systems.

**Reference**: Model-facing text with a 1 KiB head and tail preview, byte count, absolute sidecar path, and native `read(path=...)` instruction. `details.piToolOffloading = { path, bytes, state: "reference" }` records the same payload structurally.

**Hydrated result**: A complete tool result with a sidecar backup and `state: "hydrated"`. It is retained for one model response, then becomes eligible for projection.

**Consumed**: A hydrated tool result with at least one later assistant message. The model has therefore had one chance to use its complete content.

**Projection**: The `context` hook replaces every consumed hydrated result whose sidecar still exists with a reference in the outgoing message array. Projection is not persisted into JSONL.

**Immediate bash offload**: The `tool_result` hook stores a large bash result and immediately returns a reference. A native read of that sidecar is treated as a hydrated read result.

**Read snapshot**: The `tool_result` hook stores the exact returned text of a large normal read, including pi's selected range and truncation, but leaves the current result hydrated. A read of an existing sidecar reuses that file rather than creating a copy.

**Projection trigger**: There is no size, reserve, or pending-state trigger. Every `context` hook attempts projection; eligibility is only hydrated state, a later assistant message, and an existing sidecar.

**Compaction boundary**: The extension does not register `session_before_compact` and never cancels native compaction. Pi may compact a consumed hydrated result before the next context hook; raw JSONL and sidecars remain, but the summary may not retain the sidecar path.

**Fork sharing**: Forks retain absolute references to source sidecars and do not copy payloads. A fork is not portable without those source files.

**Fail-open persistence**: If a sidecar write fails, leave the original result unchanged; create no extension log or session entry.

**Retention**: Sidecars remain until the user deletes them. There is no garbage collector, deduplication, configuration layer, custom reader, or background process.
