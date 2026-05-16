import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../../src/scanner/index.ts';

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onboard-scan-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
  return root;
}

describe('scanRepo', () => {
  let root: string;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('bundles seed manifests first', async () => {
    root = await makeRepo({
      'package.json': JSON.stringify({ name: 'x' }),
      'README.md': '# X',
      'src/lib.ts': 'export const x = 1;\n',
    });
    const scan = await scanRepo(root);
    const paths = scan.files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('src/lib.ts');
    // seeds first
    expect(paths.indexOf('package.json')).toBeLessThan(paths.indexOf('src/lib.ts'));
  });

  it('respects .gitignore', async () => {
    root = await makeRepo({
      '.gitignore': 'secrets/\n*.log\n',
      'src/a.ts': '// a\n',
      'secrets/key.ts': 'export const SECRET = "x";\n',
      'debug.log': 'line\n',
      'app.ts': '// app\n',
    });
    const scan = await scanRepo(root);
    const paths = scan.files.map((f) => f.path);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('app.ts');
    expect(paths).not.toContain('secrets/key.ts');
    expect(paths.find((p) => p.endsWith('.log'))).toBeUndefined();
  });

  it('skips node_modules / .git / dist / build automatically', async () => {
    root = await makeRepo({
      'src/a.ts': '// a\n',
      'node_modules/dep/index.js': '// dep\n',
      '.git/HEAD': 'ref: refs/heads/main\n',
      'dist/a.js': '// dist\n',
      'build/a.js': '// build\n',
    });
    const scan = await scanRepo(root);
    const paths = scan.files.map((f) => f.path);
    expect(paths).toContain('src/a.ts');
    expect(paths.find((p) => p.startsWith('node_modules'))).toBeUndefined();
    expect(paths.find((p) => p.startsWith('.git'))).toBeUndefined();
    expect(paths.find((p) => p.startsWith('dist'))).toBeUndefined();
    expect(paths.find((p) => p.startsWith('build'))).toBeUndefined();
  });

  it('skips binary files even if extension is allowed', async () => {
    root = await makeRepo({
      'src/a.ts': '// a\n',
    });
    // Write a binary blob with an allowed extension
    const fake = Buffer.from([0, 1, 2, 3, 0, 5, 0, 7, 0, 9]);
    await fs.writeFile(path.join(root, 'src/data.js'), fake);
    const scan = await scanRepo(root);
    const paths = scan.files.map((f) => f.path);
    expect(paths).toContain('src/a.ts');
    expect(paths).not.toContain('src/data.js');
    expect(scan.skipped.find((s) => s.path === 'src/data.js')?.reason).toBe('binary');
  });

  it('enforces the per-file byte cap', async () => {
    root = await makeRepo({
      'big.ts': 'x'.repeat(200),
    });
    const scan = await scanRepo(root, { maxFileBytes: 50 });
    expect(scan.files.find((f) => f.path === 'big.ts')).toBeUndefined();
    expect(scan.skipped.find((s) => s.path === 'big.ts')?.reason).toMatch(/too large/);
  });
});
