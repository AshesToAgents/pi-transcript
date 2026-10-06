import { matchesKey, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

const FRAME_LINES = 2; // top + bottom border

/**
 * Compute the visible body height for a viewer given the terminal size.
 *
 * The viewer never claims more than `maxRatio` of the terminal rows. When the
 * content fits, it renders in full without scroll chrome.
 */
export function computeGeometry(
	contentLines: number,
	termRows: number,
	maxRatio = 0.85,
	minViewport = 3,
): ViewerGeometry {
	const budget = Math.floor(termRows * maxRatio) - FRAME_LINES;
	if (contentLines <= budget) {
		return { viewportLines: contentLines, scrollable: false };
	}
	return { viewportLines: Math.max(minViewport, budget), scrollable: true };
}

/** Clamp a scroll offset to the valid range for the given content/viewport. */
export function clampScroll(scrollTop: number, contentLines: number, viewportLines: number): number {
	const maxScrollTop = Math.max(0, contentLines - viewportLines);
	return Math.max(0, Math.min(scrollTop, maxScrollTop));
}

export interface ViewerGeometry {
	viewportLines: number;
	scrollable: boolean;
}

export interface TranscriptViewerOptions {
	title: string;
	/** Full content lines for a given render width. */
	content: (width: number) => string[];
	theme: { fg(color: string, text: string): string; bold(text: string): string };
	getTerminalSize: () => { rows: number; columns: number };
	requestRender?: () => void;
	onClose: () => void;
	maxRatio?: number;
	minViewport?: number;
}

/**
 * Fullscreen-friendly transcript viewer with self-managed scrolling.
 *
 * Renders a bounded window of the content and owns its scroll offset. Wheel
 * events are consumed here so they never fall through to the primary chat
 * viewport, and focused-overlay mounting keeps pageUp/home/end reaching
 * {@link handleInput} instead of the background transcript.
 */
export class TranscriptViewer implements Component {
	private scrollTop = 0;
	private contentCache?: { width: number; lines: string[] };

	constructor(private readonly options: TranscriptViewerOptions) {}

	private ensureContent(): string[] {
		if (!this.contentCache) {
			// Input can arrive before the first render; terminal columns are the
			// best available width estimate until render() supplies the real one.
			const width = this.options.getTerminalSize().columns;
			this.contentCache = { width, lines: this.options.content(width) };
		}
		return this.contentCache.lines;
	}

	/** Content at a width, cached per width until invalidated. */
	private contentAt(width: number): string[] {
		if (!this.contentCache || this.contentCache.width !== width) {
			this.contentCache = { width, lines: this.options.content(width) };
		}
		return this.contentCache.lines;
	}

	private maxScrollTop(contentLines: number, viewportLines: number): number {
		return Math.max(0, contentLines - viewportLines);
	}

	private scrollBy(delta: number): boolean {
		const lines = this.ensureContent();
		const { viewportLines } = computeGeometry(
			lines.length,
			this.options.getTerminalSize().rows,
			this.options.maxRatio,
			this.options.minViewport,
		);
		const next = clampScroll(this.scrollTop + delta, lines.length, viewportLines);
		if (next === this.scrollTop) return false;
		this.scrollTop = next;
		this.options.requestRender?.();
		return true;
	}

	render(width: number): string[] {
		const theme = this.options.theme;
		const rail = theme.fg("border", "│");

		// Two-step width resolution: wrapping without the gutter first, then
		// re-wrap one column narrower when a scrollbar gutter is needed.
		let lines = this.contentAt(Math.max(1, width - 2));
		let geometry = computeGeometry(
			lines.length,
			this.options.getTerminalSize().rows,
			this.options.maxRatio,
			this.options.minViewport,
		);
		if (geometry.scrollable) {
			lines = this.contentAt(Math.max(1, width - 3));
			geometry = computeGeometry(
				lines.length,
				this.options.getTerminalSize().rows,
				this.options.maxRatio,
				this.options.minViewport,
			);
		}
		const { viewportLines, scrollable } = geometry;
		this.scrollTop = clampScroll(this.scrollTop, lines.length, viewportLines);

		const bodyWidth = Math.max(1, width - 2 - (scrollable ? 1 : 0));
		const body: string[] = [];
		for (let i = 0; i < viewportLines; i++) {
			const line = lines[this.scrollTop + i] ?? "";
			const padded =
				visibleWidth(line) >= bodyWidth
					? sliceByColumn(line, 0, bodyWidth, true)
					: line + " ".repeat(bodyWidth - visibleWidth(line));
			body.push(rail + padded + (scrollable ? this.gutterChar(i, viewportLines) : "") + rail);
		}

		const top = this.borderRow(width, {
			start: "┌─ ",
			end: "┐",
			segments: [theme.fg("accent", theme.bold(this.options.title))],
			hint: theme.fg("dim", "(j/k/↑/↓ scroll · Esc to close)"),
		});
		const from = this.scrollTop + 1;
		const to = this.scrollTop + viewportLines;
		const bottom = this.borderRow(width, {
			start: scrollable ? "└─ " : "└",
			end: "┘",
			segments: scrollable ? [theme.fg("dim", `lines ${from}–${to} of ${lines.length}`)] : [],
		});
		return [top, ...body, bottom];
	}

	/** Compose a styled frame border row with optional embedded segments. */
	private borderRow(
		width: number,
		opts: { start: string; end: string; segments: string[]; hint?: string },
	): string {
		const theme = this.options.theme;
		const parts = [theme.fg("border", opts.start), ...opts.segments];
		let used = visibleWidth(opts.start);
		for (const segment of opts.segments) used += visibleWidth(segment) + 1;
		if (opts.hint && used + visibleWidth(opts.hint) + 3 <= width) {
			parts.push(" ", opts.hint);
			used += visibleWidth(opts.hint) + 1;
		}
		const fill = Math.max(0, width - used - visibleWidth(opts.end));
		parts.push(theme.fg("border", "─".repeat(fill) + opts.end));
		return parts.join("");
	}

	/** Scrollbar gutter character for a body row (track or thumb). */
	private gutterChar(row: number, viewportLines: number): string {
		const theme = this.options.theme;
		const lines = this.ensureContent();
		const maxScrollTop = this.maxScrollTop(lines.length, viewportLines);
		if (maxScrollTop <= 0) return theme.fg("dim", "│");
		const thumbSize = Math.max(1, Math.round((viewportLines * viewportLines) / lines.length));
		const thumbStart = Math.round((this.scrollTop / maxScrollTop) * (viewportLines - thumbSize));
		const isThumb = row >= thumbStart && row < thumbStart + thumbSize;
		return isThumb ? theme.fg("accent", "┃") : theme.fg("dim", "│");
	}

	handleInput(data: string): void {
		// matchesKey is case-insensitive for letter tokens ("g" also matches "G"),
		// so vim-style g/G are compared on the exact byte instead.
		if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "q")) {
			this.options.onClose();
			return;
		}

		const viewportLines = computeGeometry(
			this.ensureContent().length,
			this.options.getTerminalSize().rows,
			this.options.maxRatio,
			this.options.minViewport,
		).viewportLines;
		const page = Math.max(1, viewportLines - 1);
		const halfPage = Math.max(1, Math.floor(viewportLines / 2));

		if (matchesKey(data, "down") || matchesKey(data, "j")) this.scrollBy(1);
		else if (matchesKey(data, "up") || matchesKey(data, "k")) this.scrollBy(-1);
		else if (matchesKey(data, "pageDown")) this.scrollBy(page);
		else if (matchesKey(data, "pageUp")) this.scrollBy(-page);
		else if (matchesKey(data, "ctrl+d")) this.scrollBy(halfPage);
		else if (matchesKey(data, "ctrl+u")) this.scrollBy(-halfPage);
		else if (matchesKey(data, "home") || data === "g") this.scrollTo(0);
		else if (matchesKey(data, "end") || data === "G") {
			const lines = this.ensureContent();
			this.scrollTo(this.maxScrollTop(lines.length, viewportLines));
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel") return undefined;
		// Consume every wheel event over the viewer, even without a delta,
		// so it never falls through to the primary chat viewport.
		const moved = event.wheelDelta ? this.scrollBy(event.wheelDelta) : false;
		return { handled: true, render: moved };
	}

	private scrollTo(top: number): void {
		const lines = this.ensureContent();
		const viewportLines = computeGeometry(
			lines.length,
			this.options.getTerminalSize().rows,
			this.options.maxRatio,
			this.options.minViewport,
		).viewportLines;
		const next = clampScroll(top, lines.length, viewportLines);
		if (next === this.scrollTop) return;
		this.scrollTop = next;
		this.options.requestRender?.();
	}

	invalidate(): void {
		this.contentCache = undefined;
	}
}
