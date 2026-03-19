# Contributing to copilot-obsidian

Thanks for your interest in contributing! This extension connects Obsidian vaults to the GitHub Copilot CLI agent.

## Getting started

1. **Fork and clone** the repo
2. **Copy the example config:**
   ```bash
   cp obsidian.config.example.json obsidian.config.json
   ```
3. **Edit `obsidian.config.json`** to point to your Obsidian vault
4. **Install dev dependencies:**
   ```bash
   npm install
   ```
5. **Run lint and tests:**
   ```bash
   npm run lint
   npm test
   ```

## Development

### Project structure

```
copilot-obsidian/
├── extension.mjs              # Main extension — tools, hooks, helpers
├── extension.test.mjs         # Tests (Node test runner)
├── obsidian.config.example.json  # Example config (committed)
├── obsidian.config.json       # Your personal config (gitignored)
├── package.json               # Scripts, metadata, dev dependencies
├── eslint.config.mjs          # Linting rules
├── .github/
│   ├── ISSUE_TEMPLATE/        # Bug report & feature request templates
│   └── workflows/ci.yml       # Lint + test CI
├── LICENSE                    # MIT
└── README.md                  # Full documentation
```

### Extension architecture

The extension is a single `.mjs` file that uses the `@github/copilot-sdk` to register tools and hooks with the Copilot CLI runtime. Key concepts:

- **Tools** — functions the agent can call (e.g. `vault_read`, `vault_search`)
- **Hooks** — intercept prompts to inject context automatically (keyword matching)
- **Config** — loaded from `obsidian.config.json` at startup, with env-var fallback
- **No external dependencies** — only Node.js built-ins and `@github/copilot-sdk` (provided by CLI runtime)

### Adding a new tool

1. Add a helper function in the "Helpers" section
2. Add the tool definition in the `tools` array (name, description, parameters, handler)
3. Update `README.md` with the new tool's documentation
4. Add tests in `extension.test.mjs`
5. Run `npm run lint && npm test` to verify

### Code style

- ES modules only (`.mjs`)
- No external npm dependencies at runtime — keep the extension self-contained
- Use JSDoc comments for helper functions
- Lint with ESLint: `npm run lint`

## Pull requests

- **One feature per PR** — keeps reviews focused
- **Include tests** for new tools or changed behavior
- **Update docs** — if you add a tool, update the README tools table
- **Run CI locally** before pushing: `npm run lint && npm test`
- **Use conventional commits**: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, etc.

## Reporting bugs

Use the [bug report template](https://github.com/ericchansen/copilot-obsidian/issues/new?template=bug_report.md). Include:
- Steps to reproduce
- Expected vs actual behavior
- Your OS and Copilot CLI version
- Config (redact your vault path)

## Feature requests

Use the [feature request template](https://github.com/ericchansen/copilot-obsidian/issues/new?template=feature_request.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
