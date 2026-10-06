import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { TranscriptViewer } from "./viewer.js";

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
};

type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		toolName?: string;
		content?: unknown;
	};
};

const extractText = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const part of content) {
		if (part && typeof part === "object") {
			const block = part as ContentBlock;
			if (block.type === "text" && typeof block.text === "string") {
				parts.push(block.text);
			}
		}
	}
	return parts.join("\n").trim();
};

export interface TranscriptMessage {
	label: string;
	text: string;
}

export const buildTranscript = (entries: SessionEntry[]): TranscriptMessage[] => {
	const messages: TranscriptMessage[] = [];

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message?.role) continue;

		const { role, content, toolName } = entry.message;

		if (role === "toolResult" && toolName === "askUser") {
			let text = extractText(content);
			if (text) {
				text = text.replace(/^User selected (option|custom answer):\s*/i, "");
				messages.push({ label: "You", text });
			}
			continue;
		}

		if (role !== "user" && role !== "assistant") continue;

		const text = extractText(content);
		if (text) messages.push({ label: role === "user" ? "You" : "Assistant", text });

		if (role === "assistant" && Array.isArray(content)) {
			for (const block of content) {
				if (block && typeof block === "object") {
					const b = block as ContentBlock;
					if (b.type === "toolCall" && b.name === "askUser" && b.arguments?.question) {
						messages.push({ label: "Assistant", text: String(b.arguments.question) });
					}
				}
			}
		}
	}

	return messages;
};

export function takeLast(messages: TranscriptMessage[], count: number): TranscriptMessage[] {
	if (count >= messages.length) return messages;
	return messages.slice(-count);
}

const showTranscript = async (transcript: TranscriptMessage[], ctx: ExtensionCommandContext) => {
	if (!ctx.hasUI) return;

	await ctx.ui.custom(
		(tui, theme, _kb, done) => {
			const content = (width: number) => {
				const lines: string[] = [];
				for (const msg of transcript) {
					const header = theme.fg(msg.label === "You" ? "accent" : "success", theme.bold(msg.label + ":"));
					lines.push(...new Text(header + " " + msg.text, 1, 0).render(width));
				}
				return lines;
			};

			return new TranscriptViewer({
				title: "Session Transcript",
				content,
				theme,
				getTerminalSize: () => ({ rows: tui.terminal.rows, columns: tui.terminal.columns }),
				requestRender: () => tui.requestRender(),
				onClose: () => done(undefined),
			});
		},
		{
			overlay: true,
			overlayOptions: { width: "85%", maxHeight: "90%", anchor: "center" },
		},
	);
};

export function registerTranscript(pi: ExtensionAPI) {
	pi.registerCommand("transcript", {
		description: "Show session transcript (user + assistant messages only)",
		handler: async (_args, ctx) => {
			const branch = ctx.sessionManager.getBranch();
			const transcript = buildTranscript(branch);

			if (transcript.length === 0) {
				if (ctx.hasUI) ctx.ui.notify("No messages in this session", "warning");
				return;
			}

			await showTranscript(transcript, ctx);
		},
	});
}
