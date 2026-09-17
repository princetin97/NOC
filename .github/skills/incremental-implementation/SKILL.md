---
name: incremental-implementation
description: Deliver changes in small vertical slices with verification at each step. Use when work spans multiple files or services.
---

# Incremental Implementation

## Goal
Lower risk by shipping small, verifiable increments.

## Process
1. Slice the task
- Break work into minimal units that can be validated independently.

2. Implement one slice
- Complete only one unit end-to-end.
- Avoid stacking partially finished edits.

3. Verify immediately
- Run targeted checks right after each slice.
- Stop and fix regressions before proceeding.

4. Record progress
- Summarize what changed, what passed, and next slice.

## Project-specific guidance
- If touching Prisma schema or migration logic, isolate that slice and verify rollout path.
- If touching API + UI together, land contract change first, then UI adaptation.
- For runtime-impacting slices, rebuild Docker stack to validate composition.

## Verification evidence
- Slice list with completion status.
- Commands run per slice and outcomes.
