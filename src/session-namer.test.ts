import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { getNamingInterval, getMaxWindow, SETTINGS_KEY_INTERVAL, SETTINGS_KEY_MAX_WINDOW } from "./session-namer.js";

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
