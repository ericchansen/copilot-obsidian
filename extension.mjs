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
import { join, basename, relative, sep } from "node:path";
import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Vault path resolution order:
//   1. OBSIDIAN_VAULT_PATH  environment variable  (exact path)
//   2. OBSIDIAN_VAULT_NAME  environment variable  (folder name under default root)
//   3. Default: ~/ObsidianVaults/MyVault
const DEFAULT_VAULTS_ROOT = join(
  process.env.USERPROFILE || process.env.HOME || "~",
  "ObsidianVaults",
);

function resolveVaultPath() {
  if (process.env.OBSIDIAN_VAULT_PATH) return process.env.OBSIDIAN_VAULT_PATH;
  const name = process.env.OBSIDIAN_VAULT_NAME || "MyVault";
  return join(DEFAULT_VAULTS_ROOT, name);
}

const VAULT_PATH = resolveVaultPath();

// Context-injection keywords — when the user mentions any of these, the
// extension injects a list of top-level folders and recent notes as context.
// Override with OBSIDIAN_KEYWORDS (comma-separated).
const CONTEXT_KEYWORDS = (
  process.env.OBSIDIAN_KEYWORDS || "vault,obsidian,note,knowledge"
)
  .toLowerCase()
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Substring search across the entire vault. Returns matches with snippets. */
function searchVault(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();
  for (const folder of listFolders()) {
    const dirPath = join(VAULT_PATH, folder);
    for (const file of readdirSync(dirPath).filter((f) => f.endsWith(".md"))) {
      const content = readFileSync(join(dirPath, file), "utf-8");
      if (content.toLowerCase().includes(lowerQuery)) {
        const name = file.replace(/\.md$/, "");
        const idx = content.toLowerCase().indexOf(lowerQuery);
        const start = Math.max(0, idx - 100);
        const end = Math.min(content.length, idx + query.length + 100);
        results.push({
          folder,
          name,
          snippet: content.substring(start, end).replace(/\n/g, " ").trim(),
        });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

const session = await joinSession({
  onPermissionRequest: approveAll,

  hooks: {
    onSessionStart: async () => {
      await session.log(
        `📓 Obsidian extension loaded — vault: ${VAULT_PATH}`,
      );
    },

    // Inject vault context when the user mentions relevant keywords.
    onUserPromptSubmitted: async (input) => {
      const prompt = input.prompt.toLowerCase();
      const mentionsVault = CONTEXT_KEYWORDS.some((k) => prompt.includes(k));
      if (!mentionsVault) return;

      const folders = listFolders();
      const folderList = folders
        .map((f) => {
          const notes = listNotes(f);
          return `- **${f}/** (${notes.length} notes)`;
        })
        .join("\n");

      return {
        additionalContext: [
          `[Obsidian Vault] The user has an Obsidian vault at ${VAULT_PATH}.`,
          `Folders:\n${folderList}`,
          `Use vault_read, vault_write, vault_list, vault_search, and vault_summary tools to interact with it.`,
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
            description:
              "Vault folder name (e.g. 'Projects', 'DailyNotes'). Use vault_list_folders to discover available folders.",
          },
          name: {
            type: "string",
            description:
              "Note name without the .md extension (e.g. 'Meeting Notes', '2026-03-19').",
          },
        },
        required: ["folder", "name"],
      },
      handler: async (args) => {
        const content = readNote(args.folder, args.name);
        if (!content)
          return {
            textResultForLlm: `Note not found: ${args.folder}/${args.name}.md`,
            resultType: "failure",
          };
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
          folder: {
            type: "string",
            description: "Vault folder to write into. Will be created if it doesn't exist.",
          },
          name: {
            type: "string",
            description: "Note name without .md extension.",
          },
          content: {
            type: "string",
            description:
              "Full markdown content of the note, including optional YAML frontmatter.",
          },
        },
        required: ["folder", "name", "content"],
      },
      handler: async (args) => {
        const filePath = writeNote(args.folder, args.name, args.content);
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
          folder: {
            type: "string",
            description:
              "Folder to list notes from. Omit to list top-level folders instead.",
          },
        },
      },
      handler: async (args) => {
        if (!args.folder) {
          const folders = listFolders();
          if (folders.length === 0) return `Vault is empty: ${VAULT_PATH}`;
          const lines = folders.map((f) => {
            const count = listNotes(f);
            return `- **${f}/** (${count.length} notes)`;
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
        "Search across all notes in the Obsidian vault for a keyword or phrase. Returns matching notes with surrounding context snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for across all vault notes.",
          },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const results = searchVault(args.query);
        if (results.length === 0) return `No results for "${args.query}"`;
        return `Found ${results.length} match(es) for "${args.query}":\n\n${results
          .map((r) => `**${r.folder}/${r.name}**\n> ...${r.snippet}...`)
          .join("\n\n")}`;
      },
    },

    // ---- vault_summary -----------------------------------------------------
    {
      name: "vault_summary",
      description:
        "Get a high-level summary of the Obsidian vault: folders, note counts, and total [[wikilink]] connections.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const folders = listFolders();
        const lines = folders.map((f) => {
          const notes = listNotes(f);
          return `- **${f}:** ${notes.length} note(s)${notes.length > 0 ? " — " + notes.join(", ") : ""}`;
        });

        let totalLinks = 0;
        let totalNotes = 0;
        for (const folder of folders) {
          const dirPath = join(VAULT_PATH, folder);
          if (!existsSync(dirPath)) continue;
          for (const file of readdirSync(dirPath).filter((f) =>
            f.endsWith(".md"),
          )) {
            totalNotes++;
            const content = readFileSync(join(dirPath, file), "utf-8");
            const links = content.match(/\[\[[^\]]+\]\]/g);
            if (links) totalLinks += links.length;
          }
        }

        return [
          `## Obsidian Vault Summary`,
          `**Path:** ${VAULT_PATH}`,
          `**Notes:** ${totalNotes}`,
          `**Wikilinks:** ${totalLinks}`,
          ``,
          ...lines,
        ].join("\n");
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
          name: {
            type: "string",
            description: "Note name without .md extension.",
          },
        },
        required: ["folder", "name"],
      },
      handler: async (args) => {
        const filePath = join(VAULT_PATH, args.folder, `${args.name}.md`);
        if (!existsSync(filePath))
          return {
            textResultForLlm: `Note not found: ${args.folder}/${args.name}.md`,
            resultType: "failure",
          };
        unlinkSync(filePath);
        return `Deleted: ${filePath}`;
      },
    },

    // ---- vault_rename ------------------------------------------------------
    {
      name: "vault_rename",
      description:
        "Rename or move a note within the vault. Updates the file on disk; does NOT update wikilinks in other notes.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Current folder." },
          name: { type: "string", description: "Current note name (no .md)." },
          new_folder: {
            type: "string",
            description:
              "Destination folder. Omit to keep in the same folder.",
          },
          new_name: {
            type: "string",
            description: "New note name (no .md). Omit to keep the same name.",
          },
        },
        required: ["folder", "name"],
      },
      handler: async (args) => {
        const srcPath = join(VAULT_PATH, args.folder, `${args.name}.md`);
        if (!existsSync(srcPath))
          return {
            textResultForLlm: `Note not found: ${args.folder}/${args.name}.md`,
            resultType: "failure",
          };
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
