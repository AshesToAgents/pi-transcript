import { describe, it, expect, vi } from "vitest";
import { computeGeometry, clampScroll, TranscriptViewer } from "./viewer.js";

// Mimic the real Theme: methods read state through `this`, so destructuring
// them off the object (as the real crash showed) breaks the receiver binding.
const identityTheme = {
	colors: { accent: "accent", dim: "dim", success: "success" } as Record<string, string>,
	fg(this: { colors: Record<string, string> }, color: string, text: string) {
		return `[${this.colors[color]}]${text}`;
	},
	bold(this: object, text: string) {
		return `**${text}**`;
	},
};

const makeLines = (count: number) =>
	Array.from({ length: count }, (_, i) => `line-${String(i).padStart(3, "0")}`);

const wheelEvent = (wheelDelta: number | undefined) => ({
	type: "wheel" as const,
	button: "none" as const,
	x: 0,
	y: 0,
	screenX: 0,
	screenY: 0,
	width: 80,
	height: 34,
	shift: false,
	alt: false,
	ctrl: false,
	...(wheelDelta === undefined ? {} : { wheelDelta }),
});

const makeViewer = (opts?: {
	lines?: string[];
	rows?: number;
	onClose?: () => void;
}) => {
	let term = { rows: opts?.rows ?? 40, columns: 80 };
	const lines = opts?.lines ?? makeLines(100);
	const widths: number[] = [];
	const viewer = new TranscriptViewer({
		title: "Session Transcript",
		content: (width) => {
			widths.push(width);
			return lines;
		},
		theme: identityTheme,
		getTerminalSize: () => term,
		requestRender: () => {},
		onClose: opts?.onClose ?? (() => {}),
	});
	return {
		viewer,
		lines,
		widths,
		setTerm: (rows: number) => {
			term = { rows, columns: 80 };
		},
	};
};

/** Body slice of the rendered view (between the frame borders). */
const bodyOf = (viewer: TranscriptViewer) => {
	const rendered = viewer.render(80);
	return rendered.slice(1, rendered.length - 1);
};

describe("computeGeometry", () => {
	it("shows everything when content fits", () => {
		expect(computeGeometry(5, 40)).toEqual({ viewportLines: 5, scrollable: false });
	});

	it("reserves frame rows when content overflows", () => {
		// floor(40 * 0.85) = 34; 34 - 2 frame borders = 32 body
		expect(computeGeometry(100, 40)).toEqual({ viewportLines: 32, scrollable: true });
	});

	it("never shrinks below the minimum viewport", () => {
		// floor(6 * 0.85) = 5; 5 - 2 header = 3 avail; would be 2 after footer
		expect(computeGeometry(100, 6, 0.85, 3)).toEqual({ viewportLines: 3, scrollable: true });
	});
});

describe("clampScroll", () => {
	it("keeps valid positions", () => {
		expect(clampScroll(5, 100, 31)).toBe(5);
	});

	it("clamps to [0, content - viewport]", () => {
		expect(clampScroll(200, 100, 31)).toBe(69);
		expect(clampScroll(-4, 100, 31)).toBe(0);
	});

	it("returns 0 when content fits the viewport", () => {
		expect(clampScroll(7, 5, 10)).toBe(0);
	});
});

describe("TranscriptViewer", () => {
	it("renders a frame with the title and position embedded", () => {
		const { viewer } = makeViewer();
		const rendered = viewer.render(80);
		// 1 top border + 32 body + 1 bottom border = 34 = floor(40 * 0.85)
		expect(rendered.length).toBe(34);
		expect(rendered[0]).toContain("Session Transcript");
		expect(rendered[0]).toContain("┌");
		expect(rendered.at(-1)).toContain("lines 1–32 of 100");
		expect(rendered.at(-1)).toContain("└");
		expect(bodyOf(viewer)[0]).toContain("line-000");
		expect(bodyOf(viewer)[0]).toContain("│line-000");
	});

	it("renders all lines without gutter when content fits", () => {
		const { viewer } = makeViewer({ lines: makeLines(5) });
		const rendered = viewer.render(80);
		expect(rendered.length).toBe(7); // top border + 5 lines + bottom border
		expect(rendered[5]).toContain("│line-004");
		expect(rendered[5].endsWith("│")).toBe(true);
		expect(rendered[6]).toContain("└");
		expect(rendered[5]).not.toContain("┃"); // no scrollbar thumb
	});

	it("passes the body width (minus frame and gutter) to the content builder", () => {
		const { viewer, widths } = makeViewer();
		viewer.render(80);
		// 80 - 2 rails - 1 scrollbar gutter
		expect(widths).toContain(77);
	});

	it("scrolls one line for down/up arrows and j/k", () => {
		const { viewer } = makeViewer();
		viewer.handleInput("\x1b[B");
		expect(bodyOf(viewer)[0]).toContain("line-001");
		viewer.handleInput("j");
		expect(bodyOf(viewer)[0]).toContain("line-002");
		viewer.handleInput("\x1b[A");
		expect(bodyOf(viewer)[0]).toContain("line-001");
		viewer.handleInput("k");
		expect(bodyOf(viewer)[0]).toContain("line-000");
	});

	it("scrolls a page minus overlap for pageUp/pageDown", () => {
		const { viewer } = makeViewer();
		viewer.handleInput("\x1b[6~"); // pageDown
		expect(bodyOf(viewer)[0]).toContain("line-031"); // 32 - 1 overlap
		viewer.handleInput("\x1b[5~"); // pageUp
		expect(bodyOf(viewer)[0]).toContain("line-000");
	});

	it("scrolls half a page for ctrl+d/ctrl+u", () => {
		const { viewer } = makeViewer();
		viewer.handleInput("\x04"); // ctrl+d
		expect(bodyOf(viewer)[0]).toContain("line-016"); // floor(32 / 2)
		viewer.handleInput("\x15"); // ctrl+u
		expect(bodyOf(viewer)[0]).toContain("line-000");
	});

	it("jumps to start/end for home/end and g/G", () => {
		const { viewer } = makeViewer();
		viewer.handleInput("\x1b[F"); // end
		expect(bodyOf(viewer)[0]).toContain("line-068");
		expect(bodyOf(viewer)[31]).toContain("line-099");
		viewer.handleInput("g");
		expect(bodyOf(viewer)[0]).toContain("line-000");
		viewer.handleInput("G");
		expect(bodyOf(viewer)[0]).toContain("line-068");
		viewer.handleInput("\x1b[H"); // home
		expect(bodyOf(viewer)[0]).toContain("line-000");
	});

	it("does not scroll past the last line", () => {
		const { viewer } = makeViewer();
		viewer.handleInput("\x1b[F");
		for (let i = 0; i < 5; i++) viewer.handleInput("j");
		expect(bodyOf(viewer)[0]).toContain("line-068");
	});

	it("closes on escape, q, and enter", () => {
		for (const key of ["\x1b", "q", "\r"]) {
			const onClose = vi.fn();
			const { viewer } = makeViewer({ onClose });
			viewer.handleInput(key);
			expect(onClose).toHaveBeenCalledTimes(1);
		}
	});

	it("ignores unrelated keys", () => {
		const onClose = vi.fn();
		const { viewer } = makeViewer({ onClose });
		viewer.handleInput("x");
		expect(onClose).not.toHaveBeenCalled();
		expect(bodyOf(viewer)[0]).toContain("line-000");
	});

	it("consumes wheel events and scrolls by the delta", () => {
		const { viewer } = makeViewer();
		const down = viewer.handleMouse(wheelEvent(3));
		expect(down).toMatchObject({ handled: true });
		expect(bodyOf(viewer)[0]).toContain("line-003");
		const up = viewer.handleMouse(wheelEvent(-2));
		expect(up).toMatchObject({ handled: true });
		expect(bodyOf(viewer)[0]).toContain("line-001");
	});

	it("consumes wheel events even without a delta", () => {
		const { viewer } = makeViewer();
		const result = viewer.handleMouse(wheelEvent(undefined));
		expect(result).toMatchObject({ handled: true });
		expect(bodyOf(viewer)[0]).toContain("line-000");
	});

	it("clamps scrollTop when the viewport grows on resize", () => {
		const { viewer, setTerm } = makeViewer();
		viewer.handleInput("\x1b[F"); // scrollTop = 68 (max for viewport 32)
		setTerm(60); // floor(60 * 0.85) = 51; body = 51 - 2 = 49; max scroll = 51
		const rendered = viewer.render(80);
		expect(rendered.length).toBe(51);
		expect(bodyOf(viewer)[0]).toContain("line-051"); // clamped 68 -> 51
		expect(bodyOf(viewer)[48]).toContain("line-099");
	});

	it("recomputes content after invalidate", () => {
		const lines = makeLines(5);
		const { viewer } = makeViewer({ lines });
		expect(viewer.render(80).length).toBe(7);
		lines.push("line-005");
		viewer.invalidate();
		expect(viewer.render(80).length).toBe(8);
	});
});
