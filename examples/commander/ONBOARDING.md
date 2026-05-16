# Onboarding: commander

> the complete solution for node.js command-line programs

This file was written by [`onboard`](https://github.com/) — a one-shot CLI that reads an unfamiliar repository and produces this document. It is meant for the engineer who _did not_ write this code.

## Contents

- [How to run it](#how-to-run-it)
- [Mental model](#mental-model)
- [Modules](#modules)
- [Key flows](#key-flows)
- [Where to start](#where-to-start)
- [Gotchas](#gotchas)

## How to run it

`commander` is a library, not an application — there is nothing to "start". Onboarding is about being able to make a code change, run the suite, and ship it. Concrete commands, from the repo root:

```bash
# Node 20+ is required (see `engines.node` in package.json:73).
node --version

# Install dev dependencies (zero production dependencies — see CONTRIBUTING.md:39).
npm install

# Run the full Jest suite (~700 test files in tests/). Also runs TS type-defs check.
npm run test

# All non-test checks in one shot: TS type checks (JS via JSDoc + .d.ts files),
# ESLint, Prettier. Fails if any of them fails.
npm run check

# Auto-fix what is auto-fixable (lint + format).
npm run fix

# Run a single test file while iterating.
npx jest tests/command.action.test.js

# Sanity-check the ESM entry point separately (CommonJS is the main entry).
node ./tests/esm-imports-test.mjs
```

There is no build step in dev — `index.js` and everything in `lib/` is plain Node.js. The TypeScript surface is hand-written `.d.ts` files in `typings/`, checked in `package.json:18-20` via `tsc -p tsconfig.ts.json` and `tsd`.

## Mental model

`commander` parses `process.argv` and dispatches to your code. You build a tree of `Command` objects (root + subcommands), describe their **arguments** and **options**, attach an **action handler**, then call `program.parse()` and Commander does the rest: option/argument parsing, help text generation, error messages, exit-code handling, and (optionally) spawning subcommand executables.

The core abstractions, all defined in `lib/`:

- **`Command`** (`lib/command.js`) — a node in the command tree. Owns its options, arguments, subcommands, action handler, and help configuration. Extends Node's `EventEmitter`. Most of the public API lives here: `.command()`, `.option()`, `.argument()`, `.action()`, `.parse()`.
- **`Option`** (`lib/option.js`) — a flag declaration: short flag, long flag, whether the value is required (`<value>`) or optional (`[value]`) or variadic (`<value...>`), default, env var fallback, choices, conflicts.
- **`Argument`** (`lib/argument.js`) — a positional argument declaration: name, whether required/optional/variadic, default, choices, custom parser.
- **`Help`** (`lib/help.js`) — formats the auto-generated help text. Composable: you can subclass it or pass a `helpConfiguration` to tweak widths, sort order, and section formatting.
- **`CommanderError` / `InvalidArgumentError`** (`lib/error.js`) — the two error types thrown out to user code. `.exitOverride()` lets you catch them instead of `process.exit`.

The whole library is one tree. There is no global state, no plugin registry, no DI container. The root `Command` is exported as `program` in `index.js:7` for convenience; you can also `createCommand()` your own root if you want isolation (mostly used in tests).

## Modules

Everything ships from the repo root and `lib/`. The `tests/`, `typings/`, `docs/`, and `examples/` directories are exactly what they sound like.

- **`index.js`** — the public entry point. Re-exports `Command`, `Option`, `Argument`, `Help`, `CommanderError`, `InvalidArgumentError`, plus `program` and the `createX()` constructors. 24 lines total; this is the contract.
- **`esm.mjs`** — ESM shim that re-exports the CJS module so `import { Command } from 'commander'` works. Verified by `tests/esm-imports-test.mjs`.
- **`lib/command.js`** — the bulk of the library (~2.8k LOC). Owns parsing, option/argument resolution, help dispatch, subcommand dispatch, executable spawning, lifecycle hooks. Read this last — easier after the smaller files.
- **`lib/option.js`** — `Option` class and the `DualOptions` helper for negatable boolean options (`--color` / `--no-color`).
- **`lib/argument.js`** — `Argument` class plus `humanReadableArgName()` used by `Help`.
- **`lib/help.js`** — `Help` class and `stripColor()`. Generates the help string given a `Command`. Long but linear.
- **`lib/error.js`** — `CommanderError` (with `exitCode` and `code`) and `InvalidArgumentError`. 39 lines.
- **`lib/suggestSimilar.js`** — "did you mean …?" suggestion logic for unknown command/option names. Pulled in by error paths in `command.js`.
- **`typings/index.d.ts`** — hand-written TypeScript types for the CJS export.
- **`typings/esm.d.mts`** — TypeScript types for the ESM entry.
- **`tests/`** — Jest test suite. One file per public-API surface (e.g. `command.action.test.js`, `argument.variadic.test.js`, `option.choices.test.js`). Reading the test for a feature is usually the fastest way to learn how it's meant to behave.
- **`examples/`** — small standalone scripts demonstrating individual features (`examples/options-defaults.js`, `examples/subcommands.js`, etc.). Runnable directly with `node`.
- **`docs/`** — long-form docs that supplement `Readme.md` (e.g. `docs/options-taking-varying-arguments.md`).

## Key flows

### 1. From `program.parse(argv)` to your action callback

`command.js:1090` is the public entrypoint. It immediately delegates to `_parseCommand([], userArgs)` at `command.js:1550`, which is the recursive workhorse:

1. **Option scan** — `_parseCommand` calls `parseOptions(args)` at `command.js:1748` to split `argv` into three buckets: known options (with values), positional operands, and unknown tokens. Each option is matched against the `Command.options` array using `Option.is(arg)` (`lib/option.js`).
2. **Subcommand dispatch** — if the first operand matches a known subcommand name or alias, `_dispatchSubcommand` (`command.js:1352`) is called. If the subcommand was declared as a **stand-alone executable** (`.command('foo', 'desc')` with no action), Commander hands off to `_executeSubCommand` (`command.js:1202`), which `spawn()`s a sibling script (`command.js:1274` / `:1276`).
3. **Argument processing** — for the resolved leaf command, positional operands are walked against `Command.registeredArguments` (`command.js:_processArguments`). Custom parsers (`argument(name, desc, parseFn)`) run here; type errors become `InvalidArgumentError`.
4. **Lifecycle hooks** — `preAction` hooks run, then the user's `.action(fn)` callback (`command.js:556`), then `postAction` hooks. `parse` returns immediately; `parseAsync` (`command.js:1119`) `await`s the handler.
5. **Errors** — anything thrown that isn't a `CommanderError` propagates. `CommanderError` is caught by `_exit()` which calls `process.exit(error.exitCode)` _unless_ the user installed `.exitOverride()` (`command.js:508`), in which case it re-throws so the caller can handle it (this is the seam tests use).

### 2. Auto-generating help text

`--help`/`-h` is a real `Option` registered lazily the first time help is needed (`command.js`'s `_helpOption`). When parsing encounters it, the command short-circuits to `outputHelp()` → `helpInformation()` → `Help#formatHelp(cmd, helper)` in `lib/help.js`. `Help` is intentionally separated: every formatting decision (column widths, sort order, section ordering, whether to show globals) is a method on `Help` you can override via `configureHelp({...})` (`command.js:215`) or by subclassing and returning your subclass from `createHelp()` (`command.js:203`).

### 3. Stand-alone executable subcommands

If you call `.command('install [pkg]', 'install a package')` without an action, Commander treats `install` as a separate executable. At dispatch time (`_executeSubCommand`, `command.js:1202`), it computes the script name (`<scriptName>-<subcommand>`), resolves it relative to either `_executableDir` or the directory of `process.argv[1]`, and `childProcess.spawn`s it with `stdio: 'inherit'`. The parent process exits with whatever code the child emitted (`command.js:1306` handles signals). This is how `git`-style multi-binary tools are built on Commander.

## Where to start

A good first session, roughly in order:

1. **Read `index.js`** end-to-end (24 lines). You'll have the entire public API surface in your head.
2. **Pick one simple flow and trace it.** I recommend a tiny program that uses one option and one positional argument:
   ```js
   const { Command } = require('./index.js');
   const program = new Command();
   program
     .option('-d, --debug')
     .argument('<file>')
     .action((file, opts) => {
       console.log({ file, debug: opts.debug });
     });
   program.parse(['node', 'demo', '--debug', 'README.md']);
   ```
   Set a breakpoint at `command.js:1090` (`parse`) and step into `_parseCommand` → `parseOptions` → the action call.
3. **Read one test file that overlaps with your change.** `tests/command.action.test.js`, `tests/argument.variadic.test.js`, or `tests/command.help.test.js` are all good. The tests are imperative and easy to read.
4. **Try a small contribution.** Good first issues tend to be one of: a new validation case in `Option`/`Argument`, a help-text edge case in `lib/help.js`, or a CHANGELOG-worthy docs fix. The bar in CONTRIBUTING.md is: PR against `develop`, `npm run test` and `npm run check` both green, don't bump version or CHANGELOG.

A specific concrete exercise: add a test that fails today, then write the fix. For example, find a `// TODO`/`// FIXME` in `lib/` (`grep -rn TODO lib/`) and turn one into a failing test → patch → green.

## Gotchas

- **There are two entry points.** `index.js` (CJS) is the main one; `esm.mjs` is the ESM shim. If you change exports, update **both**, and check `tests/esm-imports-test.mjs` still passes (`npm run test-esm`). The package's `exports` map in `package.json:38-58` is the source of truth.
- **TypeScript types are hand-written, not generated.** Edits to `lib/command.js` that change a public signature also need a corresponding edit in `typings/index.d.ts` and `typings/esm.d.mts`. `tsd` is run as part of `npm run test` to catch drift between the JS and the typings.
- **Negatable options share state with their positive counterpart.** Declaring `--no-color` after `--color` rewrites the same option key (`color`). `DualOptions` in `lib/option.js` is what makes this work; if you debug option resolution and see surprising defaults, read `DualOptions` first.
- **`exitOverride()` changes error semantics globally for that `Command` tree.** Without it, Commander calls `process.exit` on usage errors. With it, errors throw, including the `--help` case (`CommanderError` with `code: 'commander.helpDisplayed'`). Tests use this almost universally; production code rarely does. If you write a new error path, decide which world you're in and test both.
- **PRs target `develop`, not `main`.** See CONTRIBUTING.md:15. Maintainers merge `develop` → `main` at release time. The repo accepts PRs against `main` at first but they will be asked to retarget.
- **Zero production dependencies is a hard line.** CONTRIBUTING.md:40 spells this out: a PR that adds a runtime dep will almost certainly be rejected and you'll be asked to find another way. `devDependencies` are fine.
- **Coverage is collected on every run** (`jest.config.js:3`). The first `npm test` is slow because of this; subsequent runs are warm. Use `npx jest <pattern>` while iterating to skip coverage on the noisy paths.
- **`copyInheritedSettings` (`command.js:99`) is the place to look when subcommand behaviour silently diverges from the parent.** Anything you want a child command to inherit (output config, help config, error display, store-options-as-properties, …) has to be in that method's body.

---

_Generated by `onboard` on 2026-05-16T20:30:00.000Z using `claude-sonnet-4-6` in 11 turns. Re-run any time the repo changes — this file is meant to be regenerated, not hand-edited._
