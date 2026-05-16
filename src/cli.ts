// Placeholder entry point. The real CLI lands in AGE-7 (walking-skeleton end-to-end demo).
// Per ADR-0001, this is a one-shot CLI that takes a repo path and writes ONBOARDING.md.

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  console.log('onboard: chassis only — product implementation lands in AGE-7.');
  if (argv.length > 0) {
    console.log(`(received args: ${argv.join(' ')})`);
  }
  return 0;
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  process.exit(main());
}
