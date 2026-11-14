---
name: graphify
description: Build and query local Graphify knowledge graphs for project architecture, code relationships, dependencies, and change impact. Use when the user asks for Graphify, a project map, or dependency tracing, especially when graphify-out/graph.json exists.
---

# Graphify

Use the official `graphifyy[sql]==0.9.108` package through the bundled
`scripts/run.py`. This is a project integration for Graphify, not its hosted
service. Requires Python 3.10–3.14 and a terminal. The first run downloads the
package using uv, or an isolated Python environment when uv is unavailable.

## Workflow

1. Resolve the intended repository and read its applicable instructions.
   For GitHub-only access, clone the authorized repository or retrieve an
   authorized source snapshot. Do not claim full coverage of missing files.
2. Run the helper from the project root, or pass `--project /absolute/path`.
   Use the helper path inside this skill; do not assume a globally installed CLI.
3. For a new map, run `python <skill>/scripts/run.py build`.
   The default is local code/SQL structural extraction. Documents and media
   semantic analysis are excluded. No model API key or live database is needed.
4. For an existing map, compare its `built_at_commit` and current source state.
   Rebuild after source changes. An installed skill alone is not a built graph.
5. Query narrowly, inspect the cited source, and distinguish extracted and
   inferred relationships. An absent relationship is not proof it does not exist.

```bash
python <skill>/scripts/run.py build
python <skill>/scripts/run.py query "checkout inventory"
python <skill>/scripts/run.py explain "checkout"
python <skill>/scripts/run.py affected "checkout"
python <skill>/scripts/run.py path "checkout" "stock"
python <skill>/scripts/run.py version
```

For project installations, `<skill>` is `.agents/skills/graphify`.
For the personal ChatGPT skill, use this skill's resolved absolute directory.
On Windows, `py` can replace `python`.

## Output and limits

- Read `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md`.
  Report extraction failures, skipped files, and empty graphs accurately.
- Graphs aid investigation; they do not prove security, accounting correctness,
  runtime behavior, or project completion. Verify changes with appropriate tests.
- Keep generated graphs, environments, secrets, and customer data out of Git.
  Respect `.graphifyignore` and `.gitignore`; never connect a live database as
  part of a routine map build.
- Do not enable cloud sync, semantic API calls, or a public MCP server merely
  to answer a local code question. These are separate operations.
- If terminal execution or source access is unavailable, state the limitation
  and use available source search. Do not invent a completed Graphify run.

See [references/upstream.md](references/upstream.md) for provenance and scope.
