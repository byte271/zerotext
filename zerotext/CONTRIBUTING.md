# Contributing to ZeroText

Thank you for your interest in contributing to ZeroText.

## Prerequisites

- Node.js 18+
- pnpm (or npm)

## Setup

```bash
git clone https://github.com/byte271/zerotext.git
cd zerotext
npm install
npm run build
```

## Running Tests

```bash
npx tsx tests/core.test.ts
```

## Running Benchmarks

```bash
npx tsx benchmarks/features.ts
```

## Code Style

- No classes in feature modules -- use plain functions and typed arrays.
- Use `const enum` for flag sets.
- Pre-allocate buffers; reuse them across calls.
- Zero allocations in hot paths (layout, cache lookup, hit testing).
- Prefer `Math.imul` and bitwise ops over generic arithmetic where applicable.
- All public APIs must have JSDoc comments.

## Pull Request Guidelines

1. Ensure all tests pass (`npx tsx tests/core.test.ts`).
2. For performance-sensitive changes, include benchmark results from `npx tsx benchmarks/features.ts` in the PR description.
3. Do not introduce allocations in hot paths without justification.
4. Keep bundle size impact minimal -- run `npx tsc --noEmit` to verify no regressions.
5. One feature per PR when possible.

## Reporting Issues

Use the GitHub issue templates for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
