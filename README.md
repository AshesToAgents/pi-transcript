# pi-transcript

A [pi](https://github.com/earendil-works/pi) extension that adds session transcript viewing and automatic session naming.

## Install

```bash
# Global (user-level)
pi install ssh://git@github.com/AshesToAgents/pi-transcript.git

# Project-level (shared with team via .pi/settings.json)
pi install -l ssh://git@github.com/AshesToAgents/pi-transcript.git

# Try without installing
pi -e ssh://git@github.com/AshesToAgents/pi-transcript.git
```

## What's Included

| Type | Name | Description |
|------|------|-------------|
| Command | `/transcript` | Full-screen view of the session conversation, minus tool noise |
| Command | `/session-rename` | Rename the current session (auto-generates name if none given) |
| Command | `/session-namer-model` | Configure which model generates session names |

## Usage

### `/transcript`

Opens a centered overlay view of the current session's user and assistant messages, stripping out tool noise so you see just the conversation. Scroll with the mouse wheel, arrows, or j/k; PgUp/PgDn and Ctrl+D/Ctrl+U move by page or half page; g/Home and G/End jump to the top or bottom. Press Escape, Enter, or Q to close.

### `/session-rename [name]`

Renames the current session. Pass a name as an argument, or run it without args to auto-generate one using an LLM.

### `/session-namer-model`

Configures which model generates session names. Presents an interactive model picker with type-to-filter. Select `(disable)` to turn off auto-naming.

### Configuration

Auto-naming on exit requires a model to be configured via `/session-namer-model`. When a session ends without a custom name, it automatically generates one from the transcript (requires a configured model and at least 4 messages).

## How It Works

The transcript builder walks the session branch and extracts only user and assistant text messages, plus `askUser` questions and responses. Tool calls, results, and other noise are filtered out for a clean conversation view.

Auto-naming sends the transcript to your configured model with a prompt tuned to produce short, distinguishing session names that reflect the actual work done.

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT
