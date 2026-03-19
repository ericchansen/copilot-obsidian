// Extension: copilot-obsidian
// A GitHub Copilot CLI extension that connects your Obsidian vault
// to the Copilot agent — read, write, search, and manage notes
// directly from the terminal.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Configuration — config file with env-var fallback
// ---------------------------------------------------------------------------

const HOME = process.env.USERPROFILE || process.env.HOME || "~";
const EXTENSION_DIR = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));

/** Load obsidian.config.json from the extension directory, if it exists. */
function loadConfig() {
  const configPath = join(EXTENSION_DIR, "obsidian.config.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch { /* fall through to defaults */ }
  }
  return {};
}

const CONFIG = loadConfig();

// Vault path: config.vault > OBSIDIAN_VAULT_PATH > OBSIDIAN_VAULT_NAME > default
function resolveVaultPath() {
  if (CONFIG.vault) return CONFIG.vault.replace(/^~/, HOME);
  if (process.env.OBSIDIAN_VAULT_PATH) return process.env.OBSIDIAN_VAULT_PATH;
  const name = process.env.OBSIDIAN_VAULT_NAME || "MyVault";
  return join(HOME, "ObsidianVaults", name);
}

const VAULT_PATH = resolveVaultPath();

// Context-injection keywords
const CONTEXT_KEYWORDS = (
  CONFIG.keywords
    ? CONFIG.keywords
    : (process.env.OBSIDIAN_KEYWORDS || "vault,obsidian,note,knowledge")
        .split(",")
        .map((k) => k.trim())
).map((k) => k.toLowerCase()).filter(Boolean);

// Daily note settings
const DAILY_FOLDER = CONFIG.daily?.folder || "DailyNotes";
const DAILY_TEMPLATE = CONFIG.daily?.template || "---\ndate: {{date}}\n---\n\n# {{date}}\n\n## Notes\n\n";

// Templates from config
const TEMPLATES = CONFIG.templates || {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .md files under a directory.
 *  Returns array of { folder, name, absPath } where folder is relative to vault root. */
function walkVault(dir = VAULT_PATH, relDir = "") {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkVault(abs, rel));
    } else if (entry.name.endsWith(".md")) {
      results.push({
        folder: relDir || ".",
        name: entry.name.replace(/\.md$/, ""),
        absPath: abs,
      });
    }
  }
  return results;
}

/** Return all top-level folders in the vault (excluding dotfiles). */
function listFolders() {
  if (!existsSync(VAULT_PATH)) return [];
  return readdirSync(VAULT_PATH).filter((f) => {
    if (f.startsWith(".")) return false;
    return statSync(join(VAULT_PATH, f)).isDirectory();
  });
}

/** List markdown files in a folder (non-recursive). */
function listNotes(folder) {
  const dirPath = join(VAULT_PATH, folder);
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

/** Read a single note. Returns null if not found. */
function readNote(folder, name) {
  const filePath = join(VAULT_PATH, folder, `${name}.md`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

/** Write (create or overwrite) a note. Returns the absolute path written. */
function writeNote(folder, name, content) {
  const dirPath = join(VAULT_PATH, folder);
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  const filePath = join(dirPath, `${name}.md`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/** Parse YAML frontmatter from markdown content. Returns { frontmatter, body }. */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    // Handle simple arrays: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    }
    // Handle quoted strings
    if (typeof value === "string") {
      value = value.replace(/^["']|["']$/g, "");
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body: match[2] };
}

/** Render a template string with {{key}} placeholders. */
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Get today's date as YYYY-MM-DD. */
function today() {
  return new Date().toISOString().split("T")[0];
}

/** Substring search across the entire vault (recursive). Supports optional frontmatter filters. */
function searchVault(query, filters = {}) {
  const results = [];
  const lowerQuery = query ? query.toLowerCase() : null;
  const allNotes = walkVault();

  for (const note of allNotes) {
    const content = readFileSync(note.absPath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);

    // Apply frontmatter filters
    let filterMatch = true;
    for (const [key, val] of Object.entries(filters)) {
      const fmVal = frontmatter[key];
      if (!fmVal) { filterMatch = false; break; }
      const fmLower = Array.isArray(fmVal)
        ? fmVal.map((v) => String(v).toLowerCase())
        : [String(fmVal).toLowerCase()];
      if (!fmLower.some((v) => v.includes(val.toLowerCase()))) { filterMatch = false; break; }
    }
    if (!filterMatch) continue;

    // Text search (skip if no query — filter-only mode)
    if (lowerQuery && !content.toLowerCase().includes(lowerQuery)) continue;

    // Build snippet
    let snippet = "";
    if (lowerQuery) {
      const idx = content.toLowerCase().indexOf(lowerQuery);
      const start = Math.max(0, idx - 100);
      const end = Math.min(content.length, idx + query.length + 100);
      snippet = content.substring(start, end).replace(/\n/g, " ").trim();
    } else {
      snippet = content.substring(0, 200).replace(/\n/g, " ").trim();
    }

    results.push({
      folder: note.folder,
      name: note.name,
      frontmatter,
      snippet,
    });
  }
  return results;
}

/** Find all notes that contain a [[wikilink]] to the given note name. */
function findBacklinks(targetName) {
  const allNotes = walkVault();
  const results = [];
  // Match [[targetName]] or [[targetName|alias]]
  const patterns = [
    `[[${targetName}]]`,
    `[[${targetName}|`,
  ];
  const lower = patterns.map((p) => p.toLowerCase());

  for (const note of allNotes) {
    if (note.name === targetName && note.folder === ".") continue;
    const content = readFileSync(note.absPath, "utf-8");
    const contentLower = content.toLowerCase();
    if (lower.some((p) => contentLower.includes(p))) {
      // Extract snippet around the link
      const idx = Math.max(
        contentLower.indexOf(lower[0]),
        contentLower.indexOf(lower[1]),
      );
      const start = Math.max(0, idx - 80);
      const end = Math.min(content.length, idx + targetName.length + 80);
      results.push({
        folder: note.folder,
        name: note.name,
        snippet: content.substring(start, end).replace(/\n/g, " ").trim(),
      });
    }
  }
  return results;
}

/** Get recently modified notes across the vault, sorted by mtime desc. */
function recentNotes(limit = 10) {
  const allNotes = walkVault();
  const withMtime = allNotes.map((note) => {
    const stat = statSync(note.absPath);
    return { ...note, mtime: stat.mtimeMs, modified: stat.mtime.toISOString() };
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

const session = await joinSession({
  onPermissionRequest: approveAll,

  hooks: {
    onSessionStart: async () => {
      const configSource = CONFIG.vault ? "config file" : (process.env.OBSIDIAN_VAULT_PATH ? "env var" : "default");
      await session.log(
        `📓 Obsidian extension loaded — vault: ${VAULT_PATH} (${configSource})`,
      );
    },

    onUserPromptSubmitted: async (input) => {
      const prompt = input.prompt.toLowerCase();
      const mentionsVault = CONTEXT_KEYWORDS.some((k) => prompt.includes(k));
      if (!mentionsVault) return;

      const folders = listFolders();
      const folderList = folders
        .map((f) => {
          const notes = listNotes(f);
          const desc = CONFIG.folders?.[f]?.description;
          return `- **${f}/** (${notes.length} notes)${desc ? " — " + desc : ""}`;
        })
        .join("\n");

      return {
        additionalContext: [
          `[Obsidian Vault] The user has an Obsidian vault at ${VAULT_PATH}.`,
          `Folders:\n${folderList}`,
          `Tools: vault_read, vault_write, vault_list, vault_search, vault_summary, vault_backlinks, vault_recent, vault_daily, vault_delete, vault_rename.`,
        ].join("\n"),
      };
    },
  },

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------
  tools: [
    // ---- vault_read --------------------------------------------------------
    {
      name: "vault_read",
      description:
        "Read a note from the Obsidian vault. Returns the full markdown content.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Vault folder name (e.g. 'Projects', 'DailyNotes'). Use vault_list to discover folders.",
          },
          name: {
            type: "string",
            description: "Note name without .md extension.",
          },
        },
        required: ["folder", "name"],
      },
      handler: async (args) => {
        const content = readNote(args.folder, args.name);
        if (!content)
          return { textResultForLlm: `Note not found: ${args.folder}/${args.name}.md`, resultType: "failure" };
        return content;
      },
    },

    // ---- vault_write -------------------------------------------------------
    {
      name: "vault_write",
      description:
        "Create or update a note in the Obsidian vault. Use [[wikilinks]] for cross-references. Include YAML frontmatter when appropriate.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Vault folder to write into. Created if it doesn't exist." },
          name: { type: "string", description: "Note name without .md extension." },
          content: { type: "string", description: "Full markdown content including optional YAML frontmatter." },
          template: { type: "string", description: "Optional: name of a template from config to use as the base content. Template variables ({{date}}, {{title}}) are auto-filled." },
        },
        required: ["folder", "name"],
      },
      handler: async (args) => {
        let content = args.content;
        if (!content && args.template && TEMPLATES[args.template]) {
          content = renderTemplate(TEMPLATES[args.template], { date: today(), title: args.name });
        }
        if (!content) {
          return { textResultForLlm: "Either content or a valid template name is required.", resultType: "failure" };
        }
        const filePath = writeNote(args.folder, args.name, content);
        return `Note written: ${filePath}`;
      },
    },

    // ---- vault_list --------------------------------------------------------
    {
      name: "vault_list",
      description:
        "List all notes in a vault folder, or list all top-level folders if no folder is specified.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder to list. Omit to list top-level folders." },
        },
      },
      handler: async (args) => {
        if (!args.folder) {
          const folders = listFolders();
          if (folders.length === 0) return `Vault is empty: ${VAULT_PATH}`;
          const lines = folders.map((f) => {
            const count = listNotes(f);
            const desc = CONFIG.folders?.[f]?.description;
            return `- **${f}/** (${count.length} notes)${desc ? " — " + desc : ""}`;
          });
          return `Vault folders:\n${lines.join("\n")}`;
        }
        const notes = listNotes(args.folder);
        if (notes.length === 0) return `No notes in ${args.folder}/`;
        return `${args.folder}/ (${notes.length} notes):\n${notes.map((n) => `- ${n}`).join("\n")}`;
      },
    },

    // ---- vault_search ------------------------------------------------------
    {
      name: "vault_search",
      description:
        "Search across all notes in the Obsidian vault. Supports text search and/or frontmatter filters (e.g. type, status, tags). Searches recursively through all folders.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for. Omit to search by frontmatter filters only." },
          type: { type: "string", description: "Filter by frontmatter 'type' field (e.g. 'meeting', 'person', 'topic')." },
          status: { type: "string", description: "Filter by frontmatter 'status' field (e.g. 'active', 'open')." },
          tags: { type: "string", description: "Filter by frontmatter 'tags' field (partial match)." },
        },
      },
      handler: async (args) => {
        const filters = {};
        if (args.type) filters.type = args.type;
        if (args.status) filters.status = args.status;
        if (args.tags) filters.tags = args.tags;
        if (!args.query && Object.keys(filters).length === 0) {
          return { textResultForLlm: "Provide a query and/or frontmatter filters (type, status, tags).", resultType: "failure" };
        }
        const results = searchVault(args.query || null, filters);
        if (results.length === 0) return `No results found.`;
        return `Found ${results.length} match(es):\n\n${results
          .map((r) => {
            const fm = Object.entries(r.frontmatter).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" | ");
            return `**${r.folder}/${r.name}**${fm ? ` [${fm}]` : ""}\n> ...${r.snippet}...`;
          })
          .join("\n\n")}`;
      },
    },

    // ---- vault_summary -----------------------------------------------------
    {
      name: "vault_summary",
      description:
        "High-level vault overview: folders, note counts, wikilink stats, and config info.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const folders = listFolders();
        const lines = folders.map((f) => {
          const notes = listNotes(f);
          const desc = CONFIG.folders?.[f]?.description;
          return `- **${f}:** ${notes.length} note(s)${desc ? " — " + desc : ""}`;
        });

        let totalLinks = 0;
        let totalNotes = 0;
        const allNotes = walkVault();
        for (const note of allNotes) {
          totalNotes++;
          const content = readFileSync(note.absPath, "utf-8");
          const links = content.match(/\[\[[^\]]+\]\]/g);
          if (links) totalLinks += links.length;
        }

        const configSource = CONFIG.vault ? "obsidian.config.json" : "environment / defaults";
        return [
          `## Obsidian Vault Summary`,
          `**Path:** ${VAULT_PATH}`,
          `**Config:** ${configSource}`,
          `**Notes:** ${totalNotes} (across ${folders.length} folders)`,
          `**Wikilinks:** ${totalLinks}`,
          ``,
          ...lines,
        ].join("\n");
      },
    },

    // ---- vault_backlinks ---------------------------------------------------
    {
      name: "vault_backlinks",
      description:
        "Find all notes that contain a [[wikilink]] to the given note. Essential for understanding how knowledge is connected in the vault.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Note name to find backlinks for (e.g. 'ProjectAlpha'). Searched as [[name]] across all vault notes." },
        },
        required: ["name"],
      },
      handler: async (args) => {
        const results = findBacklinks(args.name);
        if (results.length === 0) return `No backlinks found for [[${args.name}]].`;
        return `Found ${results.length} note(s) linking to [[${args.name}]]:\n\n${results
          .map((r) => `**${r.folder}/${r.name}**\n> ...${r.snippet}...`)
          .join("\n\n")}`;
      },
    },

    // ---- vault_recent ------------------------------------------------------
    {
      name: "vault_recent",
      description:
        "List the most recently modified notes in the vault, sorted by last-modified time.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max notes to return (default 10)." },
        },
      },
      handler: async (args) => {
        const notes = recentNotes(args.limit || 10);
        if (notes.length === 0) return "No notes in vault.";
        return `Recently modified notes:\n\n${notes
          .map((n, i) => `${i + 1}. **${n.folder}/${n.name}** — ${n.modified.split("T")[0]} ${n.modified.split("T")[1]?.slice(0, 5) || ""}`)
          .join("\n")}`;
      },
    },

    // ---- vault_daily -------------------------------------------------------
    {
      name: "vault_daily",
      description:
        "Read today's daily note, or create it from a template if it doesn't exist. Optionally specify a different date.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
        },
      },
      handler: async (args) => {
        const date = args.date || today();
        const existing = readNote(DAILY_FOLDER, date);
        if (existing) return `## Daily Note: ${date}\n\n${existing}`;

        // Create from template
        const content = renderTemplate(DAILY_TEMPLATE, { date, title: date });
        const filePath = writeNote(DAILY_FOLDER, date, content);
        return `Created daily note: ${filePath}\n\n${content}`;
      },
    },

    // ---- vault_delete ------------------------------------------------------
    {
      name: "vault_delete",
      description: "Delete a note from the vault. Use with caution.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Vault folder." },
          name: { type: "string", description: "Note name without .md extension." },
        },
        required: ["folder", "name"],
      },
      handler: async (args) => {
        const filePath = join(VAULT_PATH, args.folder, `${args.name}.md`);
        if (!existsSync(filePath))
          return { textResultForLlm: `Note not found: ${args.folder}/${args.name}.md`, resultType: "failure" };
        unlinkSync(filePath);
        return `Deleted: ${filePath}`;
      },
    },

    // ---- vault_rename ------------------------------------------------------
    {
      name: "vault_rename",
      description:
        "Rename or move a note within the vault. Does NOT update wikilinks in other notes.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Current folder." },
          name: { type: "string", description: "Current note name (no .md)." },
          new_folder: { type: "string", description: "Destination folder. Omit to keep same." },
          new_name: { type: "string", description: "New note name (no .md). Omit to keep same." },
        },
        required: ["folder", "name"],
      },
      handler: async (args) => {
        const srcPath = join(VAULT_PATH, args.folder, `${args.name}.md`);
        if (!existsSync(srcPath))
          return { textResultForLlm: `Note not found: ${args.folder}/${args.name}.md`, resultType: "failure" };
        const destFolder = args.new_folder || args.folder;
        const destName = args.new_name || args.name;
        const destDir = join(VAULT_PATH, destFolder);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        const destPath = join(destDir, `${destName}.md`);
        renameSync(srcPath, destPath);
        return `Renamed: ${srcPath} → ${destPath}`;
      },
    },
  ],
});

await session.log(
  "📓 Obsidian vault connected — use vault_list to explore, vault_search to find content",
);
