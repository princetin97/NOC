---
description: Run a safe implementation workflow for network-monitor from requirement to verification.
---

Apply this workflow:
1. Restate scope and identify impacted backend/UI/database/runtime areas.
2. Propose minimal implementation slices.
3. Execute one slice at a time with verification after each slice.
4. For behavior changes, use red-green-refactor and show evidence.
5. End with a review summary under: correctness, security, performance, maintainability.
6. If runtime-affecting changes were made, run docker compose up -d --build.
7. Report exactly what commands were run and their outcomes.
