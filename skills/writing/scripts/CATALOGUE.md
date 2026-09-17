# Cliché catalogue: provenance and maintenance

Catalogue version `1.1.0`. Lives in `cliche-lint.mjs`; this file is the procedure and the
history. Nothing here is loaded by the skill at runtime, so it costs no context.

Tells decay. Each model family brings new ones, and old ones fade as models are trained
against them. A catalogue that is never pruned gets quietly worse every release, so every
entry carries a source and the version it shipped in, and every change is recorded below.

## Inspecting the catalogue

```bash
cliche-lint.mjs --version          # catalogue version
cliche-lint.mjs --list             # id, name, since, group, then the source per group
cliche-lint.mjs --list --json      # same, machine readable, for a sweep or a report
```

Entries inherit `group`, `since`, and `source` from `SOURCES` when they do not set them.
An entry in a group with no source fails `--self-test`, so provenance cannot be skipped.

## Adding a tell

1. Find it by measuring, not by taste. `catalogue-discover.mjs` ranks words and bigrams that
   are over-represented in model output against a baseline corpus and hides anything the
   catalogue already catches.

   ```bash
   catalogue-discover.mjs --samples corpus/samples/modelA,corpus/samples/modelB \
                          --baseline corpus/baseline --ignore /data/ --min-docs 3
   ```

   Model against model on identical prompts is the reliable comparison, because the topic is
   held constant. Model against human only works with a large baseline in the same genre: a
   run of engineering PR bodies against a corpus of instruction files ranks `lambda` and
   `predictive-models`, which are subject matter, not style. Pasted CLI output swamps the
   ranking the same way, so `--ignore` it out. Fenced code, inline code, and YAML front
   matter are already stripped.

2. Require two independent sightings, and a `--min-docs` floor of at least 3, so a one-off
   artifact does not become a rule.
3. Write the narrowest pattern that captures the shape. Prefer function words and repeated
   structure over content words. A detector that bans a noun is a blacklist, not a tell.
4. Add `patternCases` entries that pass and entries that must not fire. A new detector with
   no negative case is how false positives ship.
5. Give the entry an explicit `since` and `source`, bump `CATALOGUE_VERSION`, and add a line
   to the history below.

## Retiring a tell

Delete the entry and its cases, note it below with the reason, and bump the version. Never
loosen a detector in place to silence a false positive: either the shape is wrong, in which
case fix the pattern, or the tell has faded, in which case remove it.

## Typography

`catalogue-discover.mjs` also reports em dash, en dash, curly quote, semicolon, ellipsis,
and bold-span rates per 1000 words for both corpora. Word frequency cannot see these, and
they are the most register-sensitive signals in the report: literary and typeset prose uses
em dashes heavily, so the em dash is a tell of plain typed text such as posts, markdown, and
mail, not of prose in general.

## History

### 1.1.0
- Provenance and versioning: `SOURCES` per group, `since` per entry, `--version`,
  `--list --json`, and a self-test that fails an entry with no source.
- `catalogue-discover.mjs` added for measured discovery and typography rates.
- No detector added or removed.

### 1.0.0
- Initial port of the Willison LLM cliché highlighter detectors, plus the Wikipedia
  Signs of AI writing group. 38 entries.
- List-marker and table-row fixes to `sentence-anaphora` and `echo-triad`: markdown
  structure is not prose.
