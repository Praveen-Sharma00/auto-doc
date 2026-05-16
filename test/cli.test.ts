import { describe, it, expect } from 'vitest';
import { main } from '../src/cli.ts';

describe('cli placeholder', () => {
  it('returns exit code 0', () => {
    expect(main([])).toBe(0);
  });

  it('accepts args without throwing', () => {
    expect(main(['some-repo-path'])).toBe(0);
  });
});
