import { describe, it, expect } from "vitest";
import { buildTranscript } from "./transcript.js";

describe("buildTranscript", () => {
	it("returns empty for empty entries", () => {
		expect(buildTranscript([])).toEqual([]);
	});

	it("extracts user messages", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
		];
		const result = buildTranscript(entries as any);
		expect(result).toEqual([{ label: "You", text: "hello" }]);
	});

	it("extracts assistant messages", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "world" }] } },
		];
		const result = buildTranscript(entries as any);
		expect(result).toEqual([{ label: "Assistant", text: "world" }]);
	});

	it("extracts askUser tool calls as questions", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", name: "askUser", arguments: { question: "Pick one:" } },
						{ type: "text", text: "Let me ask" },
					],
				},
			},
		];
		const result = buildTranscript(entries as any);
		expect(result).toEqual([
			{ label: "Assistant", text: "Let me ask" },
			{ label: "Assistant", text: "Pick one:" },
		]);
	});

	it("extracts askUser tool results as user answers", () => {
		const entries = [
			{
				type: "message",
				message: { role: "toolResult", toolName: "askUser", content: "User selected option: Yes" },
			},
		];
		const result = buildTranscript(entries as any);
		expect(result).toEqual([{ label: "You", text: "Yes" }]);
	});

	it("skips non-message entries", () => {
		const entries = [{ type: "tool_result", message: { role: "user" } }];
		expect(buildTranscript(entries as any)).toEqual([]);
	});
});
