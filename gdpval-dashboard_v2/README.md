# GDPval Public Dashboard v2

This folder is the v2 GitHub Pages copy intended for:

`https://vverdiyan.github.io/gdpval-dashboard_v2/`

Unofficial viewer for the public GDPval gold subset.

This public-safe build:
- uses Artificial Analysis GDPval-AA v2 for the current overall model leaderboard
- uses Artificial Analysis GDPval-AA v2 for current cost, token, and turn rows where published
- uses Hugging Face `openai/gdpval` for tasks, occupations, rubrics, and file links
- intentionally does not show archived OpenAI per-occupation model score rows
- opens source files from Hugging Face
- disables inline extracted preview payloads
- avoids bundling the larger derived preview corpus used in the private working copy

Publishing notes:
- The repo is intended to be public.
- GitHub Pages should be enabled from the `main` branch root.
- Attribution should remain visible to OpenAI GDPval, Artificial Analysis GDPval-AA, and the Hugging Face dataset.
