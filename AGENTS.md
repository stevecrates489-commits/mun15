<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->

## Tool Selection Strategy — Graft vs codebase-memory-mcp

Two context systems index this repo. Pick by task shape:

### Use Graft for orientation and subsystem understanding
- High-level architecture orientation: `graft map` (directory clusters,
  per-directory hubs, global hotspots) — run it first in a new area.
- Understanding what a subsystem does: `graft ask "<question>" --source`.
- Reading the generated linked-markdown guides under `graft/` (start at
  `graft/INDEX.md`, follow the `covers:` links) before opening any source.
- Cheap API-surface skims: `graft skeleton <file>`.
- Exhaustive literal search over the index: `graft grep "<literal>"`.
- The MCP tools (`graft_repo_map`, `graft_file_api`, `graft_find_code`,
  `graft_find_all`, `graft_trace_calls`, `graft_check_freshness`) are the
  same graph exposed interactively.

### Use codebase-memory-mcp for deep structure and safe changes
- Deep structural queries on the symbol/edge graph: `search_graph`,
  `query_graph` (multi-hop Cypher, cycles, aggregation).
- Impact analysis before any refactor or rename — trace every caller/callee
  first (`query_graph`, `trace_path`) so nothing is missed.
- Tracing exact call chains and data flow between two points (`trace_path`).
- Cross-file refactors, dead-code detection (zero incoming edges),
  cross-service links, route maps (`get_architecture`).
- Staleness/coverage checks before trusting an answer (`detect_changes`,
  `check_index_coverage`).

### Rule of thumb
- **Orienting, exploring, "how does this area work?"** → Graft first
  (markdown guides are cheaper than graph queries or file reads).
- **Changing code, renaming, refactoring, "what breaks if I edit this?"** →
  codebase-memory-mcp (exact graph evidence, not ranked hints).
- Graft's ranked answers are top-N; for exhaustive obligations use
  `graft grep` or a codebase-memory graph query, never ranking alone.
- Keep both fresh: `graft build` after big code changes; re-index
  codebase-memory-mcp (`index_repository`) after large merges, branch
  switches, or dependency upgrades.

### Environment note (WSL)
The `graft` CLI is a Windows-side npm global; from WSL invoke it through
`cmd.exe /c "graft <cmd> \"C:\Users\aryan\Documents\aim project\""`. The
graft MCP server loads only when opencode is started from this project
folder (it is registered in the project-level `opencode.json`); in sessions
started elsewhere, fall back to the CLI — the graph is the same.
