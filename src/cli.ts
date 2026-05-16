import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scanRepo } from './scanner/index.js';
import { runAgent, DEFAULT_MODEL } from './agent/loop.js';
import { renderOnboarding } from './renderer/index.js';

interface ParsedArgs {
  repoPath: string;
  outPath?: string;
  model: string;
  maxTurns: number;
  dryRun: boolean;
  help: boolean;
  version: boolean;
}

const USAGE = `onboard — generate ONBOARDING.md for an unfamiliar repository.

Usage:
  onboard [repo-path] [options]

Arguments:
  repo-path                Path to the repo to document. Defaults to the current
                           working directory.

Options:
  -o, --out <path>         Where to write the file. Defaults to <repo-path>/ONBOARDING.md.
      --model <id>         Anthropic model id (default: ${DEFAULT_MODEL}).
      --max-turns <n>      Cap on agent turns (default: 24).
      --dry-run            Run the scanner only; print bundle summary and exit
                           without calling the model. Useful for verifying the
                           setup without spending tokens.
  -h, --help               Print this help.
  -v, --version            Print the package version.

Environment:
  ANTHROPIC_API_KEY        Required unless --dry-run is set. Your own key — this
                           tool sends nothing to a server we control.
`;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    repoPath: process.cwd(),
    model: DEFAULT_MODEL,
    maxTurns: 24,
    dryRun: false,
    help: false,
    version: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '-v':
      case '--version':
        out.version = true;
        break;
      case '-o':
      case '--out':
        out.outPath = argv[++i];
        break;
      case '--model':
        out.model = argv[++i] ?? out.model;
        break;
      case '--max-turns':
        out.maxTurns = Number.parseInt(argv[++i] ?? '0', 10) || out.maxTurns;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      default:
        if (a !== undefined && a.startsWith('-')) {
          throw new Error(`unknown option: ${a}`);
        }
        if (a !== undefined) positional.push(a);
    }
  }
  if (positional.length > 1) {
    throw new Error(
      `expected at most one positional argument (repo-path), got ${positional.length}`,
    );
  }
  if (positional.length === 1 && positional[0] !== undefined) {
    out.repoPath = positional[0];
  }
  return out;
}

async function readPackageVersion(): Promise<string> {
  // CLI is shipped from dist/; resolve relative to this file.
  const here = new URL('.', import.meta.url).pathname;
  // dist/ → repo root contains package.json
  const candidates = [
    path.resolve(here, '..', 'package.json'),
    path.resolve(here, '..', '..', 'package.json'),
  ];
  for (const c of candidates) {
    try {
      const raw = await fs.readFile(c, 'utf8');
      return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
    } catch {
      // try next
    }
  }
  return '0.0.0';
}

async function readTagline(repoRoot: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { description?: string };
    if (pkg.description && pkg.description.trim().length > 0) return pkg.description.trim();
  } catch {
    // not a node project; ignore
  }
  return undefined;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(
      `onboard: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`,
    );
    return 2;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`onboard ${await readPackageVersion()}\n`);
    return 0;
  }

  const repoRoot = path.resolve(args.repoPath);
  try {
    const stat = await fs.stat(repoRoot);
    if (!stat.isDirectory()) {
      process.stderr.write(`onboard: not a directory: ${repoRoot}\n`);
      return 2;
    }
  } catch {
    process.stderr.write(`onboard: cannot access path: ${repoRoot}\n`);
    return 2;
  }

  process.stderr.write(`onboard: scanning ${repoRoot}\n`);
  const scan = await scanRepo(repoRoot);
  process.stderr.write(
    `onboard: bundled ${scan.files.length} files, ${scan.totalBytes} bytes (${scan.skipped.length} skipped)\n`,
  );

  if (args.dryRun) {
    process.stdout.write(`onboard: dry-run summary\n`);
    process.stdout.write(`  top-level entries: ${scan.topLevel.join(', ')}\n`);
    process.stdout.write(`  bundled files:\n`);
    for (const f of scan.files) {
      process.stdout.write(`    - ${f.path} (${f.bytes} bytes)\n`);
    }
    if (scan.skipped.length > 0) {
      process.stdout.write(`  skipped files:\n`);
      for (const s of scan.skipped.slice(0, 20)) {
        process.stdout.write(`    - ${s.path} (${s.reason})\n`);
      }
      if (scan.skipped.length > 20) {
        process.stdout.write(`    ... and ${scan.skipped.length - 20} more\n`);
      }
    }
    return 0;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      `onboard: ANTHROPIC_API_KEY is not set.\n  Set it to your own Anthropic key and re-run. ` +
        `This tool sends the bundle to Anthropic's API with that key; nothing is sent to a server we control.\n`,
    );
    return 1;
  }

  const result = await runAgent({
    scan,
    model: args.model,
    maxTurns: args.maxTurns,
  });

  if (result.sections.length === 0) {
    process.stderr.write(
      `onboard: the agent produced no sections before stopping (stop_reason=${result.stopReason}). Not writing a file.\n`,
    );
    return 1;
  }

  const tagline = await readTagline(repoRoot);
  const repoName = path.basename(repoRoot);
  const markdown = renderOnboarding({
    repoName,
    tagline,
    sections: result.sections,
    footer: {
      generatedAt: new Date().toISOString(),
      model: args.model,
      turns: result.turns,
    },
  });

  const outPath = args.outPath ?? path.join(repoRoot, 'ONBOARDING.md');
  await fs.writeFile(outPath, markdown, 'utf8');
  process.stderr.write(
    `onboard: wrote ${outPath} (${result.sections.length}/6 sections, ${result.turns} turns)\n`,
  );
  if (result.sections.length < 6) {
    process.stderr.write(
      `onboard: WARNING — only ${result.sections.length} of 6 required sections were produced (stop_reason=${result.stopReason}).\n`,
    );
    return 1;
  }
  return 0;
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(
        `onboard: fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
