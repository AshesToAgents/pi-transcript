import * as fs from "node:fs";
import * as path from "node:path";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import { type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { buildTranscript, takeLast, type TranscriptMessage } from "./transcript.js";

const SETTINGS_KEY = "sessionNamerModel";
export const SETTINGS_KEY_INTERVAL = "sessionNamerInterval";
export const SETTINGS_KEY_MAX_WINDOW = "sessionNamerMaxWindow";

const DEFAULT_INTERVAL = 4;
const DEFAULT_MAX_WINDOW = 12;

function readSettings(): Record<string, unknown> {
	const settingsPath = path.join(getAgentDir(), "settings.json");
	try {
		return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
	} catch {
		return {};
	}
}

function writeSetting(key: string, value: string): void {
	const settingsPath = path.join(getAgentDir(), "settings.json");
	const settings = readSettings();
	settings[key] = value;
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function getConfiguredModel(): string | undefined {
	const settings = readSettings();
	const value = settings[SETTINGS_KEY];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getNamingInterval(): number {
	const settings = readSettings();
	const value = settings[SETTINGS_KEY_INTERVAL];
	if (typeof value === "number" && value >= 1) return value;
	return DEFAULT_INTERVAL;
}

export function getMaxWindow(): number {
	const settings = readSettings();
	const value = settings[SETTINGS_KEY_MAX_WINDOW];
	if (typeof value === "number" && value >= 1) return value;
	return DEFAULT_MAX_WINDOW;
}

const INITIAL_NAMING_PROMPT = [
	"Generate a name for this coding session that would help find it among dozens of other sessions.",
	"Focus on the SPECIFIC outcome or change — not a list of topics touched.",
	"Include distinguishing technical details that make the work unique.",
	"Reflect the PHASE of work — if only planning/designing happened, say so. If implementation was done, focus on what was built.",
	"Bad: 'DKIM validation implementation with schema model form and tests' (vague topic list)",
	"Good: 'Add DKIM DNS record validation with per-host status display to email sender management' (specific outcome + distinguishing detail + area)",
	"Bad: 'Refactoring auth module and fixing tests' (generic activities)",
	"Good: 'Extract JWT refresh logic into standalone middleware with token rotation' (concrete change + key detail)",
	"Bad: 'WebSocket reconnection work' (doesn't say if it was planned or built)",
	"Good: 'Design plan for WebSocket auto-reconnect with exponential backoff' (reflects planning phase)",
	"Be concrete about WHAT was built, planned, debugged, or reviewed — include the phase and key technical detail.",
	"Return ONLY the session name, nothing else. No quotes, no explanation.",
	"",
	"<conversation>",
].join("\n");

const INCREMENTAL_NAMING_PROMPT = [
	"Update this coding session's name based on the latest conversation.",
	'Current session name: "CURRENT_NAME" (the session\'s primary focus)',
	"",
	"Treat the current name as authoritative. Only change it if the new work represents a fundamentally different activity, not a minor tangent.",
	"When in doubt, extend rather than replace. Prefer adding context over discarding the original focus.",
	"Keep distinguishing technical details. Be concrete about what was built, planned, debugged, or reviewed.",
	"Return ONLY the updated session name, nothing else. No quotes, no explanation.",
	"",
	"<recent_conversation>",
].join("\n");

export function buildInitialPrompt(messages: TranscriptMessage[]): string {
	const text = messages.map((m) => `${m.label}: ${m.text}`).join("\n\n");
	return `${INITIAL_NAMING_PROMPT}\n${text}\n</conversation>`;
}

export function buildIncrementalPrompt(currentName: string, recentMessages: TranscriptMessage[]): string {
	let prompt = INCREMENTAL_NAMING_PROMPT.replace("CURRENT_NAME", currentName);
	const text = recentMessages.map((m) => `${m.label}: ${m.text}`).join("\n\n");
	prompt += `\n${text}\n</recent_conversation>`;
	return prompt;
}

async function generateSessionName(
	prompt: string,
	modelRegistry: any,
	extensions: { emit: (event: string, data: any) => void } | undefined,
): Promise<string> {
	const modelSpec = getConfiguredModel();
	if (!modelSpec) throw new Error("No session namer model configured. Run /session-namer-model first.");

	const [provider, ...idParts] = modelSpec.split("/");
	const modelId = idParts.join("/");
	if (!provider || !modelId) throw new Error(`Invalid model spec: ${modelSpec}`);

	const model = modelRegistry?.find(provider, modelId);
	if (!model) throw new Error(`Model not found: ${modelSpec}`);

	const auth = await modelRegistry?.getApiKeyAndHeaders(model);
	if (!auth?.ok || !auth.apiKey) throw new Error(`No API key for ${modelSpec}`);

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey: auth.apiKey, headers: auth.headers },
	);

	extensions?.emit("model:usage", {
		provider: model.provider,
		model: model.id,
		input: response.usage?.input ?? 0,
		output: response.usage?.output ?? 0,
		cacheRead: response.usage?.cacheRead ?? 0,
		cacheWrite: response.usage?.cacheWrite ?? 0,
	});

	const extractName = (resp: typeof response): string =>
		resp.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();

	let name = extractName(response);
	if (!name) {
		const retry = await complete(
			model,
			{
				messages: [
					{ role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() },
				],
			},
			{ apiKey: auth.apiKey, headers: auth.headers },
		);
		extensions?.emit("model:usage", {
			provider: model.provider, model: model.id,
			input: retry.usage?.input ?? 0, output: retry.usage?.output ?? 0,
			cacheRead: retry.usage?.cacheRead ?? 0, cacheWrite: retry.usage?.cacheWrite ?? 0,
		});
		name = extractName(retry);
	}

	if (!name) throw new Error("Model returned empty response");
	return name;
}

const SELECT_LIST_THEME = (theme: any) => ({
	selectedPrefix: (t: string) => theme.fg("accent", t),
	selectedText: (t: string) => theme.fg("accent", t),
	description: (t: string) => theme.fg("muted", t),
	scrollInfo: (t: string) => theme.fg("dim", t),
	noMatch: (t: string) => theme.fg("warning", t),
});

export function isRenameTurn(turnIndex: number, interval: number, maxWindow: number): boolean {
	if (turnIndex < interval) return false;
	let threshold = interval;
	let gap = interval;
	while (threshold < turnIndex) {
		gap = Math.min(gap + 2, maxWindow);
		threshold += gap;
	}
	return threshold === turnIndex;
}

export function lastScheduledTurn(turnCount: number, interval: number, maxWindow: number): number {
	if (turnCount < interval) return 0;
	let threshold = interval;
	let gap = interval;
	let prev = 0;
	while (threshold <= turnCount) {
		prev = threshold;
		gap = Math.min(gap + 2, maxWindow);
		threshold += gap;
	}
	return prev;
}

export function registerSessionNamer(pi: ExtensionAPI) {
	let namingInProgress = false;
	let namingPromise: Promise<void> | undefined;
	let assistantTurnCount = 0;
	let lastRenameTurn = 0;

	// Reconstruct state from existing session on startup/resume/reload
	pi.on("session_start", (_event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		const transcript = buildTranscript(branch);
		assistantTurnCount = transcript.filter((m) => m.label === "Assistant").length;

		const interval = getNamingInterval();
		const maxWindow = getMaxWindow();
		lastRenameTurn = lastScheduledTurn(assistantTurnCount, interval, maxWindow);
	});

	// Command to configure the model
	pi.registerCommand("session-namer-model", {
		description: "Configure which model generates session names on exit",
		handler: async (_args, ctx) => {
			const current = getConfiguredModel() ?? "(not set — session naming disabled)";

			if (!ctx.hasUI) {
				ctx.ui.notify(`Session namer model: ${current}`, "info");
				return;
			}

			const available = (ctx.modelRegistry?.getAvailable() ?? []).map((m) => `${m.provider}/${m.id}`);
			const unique = Array.from(new Set(available)).sort();

			if (unique.length === 0) {
				ctx.ui.notify("No available models found", "warning");
				return;
			}

			const allItems: SelectItem[] = [
				{ value: "(disable)", label: "(disable)", description: "Turn off auto-naming" },
				...unique.map((m) => ({ value: m, label: m })),
			];

			const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				let filter = "";
				let currentItems = allItems;
				let selectList = new SelectList(currentItems, Math.min(currentItems.length, 12), SELECT_LIST_THEME(theme));
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);

				const rebuildList = () => {
					const lower = filter.toLowerCase();
					currentItems = lower
						? allItems.filter((item) => item.value.toLowerCase().includes(lower))
						: allItems;
					selectList = new SelectList(currentItems, Math.min(currentItems.length, 12), SELECT_LIST_THEME(theme));
					selectList.onSelect = (item) => done(item.value);
					selectList.onCancel = () => done(null);
				};

				return {
					render: (w: number) => {
						const border = new DynamicBorder((s: string) => theme.fg("accent", s));
						const lines: string[] = [];
						lines.push(...border.render(w));
						lines.push(...new Text(
							theme.fg("accent", theme.bold("Session Namer Model")) + "  " + theme.fg("dim", `current: ${current}`),
							1, 0,
						).render(w));
						if (filter) {
							lines.push(...new Text(
								theme.fg("accent", "  filter: ") + theme.fg("warning", filter),
								1, 0,
							).render(w));
						}
						lines.push(...selectList.render(w));
						lines.push(...new Text(
							theme.fg("dim", "↑↓ navigate • type to filter • enter select • esc cancel"),
							1, 0,
						).render(w));
						lines.push(...border.render(w));
						return lines;
					},
					invalidate: () => {},
					handleInput: (data: string) => {
						if (data.length === 1 && data >= " " && data <= "~") {
							filter += data;
							rebuildList();
						} else if (data === "\x7f" || data === "\b") {
							if (filter.length > 0) {
								filter = filter.slice(0, -1);
								rebuildList();
							}
						} else {
							selectList.handleInput(data);
						}
						tui.requestRender();
					},
				};
			});

			if (!selected) {
				ctx.ui.notify("Canceled", "warning");
				return;
			}

			if (selected === "(disable)") {
				writeSetting(SETTINGS_KEY, "");
				ctx.ui.notify("Session naming on exit disabled", "info");
			} else {
				writeSetting(SETTINGS_KEY, selected);
				ctx.ui.notify(`Session namer model set to ${selected}`, "info");
			}
		},
	});

	// Command to rename the current session
	pi.registerCommand("session-rename", {
		description: "Rename session: no args = auto-generate, or provide a name",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (name) {
				pi.setSessionName(name);
				ctx.ui.notify(`Session renamed: ${name}`, "info");
				return;
			}

			if (!getConfiguredModel()) {
				ctx.ui.notify("No session namer model configured. Run /session-namer-model first.", "warning");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const transcript = buildTranscript(branch);
			if (transcript.length === 0) {
				ctx.ui.notify("No messages in this session", "warning");
				return;
			}

			ctx.ui.notify("Generating session name...", "info");

			try {
				const prompt = buildInitialPrompt(transcript);
				const generated = await generateSessionName(prompt, ctx.modelRegistry, pi.events);
				pi.setSessionName(generated);
				ctx.ui.notify(`Session renamed: ${generated}`, "info");
			} catch (e: any) {
				ctx.ui.notify(e.message ?? String(e), "error");
			}
		},
	});

	// Incrementally rename session based on assistant turn count and backoff schedule
	pi.on("turn_end", async (event, ctx) => {
		if (event.message?.role !== "assistant") return;

		assistantTurnCount++;
		const interval = getNamingInterval();
		const maxWindow = getMaxWindow();

		if (!isRenameTurn(assistantTurnCount, interval, maxWindow)) return;
		if (!getConfiguredModel()) return;
		if (namingInProgress) return;

		namingInProgress = true;
		namingPromise = (async () => {
			try {
				const branch = ctx.sessionManager.getBranch();
				const fullTranscript = buildTranscript(branch);
				if (fullTranscript.length < 4) return;

				const currentName = pi.getSessionName();
				let prompt: string;

				if (!currentName) {
					prompt = buildInitialPrompt(fullTranscript);
				} else {
					const gap = assistantTurnCount - lastRenameTurn;
					const messageWindow = gap * 2;
					const recentMessages = takeLast(fullTranscript, messageWindow);
					prompt = buildIncrementalPrompt(currentName, recentMessages);
				}
				lastRenameTurn = assistantTurnCount;

				const name = await generateSessionName(prompt, ctx.modelRegistry, pi.events);
				if (name) pi.setSessionName(name);
			} catch {
				// naming failed silently
			} finally {
				namingInProgress = false;
			}
		})();
	});

	// Generate session name on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		if (pi.getSessionName()) return;
		if (!ctx.sessionManager.getSessionFile()) return;
		if (!getConfiguredModel()) return;

		// If a rename is in-flight, just wait for it
		if (namingPromise) {
			await namingPromise;
			return;
		}

		// Session never hit the first threshold — generate from full transcript
		const branch = ctx.sessionManager.getBranch();
		const transcript = buildTranscript(branch);
		if (transcript.length < 4) return;

		// TUI is already stopped by the time session_shutdown fires,
		// so setStatus is a no-op. Write directly to stdout instead.
		process.stdout.write("Generating session name...\n");
		try {
			const prompt = buildInitialPrompt(transcript);
			const name = await generateSessionName(prompt, ctx.modelRegistry, pi.events);
			if (name) pi.setSessionName(name);
		} catch {
			// naming failed silently, session keeps default name
		}
	});
}
