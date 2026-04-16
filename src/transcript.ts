import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Text } from "@mariozechner/pi-tui";

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

const showTranscript = async (transcript: TranscriptMessage[], ctx: ExtensionCommandContext) => {
	if (!ctx.hasUI) return;

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new DynamicBorder((s: string) => theme.fg("accent", s));

		container.addChild(new Text(theme.fg("accent", theme.bold("Session Transcript")) + "  " + theme.fg("dim", "(Esc to close)"), 1, 0));
		container.addChild(border);

		for (const msg of transcript) {
			const header = theme.fg(msg.label === "You" ? "accent" : "success", theme.bold(msg.label + ":"));
			container.addChild(new Text(header + " " + msg.text, 1, 0));
		}

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "q")) {
					done(undefined);
				}
			},
		};
	});
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
