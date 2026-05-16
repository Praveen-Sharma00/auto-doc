# Contributing

Short version: `make install && make ci` should pass on a fresh checkout. If it doesn't, that's a bug — open an issue.

## Dev loop

```bash
make install     # one-time
make ci          # run all four checks before pushing
```

The four checks (also runnable individually):

| Check     | Command          | What it does         |
| --------- | ---------------- | -------------------- |
| Format    | `make format`    | `prettier --check .` |
| Lint      | `make lint`      | `eslint .`           |
| Typecheck | `make typecheck` | `tsc --noEmit`       |
| Test      | `make test`      | `vitest run`         |

`make format-write` applies prettier fixes in-place.

## Requirements

- Node.js ≥ 20 (per [ADR-0001](docs/adr/0001-stack-and-architecture.md))
- npm (ships with Node)

## Architecture decisions

Every non-trivial technical decision lands as a numbered ADR under [`docs/adr/`](docs/adr/). Read the existing ADRs before proposing a new one. If you're changing the stack or shape of the system, write a new ADR, don't edit an old one.

## Commit style

- Small, logical commits.
- Imperative subject ("Add scanner", not "Added scanner").
- Reference the issue identifier in the commit body when relevant (`AGE-6`, `AGE-7`, ...).

## CI

GitHub Actions runs the four checks on every push and pull request. CI must be green before merge to `main`.
