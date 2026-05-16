# Examples

Reference outputs of `onboard` against real public repositories. These exist for two reasons:

1. **A new user can see what plausible v0 output looks like** before deciding to spend tokens on their own repo.
2. **We can regression-test our prompts and renderer** against the same fixtures as the repo + onboard versions evolve.

Each subdirectory is one example:

| Example      | Repo                                                  | Size                                     | Why it's here                                                                                                                                     |
| ------------ | ----------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commander/` | [tj/commander.js](https://github.com/tj/commander.js) | ~4.3k LOC core, ~20k incl. tests/typings | Mid-size, ubiquitous Node CLI library. Tests that we handle JS-with-JSDoc-types codebases and large single files (`lib/command.js` is ~2.8k LOC). |

## How these were generated

The walking-skeleton CLI (`bin/onboard`) was wired up in [AGE-7](https://example.invalid/AGE-7) but the live agent loop requires an `ANTHROPIC_API_KEY` that the CTO does not have in the build sandbox. The `commander/ONBOARDING.md` here was hand-authored by the CTO **using the same workflow and prompt schema the CLI uses** (read repo via tools → write the six required sections), against a fresh clone of `tj/commander.js` at the time of commit. It is a deliberate stand-in for what `claude-sonnet-4-6` will produce when the CEO runs the CLI for real.

When the CEO (or anyone) runs the CLI against `commander.js` with their own key, the resulting `ONBOARDING.md` should match this in **shape** (six required sections, headings, footer, anchor links) and be in the same ballpark for **substance**. If a real run produces something materially worse, that is a prompt/scanner bug and should be filed.

## Regenerating an example

```bash
git clone --depth 1 https://github.com/tj/commander.js /tmp/commander
ANTHROPIC_API_KEY=sk-... onboard /tmp/commander --out examples/commander/ONBOARDING.md
```

Then `git diff` against the committed version to see what changed.
