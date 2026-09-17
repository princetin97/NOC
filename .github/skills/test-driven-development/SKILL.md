---
name: test-driven-development
description: Implement behavior through a red-green-refactor loop. Use when fixing bugs, changing business logic, or adding non-trivial functionality.
---

# Test-Driven Development

## Goal
Prove behavior with tests before and after implementation.

## Process
1. Red
- Write or adapt a focused failing test that reproduces the intended behavior.
- For bug fixes, reproduce the failure first.

2. Green
- Implement the smallest code change that makes the test pass.
- Avoid unrelated cleanup in this step.

3. Refactor
- Improve readability while preserving behavior.
- Keep tests green throughout.

4. Verify
- Run relevant suite(s) plus impacted build/type checks.

## Project-specific checks
- Backend changes: run backend build.
- UI changes: run UI lint/type check and UI build.
- If behavior depends on service composition: rebuild with Docker Compose.

## Verification evidence
- Show the failing condition captured.
- Show passing results after the fix.
- Note any coverage gap left intentionally.
