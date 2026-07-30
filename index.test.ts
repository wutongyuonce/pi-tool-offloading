import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import offloading, { projectMessages, referenceText } from "./index.ts";

const directory = mkdtempSync(join(tmpdir(), "pi-tool-offloading-"));
const payload = join(directory, "payload.txt");
writeFileSync(payload, "large result");

const hydrated = {
	role: "toolResult",
	content: [{ type: "text", text: "large result" }],
	details: { piToolOffloading: { path: payload, bytes: 12, state: "hydrated" } },
};

const projected = projectMessages([hydrated, { role: "assistant", content: [] }]);
assert.equal(projected[0].details.piToolOffloading.state, "reference");
assert.match(projected[0].content[0].text, /OFFLOADED/);
assert.equal(projectMessages([hydrated])[0], hydrated);
assert.match(referenceText({ path: payload, bytes: 12, state: "reference" }, "large result"), /read\(path=/);

const handlers: Record<string, Function> = {};
offloading({ on: (name: string, handler: Function) => { handlers[name] = handler; } } as any);
assert.equal(handlers.session_before_compact, undefined);
const contextResult = handlers.context(
	{ messages: [hydrated, { role: "assistant", content: [] }] },
	{ getContextUsage: () => undefined },
);
assert.equal(contextResult.messages[0].details.piToolOffloading.state, "reference");

rmSync(directory, { recursive: true, force: true });
console.log("pi-tool-offloading checks passed");
