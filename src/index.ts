import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerTranscript } from "./transcript.js";
import { registerSessionNamer } from "./session-namer.js";

export default function (pi: ExtensionAPI) {
	registerTranscript(pi);
	registerSessionNamer(pi);
}
