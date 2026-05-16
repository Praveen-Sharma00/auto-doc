import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  Message,
} from '@anthropic-ai/sdk/resources/messages.js';
import type { AgentRunResult, ScanResult, Section, SectionKey } from '../types.js';
import { REQUIRED_SECTIONS } from '../types.js';
import { executeTool, TOOLS, type ToolContext } from './tools/index.js';
import { SYSTEM_PROMPT, buildInitialUserMessage } from './prompts/index.js';

export interface AgentRunOptions {
  scan: ScanResult;
  client?: Anthropic;
  model?: string;
  maxTurns?: number;
  /** Per-tool-call file-read cap in bytes. */
  maxReadBytes?: number;
  /** Called with one-line status updates. Defaults to stderr writer. */
  onProgress?: (line: string) => void;
}

// Per ADR-0001: Sonnet workhorse with the option to swap by changing this
// constant. The Opus synthesis pass mentioned in the ADR is a v0.1 follow-up;
// for the walking skeleton we run one model end-to-end.
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 24;
const DEFAULT_MAX_READ_BYTES = 60_000;

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const onProgress = opts.onProgress ?? ((line) => process.stderr.write(line + '\n'));

  const sections = new Map<SectionKey, string>();
  const toolContext: ToolContext = {
    repoRoot: opts.scan.repoRoot,
    maxReadBytes: opts.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    sections,
  };

  const messages: MessageParam[] = [
    {
      role: 'user',
      content: [
        // Prompt caching on the bundle pays off across turns — same prefix
        // gets re-sent every iteration. Mark the seed bundle as cacheable.
        {
          type: 'text',
          text: buildInitialUserMessage(opts.scan),
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
  ];

  let turns = 0;
  let stopReason = 'unknown';

  while (turns < maxTurns) {
    turns++;
    onProgress(
      `turn ${turns}: calling ${model} (${sections.size}/${REQUIRED_SECTIONS.length} sections done)`,
    );

    const response: Message = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');

    if (toolUses.length === 0) {
      stopReason = response.stop_reason ?? 'end_turn';
      onProgress(`model stopped without tool calls (stop_reason=${stopReason})`);
      break;
    }

    const toolResults: ContentBlockParam[] = [];
    for (const block of toolUses) {
      onProgress(`  tool: ${block.name}(${summarizeArgs(block.input)})`);
      toolResults.push(await executeTool(block, toolContext));
    }
    messages.push({ role: 'user', content: toolResults });

    if (sections.size >= REQUIRED_SECTIONS.length) {
      stopReason = 'all-sections-submitted';
      onProgress('all required sections submitted');
      break;
    }
  }

  if (turns >= maxTurns && stopReason === 'unknown') {
    stopReason = 'max-turns';
    onProgress(
      `hit max-turns cap (${maxTurns}) with ${sections.size}/${REQUIRED_SECTIONS.length} sections`,
    );
  }

  const orderedSections: Section[] = [];
  for (const key of REQUIRED_SECTIONS) {
    const body = sections.get(key);
    if (body !== undefined) orderedSections.push({ key, body });
  }
  return { sections: orderedSections, turns, stopReason };
}

function summarizeArgs(input: unknown): string {
  if (input === null || typeof input !== 'object') return String(input);
  const obj = input as Record<string, unknown>;
  return Object.entries(obj)
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${s.length > 60 ? s.slice(0, 57) + '...' : s}`;
    })
    .join(', ');
}
