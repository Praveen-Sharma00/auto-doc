# onboard

Run one command in an unfamiliar repo and get back an `ONBOARDING.md` that lets you make your first contribution in under a day. `onboard` is a one-shot CLI for the engineer who _didn't_ write the code — a new hire on day 1, an OSS contributor sizing up a project, or the solo dev who inherited a mess. It reads the repo with tools, asks the questions a newcomer doesn't yet know to ask, and writes a single markdown file at the repo root: how to run it, the mental model, the module map, the main flows, where to start, and the gotchas.

## Status

**v0 walking skeleton.** The CLI works end-to-end: scanner → agent loop (Anthropic SDK, Claude Sonnet 4.6, tool surface: `read_file`, `list_dir`, `grep`, `submit_section`) → renderer. No polish, no auth, no web UI. Single command, single user, single machine.

See `examples/commander/ONBOARDING.md` for a reference output against [tj/commander.js](https://github.com/tj/commander.js).

## Quick start

```bash
# 1. Install dependencies (TypeScript project, Node 20+).
make install

# 2. Build the CLI.
npm run build

# 3. Set your own Anthropic API key. `onboard` sends nothing to a server we
#    control — only to Anthropic, with this key.
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Run it on any repo on your machine. Output is written to <repo>/ONBOARDING.md.
node bin/onboard /path/to/some/repo
```

If you want to see what the scanner will send to the model **before** spending any tokens:

```bash
node bin/onboard /path/to/some/repo --dry-run
```

`--dry-run` runs the scanner only, prints the bundled file list, and exits without calling Anthropic.

## CLI

```
onboard [repo-path] [options]

Arguments:
  repo-path                Repo to document. Defaults to cwd.

Options:
  -o, --out <path>         Where to write the file. Defaults to <repo-path>/ONBOARDING.md.
      --model <id>         Anthropic model id (default: claude-sonnet-4-6).
      --max-turns <n>      Cap on agent turns (default: 24).
      --dry-run            Scanner-only mode. No API call, no token spend.
  -h, --help               Print help.
  -v, --version            Print the package version.

Environment:
  ANTHROPIC_API_KEY        Required unless --dry-run is set. Your own key.
```

## What it does

1. **Scans** the repo (`src/scanner/`): walks the tree, respects `.gitignore`, prioritises manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, …) and source code, skips binaries and `node_modules`/`dist`/etc. Caps total bundle at ~250 KB.
2. **Runs an agent loop** (`src/agent/loop.ts`): sends the bundle to Claude with a system prompt and four tools — `read_file`, `list_dir`, `grep`, and `submit_section`. The model reads whatever it needs, then submits each of the six required sections.
3. **Renders** (`src/renderer/render.ts`): combines the six sections into a single `ONBOARDING.md` with a table of contents and a regen footer.

The six required sections (in order):

1. **How to run it** — concrete install / test / lint commands.
2. **Mental model** — what the thing is, in one paragraph, plus the 3-5 core concepts.
3. **Modules** — top-level directory map with responsibilities.
4. **Key flows** — 2-3 end-to-end flows traced through the code, with file paths.
5. **Where to start** — good-first-issue spots, a reading order, a tiny exercise.
6. **Gotchas** — non-obvious things that will trip up a newcomer.

## Trust posture

This tool sends repo contents to Anthropic's API for inference, using **your own API key**. It does not send anything to a server we control. There is no telemetry, no analytics, no opt-out flag — because there is no opt-in. State is in-memory only; the only thing on disk after a run is the `ONBOARDING.md` it wrote.

## Architecture

The full v0 stack and reasoning is in [ADR-0001](docs/adr/0001-stack-and-architecture.md). Short version: TypeScript on Node 20, Anthropic SDK directly (no agent framework), single-package npm CLI, stateless across invocations.

## Development

```bash
make ci              # format + lint + typecheck + test, all in one shot
npm run test         # 35 unit tests across scanner / renderer / agent / cli
npm run build        # emit dist/ for production
node bin/onboard --help
```

CI runs on every PR via GitHub Actions; see `.github/workflows/` and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
