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
- **Backlink exploration** — discover how ideas connect across your vault

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

The extension supports a **config file** (`obsidian.config.json`) placed in the extension directory, with fallback to environment variables.

Copy the example to get started:

```bash
cp obsidian.config.example.json obsidian.config.json
```

> **Note:** `obsidian.config.json` is gitignored — your personal config stays local.

### Config file reference

```json
{
  "vault": "~/ObsidianVaults/MyVault",

  "folders": {
    "Projects": { "description": "Active projects and initiatives" },
    "Meetings": { "description": "Meeting notes and summaries" },
    "DailyNotes": { "description": "Daily journal entries" }
  },

  "keywords": ["vault", "obsidian", "note", "project", "meeting"],

  "daily": {
    "folder": "DailyNotes",
    "template": "---\ndate: {{date}}\n---\n\n# {{date}}\n\n## Notes\n\n"
  },

  "templates": {
    "Meeting": "---\ntype: meeting\ndate: {{date}}\n---\n\n# {{title}}\n\n## Attendees\n\n## Notes\n\n",
    "Person": "---\ntype: person\n---\n\n# {{title}}\n\n## Notes\n\n"
  }
}
```

| Key | Description |
|---|---|
| `vault` | Absolute path to your vault. Supports `~` for home directory. |
| `folders` | Optional folder descriptions — shown in `vault_list` and injected context. |
| `keywords` | Words that trigger automatic context injection when mentioned in prompts. |
| `daily.folder` | Folder for daily notes (default: `DailyNotes`). |
| `daily.template` | Template for new daily notes. Supports `{{date}}` placeholder. |
| `templates` | Named templates for `vault_write`. Supports `{{date}}` and `{{title}}`. |

### Environment variables (fallback)

If no config file is present, the extension uses environment variables:

| Variable | Description | Default |
|---|---|---|
| `OBSIDIAN_VAULT_PATH` | Absolute path to your vault | — |
| `OBSIDIAN_VAULT_NAME` | Vault folder name (under `~/ObsidianVaults/`) | `MyVault` |
| `OBSIDIAN_KEYWORDS` | Comma-separated context-injection keywords | `vault,obsidian,note,knowledge` |

## Tools

| Tool | Description |
|---|---|
| `vault_read` | Read a note's full markdown content |
| `vault_write` | Create or update a note (supports templates, frontmatter, wikilinks) |
| `vault_append` | Append content to an existing note without overwriting |
| `vault_list` | List folders in the vault, or notes in a specific folder |
| `vault_search` | Full-text search with optional frontmatter filters (`type`, `status`, `tags`) |
| `vault_summary` | Vault overview: folder counts, note counts, wikilink stats |
| `vault_backlinks` | Find all notes that `[[link]]` to a given note |
| `vault_recent` | List recently modified notes (sorted by last-modified time) |
| `vault_daily` | Read or create today's daily note from template |
| `vault_delete` | Delete a note |
| `vault_rename` | Rename or move a note between folders |

### Context injection

When you mention any of the configured keywords in your prompt, the extension automatically injects your vault structure as context. The agent sees your folders, note counts, and descriptions without needing to call any tools first.

### Frontmatter search

`vault_search` can filter by YAML frontmatter fields:

```
Search for all meeting notes about "architecture":
  → query: "architecture", type: "meeting"

Find all active projects:
  → type: "project", status: "active"

Find notes tagged with "urgent":
  → tags: "urgent"
```

### Backlinks

`vault_backlinks` finds every note that contains a `[[wikilink]]` to a given note — the same graph-traversal that powers Obsidian's graph view, now accessible to the agent.

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

- **Use `[[wikilinks]]`** in your notes to build a knowledge graph. Use `vault_backlinks` to explore connections.
- **YAML frontmatter** (the `---` block at the top) enables structured search with `vault_search` filters.
- **Templates** save time — define them in your config and use `vault_write` with the `template` parameter.
- **`vault_daily`** is great for daily standups — the agent can read today's note for context or create one if it doesn't exist.
- **Set keywords** for your domain — if you work with accounts, add `account` to keywords so context auto-injects.

## License

[MIT](LICENSE)
