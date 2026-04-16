# pi-transcript

A [pi](https://github.com/mariozechner/pi-coding-agent) package that adds session transcript viewing and automatic session naming.

## Features

- **`/transcript`** — Opens a full-screen TUI view of the current session's user and assistant messages, stripping out tool noise so you see just the conversation.
- **`/session-rename`** — Renames the current session. Pass a name as an argument, or run it without args to auto-generate one using an LLM.
- **`/session-namer-model`** — Configures which model generates session names. Presents an interactive model picker with type-to-filter.
- **Auto-naming on exit** — When a session ends without a custom name, automatically generates one from the transcript (requires a configured model and at least 4 messages).

## Install

```bash
# From a local path
pi install /path/to/pi-transcript

# Or try without installing
pi -e /path/to/pi-transcript
```

## Setup

Session auto-naming requires a model to be configured:

1. Run `/session-namer-model`
2. Pick a model from the list (type to filter)
3. Done — new sessions will be auto-named on exit

You can disable auto-naming by selecting `(disable)` from the model picker.

## Commands

| Command | Description |
|---|---|
| `/transcript` | Show session transcript (Esc/Enter/Q to close) |
| `/session-rename [name]` | Rename session — auto-generates if no name given |
| `/session-namer-model` | Configure the model used for name generation |

## How It Works

The transcript builder walks the session branch and extracts only user and assistant text messages, plus `askUser` questions and responses. Tool calls, results, and other noise are filtered out so you get a clean conversation view.

Auto-naming sends the transcript to your configured model with a prompt tuned to produce short, distinguishing session names that reflect the actual work done.

## Development

```bash
npm run typecheck   # TypeScript type checking
npm test            # Run tests
```
