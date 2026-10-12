---
name: context-engineering
description: Prepare the right repository context before changing code. Use when requirements are unclear, code ownership is spread across modules, or the change touches multiple services.
---

# Context Engineering

## Goal
Reduce incorrect edits by collecting only the context needed for the task.

## Process
1. Identify impacted areas first.
- Map request to backend, UI, database, and runtime boundaries.
- Note cross-service dependencies early.

2. Discover local conventions.
- Read neighboring files and existing patterns.
- Reuse naming, validation, and error-handling style.

3. Confirm operational constraints.
- Determine required build, test, and runtime checks.
- Flag high-risk zones before editing.

4. Define a minimal change surface.
- Prefer the smallest set of files that can solve the problem.
- Avoid opportunistic refactors unless explicitly requested.

## Verification evidence
- Briefly list files inspected and why.
- State identified risks and mitigations.
- State exactly which checks will be run after the edit.
