# ADR-0001: Stack and Architecture for v0

- **Status:** Proposed (pending CEO acceptance in AGE-5)
- **Date:** 2026-05-16
- **Deciders:** CTO (proposing), CEO (accepting)
- **Supersedes:** —
- **Related:** [AGE-4 — Product Brief](../../README.md) (wedge: `onboard` CLI that generates `ONBOARDING.md` for unfamiliar repos)

---

## Context

The product, locked in AGE-4, is a one-shot CLI that an outside engineer runs in an unfamiliar repo and gets back an `ONBOARDING.md` that lets them make their first contribution within a day. Success is measured against three benchmark OSS repos (FastAPI, axios, Redux Toolkit) and a 5-question rubric. There is no team yet; the CTO is the entire engineering org. We need to ship the first usable thing in weeks, not quarters.

These constraints shape every choice below:

1. **Reader-not-writer focus** — the tool reads other people's code; our own stack must not get in the way of that.
2. **Solo-builder velocity** — one engineer is doing it all. Boring, well-trodden ecosystems beat exotic ones.
3. **One-shot CLI** — no server, no marketplace, no auth. The entire user flow is `install -> cd repo -> run`.
4. **Trust ceiling** — users will feed private codebases through us. Default posture must be "nothing leaves your machine except the LLM call you opted into."
5. **One-way doors are rare here** — most of these decisions can be revisited cheaply when v1 surfaces (editor extension, web) come up. We optimize for time-to-first-run, not future-proofing.

---

## Decision

### 1. Language and runtime — **TypeScript on Node.js ≥ 20**

- Mature Anthropic SDK, full tool-use ergonomics, first-class streaming.
- Best CLI distribution story for a JS engineer audience (`npm i -g`, `npx`).
- Single-language stack from CLI to (eventual) editor extension and web — no context switching when we expand the surface.
- Strong typing recovers some safety we'd otherwise miss as a solo team.

### 2. Agent framework / LLM SDK — **Anthropic SDK directly; Claude Sonnet 4.6 as workhorse, Claude Opus 4.7 for the final synthesis pass**

- The Anthropic SDK is thin; we want full control over prompts, tool definitions, caching, and stop reasons. No framework abstractions in the way.
- Claude leads on long-context code reading, which is the entire job.
- **Prompt caching is load-bearing** — we will re-feed file contents across many turns; cache hits keep cost and latency sane.
- Sonnet for the per-turn reasoning loop; Opus for the final synthesis pass that drafts the markdown. Both stay behind the same SDK call site so we can rebalance later by changing a constant.
- Tool use is first-class in the SDK; we will register `read_file`, `list_dir`, `grep`, and an optional `run_smoke_cmd` (sandboxed, opt-in) as tools.

### 3. Repo layout — **Single-package npm CLI; flat `src/`; ADRs under `docs/adr/`**

```
repo/
  src/
    cli.ts                      # argparse, entry point
    agent/
      loop.ts                   # tool-use loop (Claude + tools)
      tools/                    # read_file, list_dir, grep, ...
      prompts/                  # system + section prompts
    scanner/                    # gitignore-aware repo bundling
    renderer/                   # ONBOARDING.md template + sections
    config/                     # defaults (no user config in v0)
  bin/onboard                   # shebang -> dist/cli.js
  docs/adr/                     # this file lives here
  package.json
  tsconfig.json
  README.md
```

No monorepo, no workspaces, no nested packages. We promote to a `pnpm` workspace **only** when the second surface (VS Code extension or web) actually starts.

### 4. Data flow

```
                ┌─────────────────────────┐
   user CLI  ─► │ `onboard [repoPath]`    │
                └────────────┬────────────┘
                             │ repo path
                             ▼
                ┌─────────────────────────────────┐
                │ Scanner                         │
                │  - gitignore-aware glob         │
                │  - size + language heuristics   │
                │  - grabs README/package.json/   │
                │    pyproject/Cargo.toml etc.    │
                └────────────┬────────────────────┘
                             │ initial context bundle
                             ▼
                ┌─────────────────────────────────┐
                │ Agent Loop (Claude + tools)     │
                │  Tools:                         │
                │   - read_file(path)             │
                │   - list_dir(path)              │
                │   - grep(pattern, glob?)        │
                │   - run_smoke_cmd (opt-in)      │
                │  Prompt cache on system + bundle│
                │  Stops on `submit_section` tool │
                │  call for each required section │
                └────────────┬────────────────────┘
                             │ structured sections
                             ▼
                ┌─────────────────────────────────┐
                │ Renderer                        │
                │  Template with 6 required parts:│
                │   how-to-run / mental-model /   │
                │   modules / flows / where-to-   │
                │   start / gotchas               │
                └────────────┬────────────────────┘
                             │
                             ▼
                  `ONBOARDING.md` at repo root
```

The agent loop is in charge — it decides what to read next via tool calls. The scanner is a fast first pass to seed the prompt; it doesn't decide what's important.

### 5. State / storage — **Stateless across invocations**

- v0 keeps **nothing** on disk between runs except the `ONBOARDING.md` it writes.
- No DB. No cache file. No login. No `.onboardrc`.
- Within a run: in-memory context only, plus Anthropic's server-side prompt cache (~5 min TTL).
- We re-do the work every invocation. This is fine for a one-shot tool and removes an entire category of bugs (stale cache, schema migration, ownership of `~/.onboard/`).

### 6. Distribution — **npm: `npx @ageless/onboard` (try) and `npm i -g @ageless/onboard` (install)**

- Single binary entry `bin/onboard`. No platform-specific builds in v0.
- API key read from `ANTHROPIC_API_KEY` env var; clear error and a doc link if missing.
- No homebrew tap, no curl-pipe-bash, no standalone binary in v0.
- Final npm scope name is TBD with CEO; placeholder `@ageless/onboard` until the brand is locked.

### 7. Telemetry posture for v0 — **None. Explicitly none.**

- v0 collects **zero** telemetry. No analytics, no opt-out flag, no Sentry, no PostHog.
- The only network traffic is the user's own LLM call to Anthropic, with their own API key.
- The README will state, in plain language: _"This tool sends repo contents to Anthropic's API for inference, using your own API key. It does not send anything to a server we control. There is no opt-out because there is no opt-in."_
- If we later need usage data we will add an **explicit opt-in flag** and document it in its own ADR. v0 must not require that trust budget.

---

## Alternatives Considered

### Language

- **Python.** Strong agent ecosystem, but CLI distribution is genuinely painful for end users (pipx, venv, conda, system-python conflicts). Our target user is a developer in _someone else's_ repo — they will not set up a Python toolchain to onboard onto a JS or Go project. Rejected on distribution friction.
- **Rust.** Best CLI distribution and runtime speed. But this product is I/O-bound on the LLM call; speed buys nothing. Tool-use boilerplate and SDK maturity are weaker. Rejected as premature optimization for a solo team shipping in weeks.
- **Go.** Solid CLI distribution. Anthropic SDK and agent libraries are less mature; tool-use ergonomics are heavier. Rejected on ecosystem fit, not capability.
- **Bun runtime instead of Node.** Tempting (fast install, native TS), but Anthropic SDK is rigorously tested on Node, npm CLI distribution assumes Node, and we don't need Bun's speed wins. Rejected as "interesting, but not now."

### Agent framework

- **LangChain / LangGraph.** Adds large abstraction surface and many dependencies for what is, in v0, one tool-use loop. Debugging gets harder, not easier. Rejected as overhead.
- **Vercel AI SDK.** Excellent DX but optimized for streaming UI in Next.js apps. We're a CLI. Wrong center of gravity.
- **OpenAI SDK.** Claude currently leads on long-context code reading and we lose Anthropic-specific prompt caching. Single-model bet keeps the prompt surface small. Rejected for v0; revisit if Anthropic regresses.
- **Roll our own loop with raw HTTP.** Pointless rebuild of code the SDK already maintains.

### Repo layout

- **Monorepo / pnpm workspace from day 1.** Premature; one consumer, one package. Rejected as overhead-without-benefit.
- **Split into `cli/`, `core/`, `tools/` packages from the start.** Same — invented modularity that costs more than it returns until the second surface exists.

### State / storage

- **SQLite cache of file embeddings.** Adds a vector DB dep and indexing complexity before we've proven the wedge. Re-running cost is acceptable in v0. Rejected as scope creep.
- **`~/.onboard/` config dir.** Defer until users actually demand customization. v0 has sensible defaults only.

### Distribution

- **Homebrew tap.** Adds release plumbing (formulae, signing) and only helps macOS users. Defer to v1.
- **Standalone binary via `pkg`/`bun build`/`nexe`.** Moves install pain into our release pipeline before any user has asked for it. Defer.
- **`curl ... | bash` install script.** Security smell and still requires Node on the host. Skip.

### Telemetry

- **Opt-out PostHog with anonymized usage events.** Even "opt-out" reads badly for a tool that touches private repos. Trust is the moat; we do not start by spending it. Rejected on principle.
- **Sentry for error reporting.** Stack traces leak file paths, env, sometimes repo data. Not worth the trust cost for v0; we'll dogfood and watch our own runs. Rejected as premature.

---

## Consequences

**What we accept by choosing this:**

- We are a TypeScript/Node shop. Any v0 hire must be comfortable in TS. (Acceptable — broad hiring pool.)
- We are betting on Claude. If model quality regresses or pricing breaks, we have switching cost. **Mitigation:** keep the LLM call surface narrow inside `src/agent/` so the SDK is swappable in one file, and write evals against the 5-question rubric so model swaps can be validated quickly (eval harness is a deliberate v0.5 task, not a v0 task).
- Statelessness means we re-do the scan + agent loop every invocation. Acceptable for one-shot use; we revisit if and when re-runs dominate the flow.
- No telemetry means we are blind to silent failures in the wild. We rely on the AGE-4 success criterion (3 benchmark repos × 5 questions, scored by us) as our quality signal until we have direct user contact.
- The `docs/adr/` precedent means future technical decisions (eval harness, model choice, packaging story, second surface) all land as ADRs in this same folder, numbered sequentially.

**What this unblocks:**

- [AGE-6 — Skeleton repo + CI green](../../README.md): the skeleton can now be scaffolded against the concrete stack chosen here (Node 20, TS, Anthropic SDK, single-package layout, no telemetry deps).
- All v0 implementation issues that follow inherit these defaults; deviations require a new ADR.

**What we revisit at v1:**

- Editor-extension surface → promote to pnpm workspace, add a `packages/extension/`.
- Persistent cache → only when re-runs become the dominant flow.
- Opt-in telemetry → only with an explicit ADR-0002-style decision.
- Packaging beyond npm → only when we have users asking for it.
