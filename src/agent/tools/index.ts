import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import type { SectionKey } from '../../types.js';
import { REQUIRED_SECTIONS } from '../../types.js';

/**
 * Narrowed shape of a tool_use block that executeTool consumes. We accept the
 * minimum surface the dispatcher needs (id/name/input) rather than the full
 * SDK ToolUseBlock so tests can construct fake invocations without filling in
 * server-side metadata like `caller`.
 */
export interface ToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
export type ToolResultBlock = ToolResultBlockParam;
export type ToolDefinition = Tool;

export interface ToolContext {
  repoRoot: string;
  /** Per-tool-call read cap so a tool result can't blow up the context window. */
  maxReadBytes: number;
  /** Section bodies submitted via submit_section. The loop reads this. */
  sections: Map<SectionKey, string>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'list_dir',
    description:
      'List entries in a directory inside the target repository. Paths are repo-relative POSIX paths. Pass "." for the repo root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative directory path. Use "." for root.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read a single file from the target repository as UTF-8 text. Paths are repo-relative POSIX paths. Files larger than the per-call cap are truncated and the result notes the cap.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative file path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description:
      'Search the repository for a regular expression. Returns up to 60 matching lines with their file path and line number. Use this to locate symbols, config keys, or callsites quickly.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression (POSIX-extended/ripgrep dialect).',
        },
        glob: {
          type: 'string',
          description: 'Optional glob to scope the search (e.g. "**/*.ts").',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'submit_section',
    description: `Submit the finished markdown body for one of the required ONBOARDING.md sections. Submit each section exactly once. Required sections: ${REQUIRED_SECTIONS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          enum: REQUIRED_SECTIONS as unknown as string[],
          description: 'The section identifier.',
        },
        body: {
          type: 'string',
          description:
            'Markdown body for this section. Do NOT include the section heading — the renderer adds it. Aim for 5–25 lines of substantive content. Cite paths verbatim.',
        },
      },
      required: ['key', 'body'],
    },
  },
];

export async function executeTool(block: ToolUse, ctx: ToolContext): Promise<ToolResultBlock> {
  try {
    const output = await dispatch(block.name, block.input as Record<string, unknown>, ctx);
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: output,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: `error: ${msg}`,
      is_error: true,
    };
  }
}

async function dispatch(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  switch (name) {
    case 'list_dir':
      return listDir(requireString(input, 'path'), ctx);
    case 'read_file':
      return readFile(requireString(input, 'path'), ctx);
    case 'grep':
      return grep(
        requireString(input, 'pattern'),
        typeof input.glob === 'string' ? input.glob : undefined,
        ctx,
      );
    case 'submit_section':
      return submitSection(input, ctx);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required string argument: ${key}`);
  }
  return v;
}

function resolveSafe(relPath: string, repoRoot: string): string {
  // Reject absolute paths and anything that escapes the repo root after resolution.
  if (path.isAbsolute(relPath)) {
    throw new Error('path must be repo-relative, not absolute');
  }
  const abs = path.resolve(repoRoot, relPath);
  const rootWithSep = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  if (abs !== repoRoot && !abs.startsWith(rootWithSep)) {
    throw new Error('path escapes repo root');
  }
  return abs;
}

async function listDir(relPath: string, ctx: ToolContext): Promise<string> {
  const normalized = relPath === '.' || relPath === '' ? '' : relPath;
  const abs = resolveSafe(normalized, ctx.repoRoot);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  if (entries.length === 0) return '(empty directory)';
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
}

async function readFile(relPath: string, ctx: ToolContext): Promise<string> {
  const abs = resolveSafe(relPath, ctx.repoRoot);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error(`not a regular file: ${relPath}`);
  const buf = await fs.readFile(abs);
  if (buf.byteLength <= ctx.maxReadBytes) return buf.toString('utf8');
  return (
    buf.subarray(0, ctx.maxReadBytes).toString('utf8') +
    `\n\n[truncated: file is ${buf.byteLength} bytes; read cap is ${ctx.maxReadBytes} bytes]`
  );
}

const MAX_GREP_LINES = 60;

async function grep(pattern: string, glob: string | undefined, ctx: ToolContext): Promise<string> {
  // Shell out to git grep when inside a git repo (fast, respects .gitignore).
  // Fall back to a JS scan if git isn't available or this isn't a git repo.
  const gitOutput = await tryGitGrep(pattern, glob, ctx.repoRoot);
  if (gitOutput !== null) return clipGrep(gitOutput);
  return clipGrep(await jsGrep(pattern, glob, ctx.repoRoot));
}

function clipGrep(raw: string): string {
  if (raw.trim().length === 0) return '(no matches)';
  const lines = raw.split('\n');
  if (lines.length <= MAX_GREP_LINES) return raw;
  return lines.slice(0, MAX_GREP_LINES).join('\n') + `\n[truncated at ${MAX_GREP_LINES} lines]`;
}

function tryGitGrep(
  pattern: string,
  glob: string | undefined,
  repoRoot: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ['grep', '-n', '-E', '--', pattern];
    if (glob) args.push(glob);
    const child = spawn('git', args, { cwd: repoRoot });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (err += d.toString('utf8')));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        // 0 = matches found, 1 = no matches; both are useful answers
        resolve(out);
      } else {
        // not a git repo, or git missing — fall through to jsGrep
        if (err.includes('not a git repository') || err.includes('Not a git repository')) {
          resolve(null);
        } else {
          resolve(null);
        }
      }
    });
  });
}

async function jsGrep(
  pattern: string,
  glob: string | undefined,
  repoRoot: string,
): Promise<string> {
  const re = new RegExp(pattern);
  const matches: string[] = [];
  const TEXT_EXT =
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|rb|php|cs|swift|c|h|cc|cpp|hpp|md|json|yml|yaml|toml)$/i;
  const queue: string[] = [''];
  while (queue.length > 0 && matches.length < MAX_GREP_LINES * 2) {
    const relDir = queue.shift()!;
    const absDir = path.join(repoRoot, relDir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.git') || entry.name === 'node_modules' || entry.name === 'dist')
        continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        queue.push(rel);
        continue;
      }
      if (!TEXT_EXT.test(entry.name)) continue;
      if (glob && !matchesGlob(rel, glob)) continue;
      try {
        const text = await fs.readFile(path.join(repoRoot, rel), 'utf8');
        text.split('\n').forEach((line, idx) => {
          if (re.test(line)) matches.push(`${rel}:${idx + 1}:${line.trim()}`);
        });
      } catch {
        // unreadable — skip
      }
    }
  }
  return matches.join('\n');
}

// Minimal glob match used only by the jsGrep fallback. Supports "*" and "**".
function matchesGlob(rel: string, glob: string): boolean {
  const STAR_STAR = '__DOUBLE_STAR__';
  const escaped = glob
    .replace(/\*\*/g, STAR_STAR)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .split(STAR_STAR)
    .join('.*');
  return new RegExp(`^${escaped}$`).test(rel);
}

function submitSection(input: Record<string, unknown>, ctx: ToolContext): string {
  const key = requireString(input, 'key') as SectionKey;
  const body = requireString(input, 'body');
  if (!REQUIRED_SECTIONS.includes(key)) {
    throw new Error(`unknown section key: ${key}. Allowed: ${REQUIRED_SECTIONS.join(', ')}`);
  }
  if (ctx.sections.has(key)) {
    return `note: section "${key}" was already submitted and will be overwritten with the new body.`;
  }
  ctx.sections.set(key, body.trim());
  const remaining = REQUIRED_SECTIONS.filter((s) => !ctx.sections.has(s));
  if (remaining.length === 0) return `section "${key}" accepted. All required sections submitted.`;
  return `section "${key}" accepted. Remaining: ${remaining.join(', ')}.`;
}
