import { describe, it, expect } from 'vitest';
import { renderOnboarding } from '../../src/renderer/index.ts';
import { REQUIRED_SECTIONS, type Section } from '../../src/types.ts';

function allSections(): Section[] {
  return REQUIRED_SECTIONS.map((key) => ({
    key,
    body: `body for ${key}`,
  }));
}

const FOOTER = {
  generatedAt: '2026-05-16T00:00:00Z',
  model: 'claude-sonnet-4-6',
  turns: 7,
};

describe('renderOnboarding', () => {
  it('renders all six sections with headings in canonical order', () => {
    const md = renderOnboarding({
      repoName: 'demo',
      tagline: 'one-line description',
      sections: allSections(),
      footer: FOOTER,
    });
    expect(md).toContain('# Onboarding: demo');
    expect(md).toContain('> one-line description');
    expect(md).toContain('## How to run it');
    expect(md).toContain('## Mental model');
    expect(md).toContain('## Modules');
    expect(md).toContain('## Key flows');
    expect(md).toContain('## Where to start');
    expect(md).toContain('## Gotchas');
    // canonical order
    const order = [
      'How to run it',
      'Mental model',
      'Modules',
      'Key flows',
      'Where to start',
      'Gotchas',
    ];
    let last = -1;
    for (const heading of order) {
      const idx = md.indexOf(`## ${heading}`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it('flags missing sections with a warning and a placeholder', () => {
    const md = renderOnboarding({
      repoName: 'demo',
      sections: [{ key: 'how-to-run', body: 'do this' }],
      footer: FOOTER,
    });
    expect(md).toMatch(/5 required section\(s\) missing/);
    expect(md).toContain('## Mental model');
    expect(md).toContain("_(missing — onboard's agent loop did not submit this section)_");
  });

  it('includes a footer line with model and turn count', () => {
    const md = renderOnboarding({
      repoName: 'demo',
      sections: allSections(),
      footer: FOOTER,
    });
    expect(md).toContain('claude-sonnet-4-6');
    expect(md).toContain('7 turns');
    expect(md).toContain('2026-05-16T00:00:00Z');
  });

  it('singularises the turn count when it is 1', () => {
    const md = renderOnboarding({
      repoName: 'demo',
      sections: allSections(),
      footer: { ...FOOTER, turns: 1 },
    });
    expect(md).toContain('1 turn.');
  });
});
