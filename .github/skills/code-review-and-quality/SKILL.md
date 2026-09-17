---
name: code-review-and-quality
description: Perform structured quality review before merge. Use for pull requests, risky edits, and changes crossing backend, UI, or database boundaries.
---

# Code Review And Quality

## Goal
Catch correctness, maintainability, and operational risks before merge.

## Review axes
1. Correctness
- Does behavior match requirement and edge cases?

2. Design and boundaries
- Are module boundaries respected (routes, services, data access)?

3. Readability and maintainability
- Is code understandable and consistent with local patterns?

4. Security and data safety
- Input validation, auth assumptions, sensitive data handling.

5. Performance and reliability
- Query/load impact, polling frequency impact, runtime side effects.

## Severity labels
- Critical: must fix before merge.
- Required: should fix in this change.
- Optional: improvement that can follow up.
- FYI: noteworthy context, no action required.

## Verification evidence
- List findings by severity with file references.
- State what was validated by commands and what remains unverified.
