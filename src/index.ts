import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTranscript } from "./transcript.js";
import { registerSessionNamer } from "./session-namer.js";

export default function (pi: ExtensionAPI) {
	registerTranscript(pi);
	registerSessionNamer(pi);
}
