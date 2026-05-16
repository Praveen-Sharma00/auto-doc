import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent } from '../../src/agent/loop.ts';
import { scanRepo } from '../../src/scanner/index.ts';
import { REQUIRED_SECTIONS } from '../../src/types.ts';

// Minimal fake Anthropic client. The real SDK is mocked because we don't want
// the loop to hit the network in unit tests; the live integration is verified
// by the CEO with a real ANTHROPIC_API_KEY.
function fakeClient(turnFns: ((messages: unknown) => unknown)[]) {
  let i = 0;
  return {
    messages: {
      create: async (req: unknown) => {
        const fn = turnFns[i++];
        if (!fn) throw new Error(`fake client out of scripted turns at index ${i - 1}`);
        return fn(req);
      },
    },
  };
}

function assistantResponse(blocks: unknown[]) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content: blocks,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

describe('runAgent', () => {
  let root: string;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('stops once all required sections are submitted', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'onboard-loop-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo' }));
    const scan = await scanRepo(root);

    // First turn submits 3 sections; second turn submits the last 3.
    const turn1 = () =>
      assistantResponse([
        {
          type: 'tool_use',
          id: 't1',
          name: 'submit_section',
          input: { key: 'how-to-run', body: 'run' },
        },
        {
          type: 'tool_use',
          id: 't2',
          name: 'submit_section',
          input: { key: 'mental-model', body: 'mm' },
        },
        {
          type: 'tool_use',
          id: 't3',
          name: 'submit_section',
          input: { key: 'modules', body: 'mods' },
        },
      ]);
    const turn2 = () =>
      assistantResponse([
        {
          type: 'tool_use',
          id: 't4',
          name: 'submit_section',
          input: { key: 'flows', body: 'flo' },
        },
        {
          type: 'tool_use',
          id: 't5',
          name: 'submit_section',
          input: { key: 'where-to-start', body: 'wts' },
        },
        {
          type: 'tool_use',
          id: 't6',
          name: 'submit_section',
          input: { key: 'gotchas', body: 'gtch' },
        },
      ]);

    const client = fakeClient([turn1, turn2]);
    const result = await runAgent({
      scan,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'fake',
      maxTurns: 10,
      onProgress: () => {},
    });
    expect(result.stopReason).toBe('all-sections-submitted');
    expect(result.sections.map((s) => s.key)).toEqual([...REQUIRED_SECTIONS]);
    expect(result.turns).toBe(2);
  });

  it('exits cleanly when the model stops without tool calls', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'onboard-loop-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo' }));
    const scan = await scanRepo(root);

    const turn1 = () => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'fake',
      content: [{ type: 'text', text: "I'm done." }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const client = fakeClient([turn1]);
    const result = await runAgent({
      scan,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      maxTurns: 10,
      onProgress: () => {},
    });
    expect(result.stopReason).toBe('end_turn');
    expect(result.sections).toHaveLength(0);
  });

  it('honours maxTurns when the model never submits', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'onboard-loop-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo' }));
    const scan = await scanRepo(root);

    // Each turn calls list_dir but never submit_section.
    const turnFn = () =>
      assistantResponse([{ type: 'tool_use', id: 'tx', name: 'list_dir', input: { path: '.' } }]);
    const client = fakeClient([turnFn, turnFn, turnFn]);
    const result = await runAgent({
      scan,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      maxTurns: 3,
      onProgress: () => {},
    });
    expect(result.turns).toBe(3);
    expect(result.stopReason).toBe('max-turns');
    expect(result.sections).toHaveLength(0);
  });
});
