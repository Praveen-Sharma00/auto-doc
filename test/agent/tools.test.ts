import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SectionKey } from '../../src/types.ts';
import { REQUIRED_SECTIONS } from '../../src/types.ts';
import { executeTool, TOOLS } from '../../src/agent/tools/index.ts';

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onboard-tools-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
  return root;
}

function makeCtx(repoRoot: string) {
  return {
    repoRoot,
    maxReadBytes: 10_000,
    sections: new Map<SectionKey, string>(),
  };
}

describe('TOOLS definitions', () => {
  it('exposes the four required tools', () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['grep', 'list_dir', 'read_file', 'submit_section']);
  });

  it('submit_section restricts key via enum', () => {
    const t = TOOLS.find((t) => t.name === 'submit_section')!;
    const props = t.input_schema.properties as Record<string, { enum?: string[] }> | undefined;
    expect(props?.key?.enum).toEqual([...REQUIRED_SECTIONS]);
  });
});

describe('executeTool', () => {
  let root: string;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('list_dir returns sorted entries with directory slashes', async () => {
    root = await makeRepo({
      'a.ts': '// a',
      'b.ts': '// b',
      'src/inside.ts': '// inside',
    });
    const ctx = makeCtx(root);
    const res = await executeTool(
      { type: 'tool_use', id: '1', name: 'list_dir', input: { path: '.' } },
      ctx,
    );
    expect(res.is_error).toBeFalsy();
    expect(res.content).toContain('a.ts');
    expect(res.content).toContain('b.ts');
    expect(res.content).toContain('src/');
  });

  it('read_file returns full contents when under cap', async () => {
    root = await makeRepo({ 'hello.ts': 'export const x = 42;\n' });
    const ctx = makeCtx(root);
    const res = await executeTool(
      { type: 'tool_use', id: '1', name: 'read_file', input: { path: 'hello.ts' } },
      ctx,
    );
    expect(res.content).toBe('export const x = 42;\n');
  });

  it('read_file truncates and annotates oversized files', async () => {
    root = await makeRepo({ 'big.ts': 'x'.repeat(50_000) });
    const ctx = makeCtx(root);
    ctx.maxReadBytes = 100;
    const res = await executeTool(
      { type: 'tool_use', id: '1', name: 'read_file', input: { path: 'big.ts' } },
      ctx,
    );
    expect(typeof res.content).toBe('string');
    expect((res.content as string).length).toBeLessThan(500);
    expect(res.content).toMatch(/truncated/);
  });

  it('refuses paths that escape the repo root', async () => {
    root = await makeRepo({ 'a.ts': '// a' });
    const ctx = makeCtx(root);
    const res = await executeTool(
      { type: 'tool_use', id: '1', name: 'read_file', input: { path: '../etc/passwd' } },
      ctx,
    );
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/escapes repo root/);
  });

  it('refuses absolute paths', async () => {
    root = await makeRepo({ 'a.ts': '// a' });
    const ctx = makeCtx(root);
    const res = await executeTool(
      { type: 'tool_use', id: '1', name: 'read_file', input: { path: '/etc/passwd' } },
      ctx,
    );
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/absolute/);
  });

  it('submit_section stores body and reports remaining sections', async () => {
    root = await makeRepo({ 'a.ts': '// a' });
    const ctx = makeCtx(root);
    const res = await executeTool(
      {
        type: 'tool_use',
        id: '1',
        name: 'submit_section',
        input: { key: 'how-to-run', body: 'run npm test' },
      },
      ctx,
    );
    expect(res.is_error).toBeFalsy();
    expect(ctx.sections.get('how-to-run')).toBe('run npm test');
    expect(res.content).toMatch(/Remaining: mental-model/);
  });

  it('submit_section rejects unknown section keys', async () => {
    root = await makeRepo({ 'a.ts': '// a' });
    const ctx = makeCtx(root);
    const res = await executeTool(
      {
        type: 'tool_use',
        id: '1',
        name: 'submit_section',
        input: { key: 'not-a-real-section', body: 'oops' },
      },
      ctx,
    );
    expect(res.is_error).toBe(true);
  });

  it('grep finds matches via jsGrep when not in a git repo', async () => {
    root = await makeRepo({
      'a.ts': 'export const NEEDLE = 1;\n',
      'b.ts': 'console.log("hay");\n',
    });
    const ctx = makeCtx(root);
    const res = await executeTool(
      { type: 'tool_use', id: '1', name: 'grep', input: { pattern: 'NEEDLE' } },
      ctx,
    );
    expect(res.content).toContain('a.ts');
    expect(res.content).toContain('NEEDLE');
  });

  it('returns is_error for unknown tool names', async () => {
    root = await makeRepo({ 'a.ts': '// a' });
    const ctx = makeCtx(root);
    const res = await executeTool(
      { type: 'tool_use', id: '1', name: 'no_such_tool', input: {} },
      ctx,
    );
    expect(res.is_error).toBe(true);
  });
});
