import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildInitialUserMessage } from '../../src/agent/prompts/index.ts';
import { REQUIRED_SECTIONS, type ScanResult } from '../../src/types.ts';

describe('SYSTEM_PROMPT', () => {
  it('names every required section so the model knows the schema', () => {
    for (const key of REQUIRED_SECTIONS) {
      expect(SYSTEM_PROMPT).toContain(key);
    }
  });

  it('forbids invention and instructs path citation', () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not invent/);
    expect(SYSTEM_PROMPT).toMatch(/file paths/);
  });
});

describe('buildInitialUserMessage', () => {
  it('includes top-level entries, every bundled file, and an instruction to use tools', () => {
    const scan: ScanResult = {
      repoRoot: '/tmp/x',
      files: [
        { path: 'package.json', contents: '{"name":"x"}', bytes: 12 },
        { path: 'src/a.ts', contents: 'export const x = 1;', bytes: 19 },
      ],
      topLevel: ['package.json', 'src/'],
      skipped: [{ path: 'big.bin', reason: 'binary' }],
      totalBytes: 31,
    };
    const out = buildInitialUserMessage(scan);
    expect(out).toContain('/tmp/x');
    expect(out).toContain('- package.json');
    expect(out).toContain('- src/');
    expect(out).toContain('`package.json`');
    expect(out).toContain('`src/a.ts`');
    expect(out).toContain('export const x = 1;');
    expect(out).toContain('big.bin (binary)');
    expect(out).toMatch(/use them freely/);
  });
});
