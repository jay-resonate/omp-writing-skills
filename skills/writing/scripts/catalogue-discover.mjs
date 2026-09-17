#!/usr/bin/env node
/**
 * Find cliché candidates by measurement instead of guesswork.
 *
 * Compares word and bigram frequency in model output against a baseline corpus
 * and ranks the over-represented tokens the catalogue does not already catch.
 * Cross-model beats model-vs-human: identical prompts hold the topic constant.
 * A candidate is a lead for CATALOGUE.md, never an automatic catalogue entry.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGUE_VERSION, collectMatches, maskProtected } from "./cliche-lint.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const TYPOGRAPHY = [
  ["em dash", /\u2014/g],
  ["en dash", /\u2013/g],
  ["curly quote", /[\u2018\u2019\u201c\u201d]/g],
  ["semicolon", /;/g],
  ["ellipsis", /\u2026|\.\.\./g],
  ["bold span", /\*\*[^*\n]+\*\*/g],
];

function walk(root, exts, out = []) {
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    out.push(root);
    return out;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(root, entry.name), exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(path.join(root, entry.name));
    }
  }
  return out;
}

// Frontmatter is metadata, and fenced code is quoted evidence: neither is prose.
function prose(text) {
  const body = text.startsWith("---\n") ? text.slice(text.indexOf("\n---", 3) + 4) : text;
  return maskProtected(body);
}

function tokens(text) {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9'\u2019-]*/g) || [];
}

function tally(files, minLen) {
  const uni = new Map();
  const bi = new Map();
  let words = 0;
  let chars = 0;
  const typo = new Map(TYPOGRAPHY.map(([name]) => [name, 0]));
  const bump = (map, key, file) => {
    let e = map.get(key);
    if (!e) map.set(key, (e = { count: 0, docs: new Set() }));
    e.count += 1;
    e.docs.add(file);
  };
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const text = prose(raw);
    const w = tokens(text);
    words += w.length;
    chars += text.length;
    for (const [name, re] of TYPOGRAPHY) {
      typo.set(name, typo.get(name) + (text.match(re) || []).length);
    }
    for (let i = 0; i < w.length; i++) {
      if (w[i].length >= minLen) bump(uni, w[i], file);
      if (i + 1 < w.length) bump(bi, `${w[i]} ${w[i + 1]}`, file);
    }
  }
  return { uni, bi, words, chars, typo, docs: files.length };
}

// Additive smoothing keeps a token that is absent from the baseline from scoring
// as infinitely over-represented on a single sighting.
function rate(count, words) {
  return ((count + 0.5) / Math.max(words, 1)) * 1000;
}

function rank(sample, baseline, sampleWords, baselineWords, { minDocs, top }) {
  const rows = [];
  let caught = 0;
  for (const [token, e] of sample) {
    if (e.docs.size < minDocs) continue;
    if (collectMatches(token).length) {
      caught += 1;
      continue;
    }
    const base = baseline.get(token);
    const rs = rate(e.count, sampleWords);
    const rb = rate(base ? base.count : 0, baselineWords);
    rows.push({ token, docs: e.docs.size, count: e.count, rs, rb, score: rs / rb });
  }
  rows.sort((a, b) => b.score - a.score || b.count - a.count);
  return { rows: rows.slice(0, top), caught };
}

function table(title, { rows, caught }) {
  console.log(`\n## ${title}`);
  if (!rows.length) {
    console.log("no candidates above the thresholds");
  } else {
    console.log("score\tper1k\tbase1k\tdocs\ttoken");
    for (const r of rows) {
      console.log(`${r.score.toFixed(1)}\t${r.rs.toFixed(2)}\t${r.rb.toFixed(2)}\t${r.docs}\t${r.token}`);
    }
  }
  console.log(`(${caught} already caught by catalogue ${CATALOGUE_VERSION})`);
}

function parseArgs(argv) {
  const args = { samples: [], baseline: [], ignore: [], minDocs: 3, top: 25, minLen: 4, exts: [".md", ".markdown", ".txt"] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const list = () => (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (a === "--samples") args.samples = list();
    else if (a === "--baseline") args.baseline = list();
    else if (a === "--ext") args.exts = list();
    else if (a === "--ignore") args.ignore.push(...list());
    else if (a === "--min-docs") args.minDocs = Number(argv[++i]);
    else if (a === "--top") args.top = Number(argv[++i]);
    else if (a === "--min-len") args.minLen = Number(argv[++i]);
    else if (a === "-h" || a === "--help") return { help: true };
    else return { error: `unknown flag: ${a}` };
  }
  return args;
}

function usage() {
  return `usage: catalogue-discover.mjs --samples dir[,dir] --baseline dir[,dir]
                             [--ignore substr] [--min-docs 3] [--top 25] [--min-len 4] [--ext .md,.txt]
Ranks over-represented tokens missing from the catalogue. Always exits 0 unless misused.
Pasted CLI logs swamp the ranking with topic nouns, so --ignore them out of the corpus.`;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.error || !args.samples.length || !args.baseline.length) {
    if (args.error) console.error(args.error);
    console.error(usage());
    return 2;
  }
  const keep = (f) => !args.ignore.some((s) => f.includes(s));
  const sampleFiles = args.samples.flatMap((d) => walk(d, args.exts)).filter(keep);
  const baselineFiles = args.baseline.flatMap((d) => walk(d, args.exts)).filter(keep);
  if (!sampleFiles.length || !baselineFiles.length) {
    console.error(`no files found (samples ${sampleFiles.length}, baseline ${baselineFiles.length})`);
    return 2;
  }
  const s = tally(sampleFiles, args.minLen);
  const b = tally(baselineFiles, args.minLen);
  console.log(`samples  ${s.docs} docs, ${s.words} words`);
  console.log(`baseline ${b.docs} docs, ${b.words} words`);
  console.log(`thresholds: min-docs ${args.minDocs}, min-len ${args.minLen}, top ${args.top}`);

  table("Words", rank(s.uni, b.uni, s.words, b.words, args));
  table("Bigrams", rank(s.bi, b.bi, s.words, b.words, args));

  console.log("\n## Typography per 1k words");
  console.log("tell\tsample\tbaseline");
  for (const [name] of TYPOGRAPHY) {
    const rs = (s.typo.get(name) / Math.max(s.words, 1)) * 1000;
    const rb = (b.typo.get(name) / Math.max(b.words, 1)) * 1000;
    console.log(`${name}\t${rs.toFixed(2)}\t${rb.toFixed(2)}`);
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}

export { rank, tally, prose, tokens };
