#!/bin/bash
git fetch --all --prune
git checkout main
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
