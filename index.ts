import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, normalize, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const THRESHOLD_BYTES = 4 * 1024;
const PREVIEW_BYTES = 1024;

type OffloadState = "reference" | "hydrated";

type OffloadMetadata = {
	path: string;
	bytes: number;
	state: OffloadState;
};

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMetadata(details: unknown): OffloadMetadata | undefined {
	if (!isRecord(details) || !isRecord(details.piToolOffloading)) return undefined;
	const value = details.piToolOffloading;
	if (typeof value.path !== "string" || typeof value.bytes !== "number") return undefined;
	if (value.state !== "reference" && value.state !== "hydrated") return undefined;
	return value as OffloadMetadata;
}

function withMetadata(details: unknown, metadata: OffloadMetadata): RecordLike {
	return isRecord(details)
		? { ...details, piToolOffloading: metadata }
		: { originalDetails: details, piToolOffloading: metadata };
}

function textOnly(content: Array<{ type: string; text?: string }>): string | undefined {
	if (content.length === 0 || content.some((block) => block.type !== "text" || typeof block.text !== "string")) {
		return undefined;
	}
	return content.map((block) => block.text!).join("\n");
}

function preview(text: string): string {
	if (Buffer.byteLength(text, "utf8") <= PREVIEW_BYTES * 2) return text;
	const bytes = Buffer.from(text, "utf8");
	return `${bytes.subarray(0, PREVIEW_BYTES).toString("utf8")}\n\n[... offloaded ...]\n\n${bytes
		.subarray(-PREVIEW_BYTES)
		.toString("utf8")}`;
}

export function referenceText(metadata: OffloadMetadata, text: string): string {
	return `[OFFLOADED] ${metadata.bytes} bytes saved to ${metadata.path}\n` +
		`Use read(path=${JSON.stringify(metadata.path)}) to retrieve it.\n\n` +
		preview(text);
}

function isSidecarPath(path: string): boolean {
	return normalize(path).includes(`${sep}offloads${sep}`);
}

async function writeSidecar(ctx: { sessionManager: { getSessionFile(): string | undefined; getSessionId(): string } }, text: string): Promise<OffloadMetadata | undefined> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return undefined;

	const directory = join(dirname(sessionFile), "offloads", ctx.sessionManager.getSessionId());
	const path = join(directory, `${randomUUID()}.txt`);
	try {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await chmod(directory, 0o700);
		await writeFile(path, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
		return { path, bytes: Buffer.byteLength(text, "utf8"), state: "hydrated" };
	} catch {
		return undefined;
	}
}

function isConsumedHydrated(messages: any[], index: number): boolean {
	return messages.slice(index + 1).some((message) => message.role === "assistant");
}

export function projectMessages(messages: any[]): any[] {
	return messages.map((message, index) => {
		if (message.role !== "toolResult" || !isConsumedHydrated(messages, index)) return message;
		const metadata = getMetadata(message.details);
		if (!metadata || metadata.state !== "hydrated" || !existsSync(metadata.path)) return message;
		const text = textOnly(message.content);
		if (text === undefined) return message;
		const reference = { ...metadata, state: "reference" as const };
		return {
			...message,
			content: [{ type: "text", text: referenceText(reference, text) }],
			details: withMetadata(message.details, reference),
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash" && event.toolName !== "read") return;
		const text = textOnly(event.content);
		if (text === undefined || Buffer.byteLength(text, "utf8") <= THRESHOLD_BYTES) return;

		const readPath = event.toolName === "read" && typeof event.input.path === "string" ? event.input.path : undefined;
		const existing = readPath && isSidecarPath(readPath)
			? { path: readPath, bytes: Buffer.byteLength(text, "utf8"), state: "hydrated" as const }
			: await writeSidecar(ctx, text);
		if (!existing) return; // fail open

		if (event.toolName === "read") {
			return { details: withMetadata(event.details, existing) };
		}

		const reference = { ...existing, state: "reference" as const };
		return {
			content: [{ type: "text", text: referenceText(reference, text) }],
			details: withMetadata(event.details, reference),
		};
	});

	pi.on("context", (event) => {
		return { messages: projectMessages(event.messages) };
	});
}
