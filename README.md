# onboard

Run one command in an unfamiliar repo and get back an `ONBOARDING.md` that lets you make your first contribution in under a day. `onboard` is a one-shot CLI for the engineer who _didn't_ write the code — a new hire on day 1, an OSS contributor sizing up a project, or the solo dev who inherited a mess. It reads the repo proactively, asks the questions a newcomer doesn't yet know to ask, and writes a single markdown file at the repo root: how to run it, the mental model, the module map, the main flows, where to start, and the gotchas.

## Status

Pre-v0. The product brief is locked ([AGE-4](/AGE/issues/AGE-4)); the stack and architecture are locked ([ADR-0001](docs/adr/0001-stack-and-architecture.md)). This repo is the chassis — no product code yet.

## Quick start (chassis-only)

```bash
# install dependencies
make install

# run the four chassis checks
make format     # prettier --check
make lint       # eslint
make typecheck  # tsc --noEmit
make test       # vitest run

# or run all of them
make ci
```

## How it will work (per ADR-0001)

- Single npm CLI, distributed as `npx onboard` and `npm i -g onboard`.
- Stateless: nothing on disk between runs except the `ONBOARDING.md` it writes.
- LLM call goes to Anthropic with the user's own `ANTHROPIC_API_KEY`. **No telemetry. Nothing leaves your machine except the LLM call you opted into.**

See [docs/adr/](docs/adr/) for architecture decisions and [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop.

## License

MIT — see [LICENSE](LICENSE).
