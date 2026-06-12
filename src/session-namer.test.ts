import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { getNamingInterval, getMaxWindow, SETTINGS_KEY_INTERVAL, SETTINGS_KEY_MAX_WINDOW, isRenameTurn } from "./session-namer.js";

describe("session-namer settings", () => {
	let tmpDir: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-namer-test-"));
		originalHome = process.env.HOME;
		process.env.HOME = tmpDir;
		fs.mkdirSync(path.join(tmpDir, ".pi", "agent"), { recursive: true });
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns defaults when no settings file exists", () => {
		expect(getNamingInterval()).toBe(4);
		expect(getMaxWindow()).toBe(12);
	});

	it("returns configured values from settings", () => {
		const settingsPath = path.join(tmpDir, ".pi", "agent", "settings.json");
		fs.writeFileSync(settingsPath, JSON.stringify({
			[SETTINGS_KEY_INTERVAL]: 6,
			[SETTINGS_KEY_MAX_WINDOW]: 16,
		}));
		expect(getNamingInterval()).toBe(6);
		expect(getMaxWindow()).toBe(16);
	});

	it("returns defaults for invalid values", () => {
		const settingsPath = path.join(tmpDir, ".pi", "agent", "settings.json");
		fs.writeFileSync(settingsPath, JSON.stringify({
			[SETTINGS_KEY_INTERVAL]: 0,
			[SETTINGS_KEY_MAX_WINDOW]: -1,
		}));
		expect(getNamingInterval()).toBe(4);
		expect(getMaxWindow()).toBe(12);
	});
});

describe("isRenameTurn (backoff schedule)", () => {
	it("returns false before first threshold", () => {
		expect(isRenameTurn(3, 4, 12)).toBe(false);
	});

	it("returns true at first threshold (turn 4)", () => {
		expect(isRenameTurn(4, 4, 12)).toBe(true);
	});

	it("returns false between thresholds", () => {
		expect(isRenameTurn(5, 4, 12)).toBe(false);
		expect(isRenameTurn(6, 4, 12)).toBe(false);
		expect(isRenameTurn(9, 4, 12)).toBe(false);
		expect(isRenameTurn(10, 4, 12)).toBe(true);
		expect(isRenameTurn(11, 4, 12)).toBe(false);
	});

	it("increments gap by 2 each time, capped at maxWindow", () => {
		expect(isRenameTurn(4, 4, 12)).toBe(true);   // gap=4
		expect(isRenameTurn(10, 4, 12)).toBe(true);  // gap=6
		expect(isRenameTurn(18, 4, 12)).toBe(true);  // gap=8
		expect(isRenameTurn(28, 4, 12)).toBe(true);  // gap=10
		expect(isRenameTurn(40, 4, 12)).toBe(true);  // gap=12 (capped)
		expect(isRenameTurn(52, 4, 12)).toBe(true);  // gap=12 (capped)
	});

	it("respects custom maxWindow", () => {
		expect(isRenameTurn(4, 4, 8)).toBe(true);
		expect(isRenameTurn(10, 4, 8)).toBe(true);   // gap=6
		expect(isRenameTurn(18, 4, 8)).toBe(true);   // gap=8 (capped)
		expect(isRenameTurn(26, 4, 8)).toBe(true);   // gap=8 (capped)
	});

	it("works with custom interval", () => {
		expect(isRenameTurn(3, 3, 10)).toBe(true);   // gap=3
		expect(isRenameTurn(8, 3, 10)).toBe(true);   // gap=5
		expect(isRenameTurn(15, 3, 10)).toBe(true);  // gap=7
		expect(isRenameTurn(24, 3, 10)).toBe(true);  // gap=9
		expect(isRenameTurn(34, 3, 10)).toBe(true);  // gap=10 (capped)
	});
});
