import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { frontMatterRegion, frontMatterViolation, parseFrontMatter } from "./frontmatter.mjs";

const SRC = "---\npublished: 2025-08-19\n---\n\n# Title\n\nbody\n";
const SRC_PLAIN = '<a href="x">Edit</a>\n\n# Title\n\nbody\n';
const code = (s, t) => (frontMatterViolation(s, t) || {}).code ?? null;

test("a matching block is not a violation", () => {
  assert.equal(code(SRC, "---\npublished: 2025-08-19\n---\n\n# Заголовок\n"), null);
});

test("no front matter on either side is not a violation", () => {
  assert.equal(code(SRC_PLAIN, SRC_PLAIN), null);
});

test("an opener the source lacks is caught (the build breaker)", () => {
  assert.equal(code(SRC_PLAIN, `---\n${SRC_PLAIN}`), "stray-opener");
});

test("a duplicated opener is caught", () => {
  assert.equal(code(SRC, "---\n---\npublished: 2025-08-19\n---\n\n# T\n"), "duplicated-opener");
});

test("a translated key is caught", () => {
  assert.equal(code(SRC, "---\nwotae: 2025-08-19\n---\n\n# T\n"), "mismatch");
});

test("a lost opening delimiter is caught", () => {
  assert.equal(code(SRC, "bipụtara: 2025-08-19\n---\n\n# T\n"), "dropped");
});

test("a block pushed down by a blank line is caught — Jekyll anchors at the first line", () => {
  assert.equal(code(SRC, "\n---\npublished: 2025-08-19\n---\n\n# T\n"), "unanchored");
});

test("an opener that never closes is caught", () => {
  assert.equal(code(SRC, "---\npublished: 2025-08-19\n\n# T\n"), "unterminated");
});

test("a changed value is caught, and named", () => {
  const v = frontMatterViolation(SRC, "---\npublished: 2024-01-01\n---\n\n# T\n");
  assert.equal(v.code, "mismatch");
  assert.match(v.message, /values differ/);
});

test("a differing key set is named as keys, not values", () => {
  const v = frontMatterViolation(SRC, "---\nwotae: 2025-08-19\n---\n\n# T\n");
  assert.match(v.message, /keys wotae != source published/);
});

test("line endings are not part of the comparison", () => {
  assert.equal(code(SRC, "---\r\npublished: 2025-08-19\r\n---\r\n\r\n# T\r\n"), null);
});

test("a UTF-8 BOM does not hide an opener, as it does not from Jekyll", () => {
  assert.equal(code(SRC_PLAIN, `﻿---\n${SRC_PLAIN}`), "stray-opener");
});

test("a body line containing a colon is not mistaken for front matter", () => {
  assert.equal(code(SRC_PLAIN, "Note: this is body text\n\n# T\n"), null);
});

test("parseFrontMatter returns the block and where the body starts", () => {
  const fm = parseFrontMatter(SRC);
  assert.deepEqual(fm.block, ["published: 2025-08-19"]);
  assert.equal(SRC.split("\n")[fm.end], "");
});

test("parseFrontMatter treats an unterminated opener as no front matter", () => {
  assert.equal(parseFrontMatter("---\npublished: 2025-08-19\n"), null);
});

test("a block Jekyll cannot parse is caught even when both files share it", () => {
  const broken = "---\npublished: [\n---\n\n# T\n";
  const v = frontMatterViolation(broken, broken);
  assert.equal(v.code, "invalid");
  assert.match(v.message, /source/);
});

test("an unquoted colon in a value is caught — the classic build failure", () => {
  const broken = "---\npublished: a: b\n---\n\n# T\n";
  assert.equal(frontMatterViolation(broken, broken).code, "invalid");
});

test("a translation-only unparseable block names the translation, not the source", () => {
  const v = frontMatterViolation(SRC, "---\npublished: {a}\n---\n\n# T\n");
  assert.equal(v.code, "invalid");
  assert.doesNotMatch(v.message, /source/);
});

test("an empty value is valid YAML and not a violation", () => {
  const empty = "---\npublished:\n---\n\n# T\n";
  assert.equal(frontMatterViolation(empty, empty), null);
});

test("an indented '---' is body to Jekyll, so it is not front matter here either", () => {
  assert.equal(parseFrontMatter(" ---\npublished: 2025-08-19\n---\n"), null);
});

test("'...' closes a block, as it does for Jekyll", () => {
  assert.deepEqual(parseFrontMatter("---\npublished: 2025-08-19\n...\n\n# T\n").block, ["published: 2025-08-19"]);
});

test("a trailing space after the date is not a difference", () => {
  const s = "---\npublished: 2023-10-23 \n---\n\n# T\n";
  assert.equal(frontMatterViolation(s, s), null);
});

test("a quoted scalar is valid however it is punctuated", () => {
  const q = '---\ntitle: "Foo: Bar"\n---\n\n# T\n';
  assert.equal(frontMatterViolation(q, q), null);
});

test("an unclosed quote is not", () => {
  const q = '---\ntitle: "Foo\n---\n\n# T\n';
  assert.equal(frontMatterViolation(q, q).code, "invalid");
});

test("an indented lookalike in the body is body, not a stray opener", () => {
  assert.equal(frontMatterViolation(SRC_PLAIN, ` ---\n${SRC_PLAIN}`), null);
});

test("a blank line above an indented lookalike is body too", () => {
  assert.equal(frontMatterViolation(SRC_PLAIN, `\n ---\n${SRC_PLAIN}`), null);
});

test("a non-ASCII key is valid YAML, so it reads as a mismatch and not as unparseable", () => {
  const v = frontMatterViolation(SRC, "---\nbipụtara: 2025-08-19\n---\n\n# T\n");
  assert.equal(v.code, "mismatch");
  assert.match(v.message, /bipụtara/);
});

test("an empty block is valid front matter when the source has one too", () => {
  assert.equal(frontMatterViolation("---\n---\nbody\n", "---\n---\nbody\n"), null);
});

test("a value opening a block sequence is caught — Psych rejects it", () => {
  const broken = "---\npublished: - x\n---\n\n# T\n";
  assert.equal(frontMatterViolation(broken, broken).code, "invalid");
});

test("an unterminated opener in the source is not front matter, so mirroring it is fine", () => {
  const src = "---\npublished: 2025-08-19\n\n# T\n";
  assert.equal(frontMatterViolation(src, src), null);
});

test("…but closing a block the source never closes is out of step", () => {
  const src = "---\npublished: 2025-08-19\n\n# T\n";
  assert.equal(frontMatterViolation(src, SRC).code, "mismatch");
});

test("frontMatterRegion isolates the block, so a body edit is not a block edit", () => {
  assert.equal(frontMatterRegion(SRC), "---\npublished: 2025-08-19\n---");
  assert.equal(frontMatterRegion(`${SRC}more body\n`), frontMatterRegion(SRC));
});

test("frontMatterRegion captures the mangled remains of a block", () => {
  assert.equal(frontMatterRegion("bipụtara: 2025-08-19\n---\n\nbody\n"), "bipụtara: 2025-08-19\n---");
});

test("frontMatterRegion is empty for a page with no front matter of any shape", () => {
  assert.equal(frontMatterRegion("# Title\n\nbody\n"), "");
});

test("frontMatterRegion distinguishes two different broken blocks of the same kind", () => {
  const a = "---\nwotintimii: 2024-01-12\n---\n\n# T\n";
  const b = "---\nwotintimii: 9999-99-99\n---\n\n# T\n";
  assert.equal(frontMatterViolation(SRC, a).code, frontMatterViolation(SRC, b).code);
  assert.notEqual(frontMatterRegion(a), frontMatterRegion(b));
});

// Exercise the real local gate, not just its parser. A contributor can run the
// documented checks before staging a newly written translation.
function cliFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zechub-frontmatter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, source] of [
    ["scripts/check-frontmatter.mjs", new URL("../../scripts/check-frontmatter.mjs", import.meta.url)],
    ["translation/lib/frontmatter.mjs", new URL("./frontmatter.mjs", import.meta.url)],
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(source, join(root, path));
  }
  const git = (...args) => execFileSync("git", [
    "-c", "user.name=Frontmatter test", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args,
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  write("site/Existing.md", SRC);
  write("translations/fr/site/Existing.md", SRC);
  write("site/New page ü.md", SRC);
  write(".gitignore", "translations/fr/site/Ignored.md\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  const run = (scoped) => {
    const index = readFileSync(join(root, ".git/index"));
    const result = spawnSync(process.execPath, [
      "scripts/check-frontmatter.mjs", ...(scoped ? ["--base", base] : []),
    ], { cwd: root, encoding: "utf8", timeout: 15_000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.deepEqual(readFileSync(join(root, ".git/index")), index, "the checker must not stage files");
    return result;
  };
  return { root, write, git, run };
}

for (const scoped of [false, true]) {
  const mode = scoped ? "--base" : "whole-tree";

  test(`CLI ${mode}: reject an untracked translation before staging it`, (t) => {
    const f = cliFixture(t);
    const path = "translations/fr/site/New page ü.md";
    const text = "---\npublished: 2024-01-01\n---\n# Nouveau\n";
    f.write(path, text);
    const r = f.run(scoped);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(path), r.stderr);
    assert.match(r.stderr, /values differ/);
    assert.equal(readFileSync(join(f.root, path), "utf8"), text, "check mode must not repair the page");
    assert.equal(f.git("ls-files", "--", path), "", "the page remains untracked");
  });

  test(`CLI ${mode}: count a valid new translation once before and after staging`, (t) => {
    const f = cliFixture(t);
    const path = "translations/fr/site/New page ü.md";
    f.write(path, SRC);
    for (const phase of ["untracked", "staged", "committed"]) {
      if (phase === "staged") f.git("add", path);
      if (phase === "committed") f.git("commit", "-qm", "new translation");
      const r = f.run(scoped);
      assert.equal(r.status, 0, `${phase}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /holds for 2 translated page\(s\)/, phase);
    }
  });

  test(`CLI ${mode}: keep tracked pages, but skip ignored, deleted and unrelated files`, (t) => {
    const f = cliFixture(t);
    // A tracked file remains eligible even if an ignore rule now matches it.
    f.write(".gitignore", "translations/fr/site/Ignored.md\ntranslations/fr/site/New page ü.md\n");
    f.write("translations/fr/site/New page ü.md", SRC);
    f.git("add", "-f", "translations/fr/site/New page ü.md");
    f.write("site/Ignored.md", SRC);
    f.write("translations/fr/site/Ignored.md", "# Missing front matter\n");
    f.write("translations/fr/notes.md", "---\nnot: [\n---\n");
    f.write("translations/fr/site/New.txt", "# Not Markdown\n");
    rmSync(join(f.root, "translations/fr/site/Existing.md"));
    const r = f.run(scoped);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /holds for 1 translated page\(s\)/);
  });

  test(`CLI ${mode}: tracked edits still block before and after staging`, (t) => {
    const f = cliFixture(t);
    const path = "translations/fr/site/Existing.md";
    f.write(path, "# Missing front matter\n");
    for (const staged of [false, true]) {
      if (staged) f.git("add", path);
      const r = f.run(scoped);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.ok(r.stderr.includes(path), r.stderr);
      assert.match(r.stderr, /has no front matter/);
    }
  });
}
