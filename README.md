# copilot-obsidian

A [GitHub Copilot CLI](https://docs.github.com/copilot/concepts/agents/about-copilot-cli) extension that connects your [Obsidian](https://obsidian.md/) vault to the Copilot agent. Read, write, search, and manage your notes directly from the terminal — no Obsidian plugin required.

## Why?

Obsidian vaults are just folders of markdown files. This extension gives the Copilot CLI agent direct access to your vault, turning it into a **persistent knowledge layer** for your AI-powered workflow.

Use cases:
- **Knowledge graphs** — build and maintain a personal wiki that Copilot can read and update
- **Meeting notes** — have Copilot create structured notes during or after meetings
- **Research** — search your vault for context while working on tasks
- **Daily journals** — auto-populate daily notes from activity
- **Project docs** — keep project documentation in Obsidian and let Copilot reference it

## Install

Clone this repo into your Copilot CLI user extensions directory:

```bash
# macOS / Linux
git clone https://github.com/ericchansen/copilot-obsidian ~/.copilot/extensions/copilot-obsidian

# Windows (PowerShell)
git clone https://github.com/ericchansen/copilot-obsidian "$env:USERPROFILE\.copilot\extensions\copilot-obsidian"
```

Then restart Copilot CLI (or run `/clear`). The extension is auto-discovered.

### Per-project install

To bundle with a specific project, clone into `.github/extensions/` instead:

```bash
git clone https://github.com/ericchansen/copilot-obsidian .github/extensions/copilot-obsidian
```

## Configuration

Configuration is done via environment variables. Set them in your shell profile (`.bashrc`, `.zshrc`, PowerShell `$PROFILE`, etc.) or in a `.env` file.

| Variable | Description | Default |
|---|---|---|
| `OBSIDIAN_VAULT_PATH` | Absolute path to your vault | — |
| `OBSIDIAN_VAULT_NAME` | Vault folder name (under `~/ObsidianVaults/`) | `MyVault` |
| `OBSIDIAN_KEYWORDS` | Comma-separated keywords that trigger context injection | `vault,obsidian,note,knowledge` |

**Path resolution order:**
1. `OBSIDIAN_VAULT_PATH` (exact path, highest priority)
2. `OBSIDIAN_VAULT_NAME` (resolved to `~/ObsidianVaults/<name>`)
3. Falls back to `~/ObsidianVaults/MyVault`

### Example

```bash
# Point to a specific vault
export OBSIDIAN_VAULT_PATH="$HOME/Documents/MyNotes"

# Or just name the vault folder
export OBSIDIAN_VAULT_NAME="WorkVault"

# Add keywords that trigger automatic context injection
export OBSIDIAN_KEYWORDS="vault,obsidian,note,project,meeting,account"
```

## Tools

Once loaded, the extension provides these tools to the Copilot agent:

| Tool | Description |
|---|---|
| `vault_read` | Read a note's full markdown content |
| `vault_write` | Create or update a note (supports YAML frontmatter and `[[wikilinks]]`) |
| `vault_list` | List folders in the vault, or notes in a specific folder |
| `vault_search` | Full-text substring search across all notes with context snippets |
| `vault_summary` | High-level vault overview: folder counts, note counts, wikilink stats |
| `vault_delete` | Delete a note |
| `vault_rename` | Rename or move a note between folders |

### Context injection

When you mention any of the configured keywords in your prompt, the extension automatically injects your vault structure as context — the agent sees your folders and note counts without needing to call any tools first.

## How it works

```
┌─────────────────────┐       JSON-RPC / stdio       ┌──────────────────────┐
│   Copilot CLI        │ ◄──────────────────────────► │  copilot-obsidian    │
│                      │                               │                      │
│  Routes tool calls   │     vault_read, vault_write   │  Reads/writes .md    │
│  Injects context     │     vault_search, etc.        │  files on disk       │
└─────────────────────┘                               └──────────────────────┘
                                                              │
                                                              ▼
                                                     ┌──────────────────┐
                                                     │  Obsidian Vault  │
                                                     │  (local folder)  │
                                                     │                  │
                                                     │  📁 Projects/    │
                                                     │  📁 DailyNotes/  │
                                                     │  📁 People/      │
                                                     │  📁 ...          │
                                                     └──────────────────┘
```

The extension operates **directly on the filesystem**. Obsidian watches the vault folder for changes, so any notes created or updated by Copilot appear instantly in Obsidian. No Obsidian plugin or API is needed.

## Requirements

- [GitHub Copilot CLI](https://docs.github.com/copilot/concepts/agents/about-copilot-cli) v1.0.0+
- An Obsidian vault (any folder of markdown files)
- Node.js is **not** required separately — the Copilot CLI runtime provides it

## Tips

- **Use `[[wikilinks]]`** in your notes to build a knowledge graph. The more you cross-reference, the more useful the vault becomes.
- **YAML frontmatter** (the `---` block at the top of notes) helps the agent understand note types and metadata.
- **Organize by folder** — the agent uses folders to scope reads and searches.
- **Set keywords** for your domain — if you work with accounts, add `account` to `OBSIDIAN_KEYWORDS` so the agent auto-injects context when you mention accounts.

## License

[MIT](LICENSE)
