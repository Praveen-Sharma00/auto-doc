import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, main } from '../src/cli.ts';

describe('parseArgs', () => {
  it('defaults to cwd, default model, max-turns 24', () => {
    const args = parseArgs([]);
    expect(args.repoPath).toBe(process.cwd());
    expect(args.dryRun).toBe(false);
    expect(args.help).toBe(false);
    expect(args.maxTurns).toBe(24);
  });

  it('parses repo path positionally', () => {
    const args = parseArgs(['/tmp/x']);
    expect(args.repoPath).toBe('/tmp/x');
  });

  it('parses --out, --model, --max-turns', () => {
    const args = parseArgs(['/tmp/x', '--out', 'O.md', '--model', 'm', '--max-turns', '8']);
    expect(args.outPath).toBe('O.md');
    expect(args.model).toBe('m');
    expect(args.maxTurns).toBe(8);
  });

  it('parses --dry-run, -h, -v', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });

  it('errors on unknown options', () => {
    expect(() => parseArgs(['--no-such-flag'])).toThrow(/unknown option/);
  });

  it('errors on multiple positional args', () => {
    expect(() => parseArgs(['/a', '/b'])).toThrow();
  });
});

describe('main (dry-run path)', () => {
  let root: string;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('runs without an API key in dry-run mode', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'onboard-cli-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo' }));
    await fs.writeFile(path.join(root, 'README.md'), '# demo\n');
    const code = await main([root, '--dry-run']);
    expect(code).toBe(0);
  });

  it('returns 2 for unknown path', async () => {
    const code = await main(['/definitely/not/a/real/path/xyz123', '--dry-run']);
    expect(code).toBe(2);
  });

  it('-h prints help and exits 0', async () => {
    const code = await main(['-h']);
    expect(code).toBe(0);
  });
});
