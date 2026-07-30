# pi-tool-offloading

Pi extension that moves large `bash` results into session sidecars and projects consumed `read` snapshots out of every later model request.

It does not delay pi's native compaction; see [DESIGN.zh-CN.md](./DESIGN.zh-CN.md) for that accepted boundary.

Run it with:

```sh
pi --extension /absolute/path/to/pi-tool-offloading/index.ts
```

Payloads are stored beside the session JSONL in `offloads/<session-id>/`. They remain until manually removed.

Check the projection logic with:

```sh
node --experimental-strip-types index.test.ts
```
