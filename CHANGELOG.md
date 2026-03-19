# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-03-19

### Added
- **`vault_append`** — append content to an existing note without overwriting (creates note if missing)
- **Issue templates** — bug report and feature request GitHub issue templates
- **CONTRIBUTING.md** — contributor guide with project structure, code style, and PR guidelines
- **CHANGELOG.md** — this file, tracking all releases
- **ESLint** — linting with modern flat config (`eslint.config.mjs`)
- **Tests** — 31 tests using Node.js built-in test runner (`extension.test.mjs`)
- **CI** — GitHub Actions workflow running lint + tests on Node 20 and 22
- **package.json** — project metadata, scripts (`lint`, `test`, `check`), dev dependencies
- GitHub repository topics for discoverability

## [0.2.0] — 2026-03-19

### Added
- **Config file support** — `obsidian.config.json` for vault path, folders, keywords, templates, daily note settings
- **`vault_backlinks`** — find all notes linking to a given note via `[[wikilinks]]`
- **`vault_recent`** — list recently modified notes sorted by mtime
- **`vault_daily`** — read or create today's daily note from a configurable template
- **Frontmatter search** — `vault_search` now supports `type`, `status`, and `tags` filters
- **Recursive search** — `vault_search` traverses nested folders
- **Template system** — named templates in config with `{{date}}` and `{{title}}` placeholders
- **`vault_delete`** — delete a note
- **`vault_rename`** — rename or move a note between folders
- `obsidian.config.example.json` as a starting point for new users

### Changed
- Vault path resolution now supports `~` expansion and config file priority over env vars
- Search returns frontmatter metadata alongside snippets

## [0.1.0] — 2026-03-19

### Added
- Initial release
- **`vault_read`** — read note content
- **`vault_write`** — create or update notes with markdown content
- **`vault_list`** — list folders and notes
- **`vault_search`** — full-text substring search across all notes
- **`vault_summary`** — vault overview with folder counts and wikilink stats
- **Keyword-triggered context injection** — auto-injects vault structure when keywords are mentioned in prompts
- Environment variable configuration (`OBSIDIAN_VAULT_PATH`, `OBSIDIAN_VAULT_NAME`, `OBSIDIAN_KEYWORDS`)
- MIT license
