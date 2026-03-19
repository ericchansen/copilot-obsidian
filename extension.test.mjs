// Tests for copilot-obsidian helper functions.
// Uses Node's built-in test runner (node --test).
// We test the pure helper logic by re-implementing the testable parts here,
// since extension.mjs imports @github/copilot-sdk which isn't available
// outside the Copilot CLI runtime.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Re-implement the helper functions from extension.mjs so we can test them
// without requiring @github/copilot-sdk. These must stay in sync with the
// extension source.
// ---------------------------------------------------------------------------

function walkVault(dir, relDir = "") {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkVault(abs, rel));
    } else if (entry.name.endsWith(".md")) {
      results.push({ folder: relDir || ".", name: entry.name.replace(/\.md$/, ""), absPath: abs });
    }
  }
  return results;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    }
    if (typeof value === "string") {
      value = value.replace(/^["']|["']$/g, "");
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body: match[2] };
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function findBacklinks(vaultPath, targetName) {
  const allNotes = walkVault(vaultPath);
  const results = [];
  const patterns = [`[[${targetName}]]`, `[[${targetName}|`];
  const lower = patterns.map((p) => p.toLowerCase());
  for (const note of allNotes) {
    const content = readFileSync(note.absPath, "utf-8");
    const contentLower = content.toLowerCase();
    if (lower.some((p) => contentLower.includes(p))) {
      results.push({ folder: note.folder, name: note.name });
    }
  }
  return results;
}

function listFolders(vaultPath) {
  if (!existsSync(vaultPath)) return [];
  return readdirSync(vaultPath).filter((f) => {
    if (f.startsWith(".")) return false;
    return statSync(join(vaultPath, f)).isDirectory();
  });
}

function listNotes(vaultPath, folder) {
  const dirPath = join(vaultPath, folder);
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
}

function readNote(vaultPath, folder, name) {
  const filePath = join(vaultPath, folder, `${name}.md`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

function writeNote(vaultPath, folder, name, content) {
  const dirPath = join(vaultPath, folder);
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  const filePath = join(dirPath, `${name}.md`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function searchVault(vaultPath, query, filters = {}) {
  const results = [];
  const lowerQuery = query ? query.toLowerCase() : null;
  const allNotes = walkVault(vaultPath);
  for (const note of allNotes) {
    const content = readFileSync(note.absPath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);
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
    if (lowerQuery && !content.toLowerCase().includes(lowerQuery)) continue;
    results.push({ folder: note.folder, name: note.name, frontmatter });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_VAULT = join(tmpdir(), `copilot-obsidian-test-${Date.now()}`);

function setupVault() {
  mkdirSync(join(TEST_VAULT, "Projects"), { recursive: true });
  mkdirSync(join(TEST_VAULT, "People"), { recursive: true });
  mkdirSync(join(TEST_VAULT, "DailyNotes"), { recursive: true });
  mkdirSync(join(TEST_VAULT, ".obsidian"), { recursive: true }); // should be ignored

  writeFileSync(join(TEST_VAULT, "Projects", "Alpha.md"), [
    "---",
    "type: project",
    "status: active",
    "tags: [engineering, cloud]",
    "---",
    "",
    "# Project Alpha",
    "",
    "A cloud migration project. See [[Bob Smith]] for details.",
    "Related to [[Beta]].",
  ].join("\n"));

  writeFileSync(join(TEST_VAULT, "Projects", "Beta.md"), [
    "---",
    "type: project",
    "status: completed",
    "tags: [engineering]",
    "---",
    "",
    "# Project Beta",
    "",
    "Completed project. Preceded [[Alpha]].",
  ].join("\n"));

  writeFileSync(join(TEST_VAULT, "People", "Bob Smith.md"), [
    "---",
    "type: person",
    "tags: [contact, engineering]",
    "---",
    "",
    "# Bob Smith",
    "",
    "Works on [[Alpha]] and [[Beta]].",
  ].join("\n"));

  writeFileSync(join(TEST_VAULT, "DailyNotes", "2026-03-19.md"), [
    "---",
    "date: 2026-03-19",
    "tags: [daily]",
    "---",
    "",
    "# 2026-03-19",
    "",
    "Met with [[Bob Smith]] about [[Alpha]].",
  ].join("\n"));
}

function teardownVault() {
  if (existsSync(TEST_VAULT)) {
    rmSync(TEST_VAULT, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("walkVault", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("finds all .md files recursively", () => {
    const notes = walkVault(TEST_VAULT);
    assert.equal(notes.length, 4);
    const names = notes.map((n) => n.name).sort();
    assert.deepEqual(names, ["2026-03-19", "Alpha", "Beta", "Bob Smith"]);
  });

  it("ignores dotfiles and dotfolders", () => {
    // .obsidian should be skipped
    writeFileSync(join(TEST_VAULT, ".obsidian", "config.json"), "{}");
    const notes = walkVault(TEST_VAULT);
    assert.ok(notes.every((n) => !n.absPath.includes(".obsidian")));
  });

  it("returns empty array for non-existent directory", () => {
    const notes = walkVault(join(TEST_VAULT, "nonexistent"));
    assert.deepEqual(notes, []);
  });
});

describe("parseFrontmatter", () => {
  it("parses simple key-value frontmatter", () => {
    const { frontmatter, body } = parseFrontmatter("---\ntype: project\nstatus: active\n---\n\n# Hello");
    assert.equal(frontmatter.type, "project");
    assert.equal(frontmatter.status, "active");
    assert.ok(body.includes("# Hello"));
  });

  it("parses array values in brackets", () => {
    const { frontmatter } = parseFrontmatter("---\ntags: [a, b, c]\n---\nBody");
    assert.deepEqual(frontmatter.tags, ["a", "b", "c"]);
  });

  it("handles quoted strings", () => {
    const { frontmatter } = parseFrontmatter('---\ntitle: "My Note"\n---\nBody');
    assert.equal(frontmatter.title, "My Note");
  });

  it("returns empty frontmatter when no YAML block", () => {
    const { frontmatter, body } = parseFrontmatter("# Just a heading\n\nSome text.");
    assert.deepEqual(frontmatter, {});
    assert.ok(body.includes("# Just a heading"));
  });

  it("handles empty frontmatter block", () => {
    const { frontmatter } = parseFrontmatter("---\n---\nBody");
    assert.deepEqual(frontmatter, {});
  });
});

describe("renderTemplate", () => {
  it("replaces known placeholders", () => {
    const result = renderTemplate("# {{title}}\nDate: {{date}}", { title: "Test", date: "2026-01-01" });
    assert.equal(result, "# Test\nDate: 2026-01-01");
  });

  it("leaves unknown placeholders as-is", () => {
    const result = renderTemplate("{{title}} {{unknown}}", { title: "Hello" });
    assert.equal(result, "Hello {{unknown}}");
  });

  it("handles empty vars", () => {
    const result = renderTemplate("{{a}} and {{b}}", {});
    assert.equal(result, "{{a}} and {{b}}");
  });
});

describe("listFolders", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("lists top-level folders excluding dotfolders", () => {
    const folders = listFolders(TEST_VAULT);
    assert.ok(folders.includes("Projects"));
    assert.ok(folders.includes("People"));
    assert.ok(folders.includes("DailyNotes"));
    assert.ok(!folders.includes(".obsidian"));
  });
});

describe("listNotes", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("lists notes without .md extension", () => {
    const notes = listNotes(TEST_VAULT, "Projects");
    assert.deepEqual(notes.sort(), ["Alpha", "Beta"]);
  });

  it("returns empty array for non-existent folder", () => {
    const notes = listNotes(TEST_VAULT, "Nonexistent");
    assert.deepEqual(notes, []);
  });
});

describe("readNote / writeNote", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("reads an existing note", () => {
    const content = readNote(TEST_VAULT, "Projects", "Alpha");
    assert.ok(content.includes("# Project Alpha"));
  });

  it("returns null for missing note", () => {
    assert.equal(readNote(TEST_VAULT, "Projects", "Nonexistent"), null);
  });

  it("writes a new note and reads it back", () => {
    writeNote(TEST_VAULT, "Projects", "Gamma", "# Gamma\n\nNew project.");
    const content = readNote(TEST_VAULT, "Projects", "Gamma");
    assert.ok(content.includes("# Gamma"));
  });

  it("creates folder if it does not exist", () => {
    writeNote(TEST_VAULT, "NewFolder", "Test", "content");
    assert.ok(existsSync(join(TEST_VAULT, "NewFolder", "Test.md")));
  });
});

describe("searchVault", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("finds notes by text query", () => {
    const results = searchVault(TEST_VAULT, "cloud migration");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Alpha");
  });

  it("filters by frontmatter type", () => {
    const results = searchVault(TEST_VAULT, null, { type: "person" });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Bob Smith");
  });

  it("filters by frontmatter status", () => {
    const results = searchVault(TEST_VAULT, null, { status: "completed" });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Beta");
  });

  it("combines text query with frontmatter filter", () => {
    const results = searchVault(TEST_VAULT, "cloud", { type: "project" });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Alpha");
  });

  it("returns empty for no match", () => {
    const results = searchVault(TEST_VAULT, "xyzzy_no_match");
    assert.equal(results.length, 0);
  });

  it("filters by tags", () => {
    const results = searchVault(TEST_VAULT, null, { tags: "cloud" });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Alpha");
  });
});

describe("findBacklinks", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("finds notes linking to a target", () => {
    const links = findBacklinks(TEST_VAULT, "Alpha");
    const names = links.map((l) => l.name).sort();
    assert.ok(names.includes("Beta"));
    assert.ok(names.includes("Bob Smith"));
    assert.ok(names.includes("2026-03-19"));
  });

  it("finds links with aliases [[Target|alias]]", () => {
    writeNote(TEST_VAULT, "Projects", "WithAlias", "See [[Alpha|the alpha project]] for details.");
    const links = findBacklinks(TEST_VAULT, "Alpha");
    assert.ok(links.some((l) => l.name === "WithAlias"));
  });

  it("returns empty when no backlinks exist", () => {
    writeNote(TEST_VAULT, "Projects", "Lonely", "# No links here");
    const links = findBacklinks(TEST_VAULT, "Lonely");
    assert.deepEqual(links, []);
  });

  it("is case-insensitive", () => {
    writeNote(TEST_VAULT, "Projects", "CaseTest", "Links to [[alpha]] lowercase.");
    const links = findBacklinks(TEST_VAULT, "Alpha");
    assert.ok(links.some((l) => l.name === "CaseTest"));
  });
});

describe("vault file operations", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("delete removes a note", () => {
    const filePath = join(TEST_VAULT, "Projects", "Alpha.md");
    assert.ok(existsSync(filePath));
    unlinkSync(filePath);
    assert.ok(!existsSync(filePath));
  });

  it("rename moves a note to a new location", () => {
    const src = join(TEST_VAULT, "Projects", "Alpha.md");
    const dest = join(TEST_VAULT, "Projects", "AlphaRenamed.md");
    renameSync(src, dest);
    assert.ok(!existsSync(src));
    assert.ok(existsSync(dest));
  });

  it("rename moves a note across folders", () => {
    const src = join(TEST_VAULT, "Projects", "Beta.md");
    const dest = join(TEST_VAULT, "People", "Beta.md");
    renameSync(src, dest);
    assert.ok(!existsSync(src));
    assert.ok(existsSync(dest));
  });
});

describe("append", () => {
  beforeEach(setupVault);
  afterEach(teardownVault);

  it("appends content to an existing note", () => {
    const filePath = join(TEST_VAULT, "Projects", "Alpha.md");
    const before = readFileSync(filePath, "utf-8");
    appendFileSync(filePath, "\n## New Section\n\nAppended content.", "utf-8");
    const after = readFileSync(filePath, "utf-8");
    assert.ok(after.includes("# Project Alpha"));
    assert.ok(after.includes("## New Section"));
    assert.ok(after.includes("Appended content."));
    assert.ok(after.length > before.length);
  });

  it("creates the note if it doesn't exist", () => {
    const filePath = join(TEST_VAULT, "Projects", "NewNote.md");
    assert.ok(!existsSync(filePath));
    writeFileSync(filePath, "# New\n\nCreated via append.", "utf-8");
    assert.ok(existsSync(filePath));
    assert.ok(readFileSync(filePath, "utf-8").includes("Created via append."));
  });

  it("preserves frontmatter when appending", () => {
    const filePath = join(TEST_VAULT, "Projects", "Alpha.md");
    appendFileSync(filePath, "\n## Addendum\n\nMore info.", "utf-8");
    const { frontmatter, body } = parseFrontmatter(readFileSync(filePath, "utf-8"));
    assert.equal(frontmatter.type, "project");
    assert.ok(body.includes("## Addendum"));
  });
});
