# Dev container moved to `.devcontainer/`

The active **Docker Compose devcontainer** (Postgres service hostname **`db`**, app + DB for **GitHub Codespaces**) lives in **`/.devcontainer/`** at the repo root.

This folder is kept as a short pointer so older docs and bookmarks still resolve.

## Windows desktop (no Docker)

Use **`docs/WINDOWS-LOCAL-SETUP.md`**, **`npm run dev`**, and **`npm run doctor:win`**.

If **VS Code / Cursor** offers **“Reopen in Container”**, you can choose **Reopen locally** and continue with a normal Windows Postgres install.

## Why this folder used to exist

Previously the devcontainer config was renamed to **`.devcontainer.disabled`** to reduce Dev Container detection on Windows. That broke **GitHub Codespaces** (no `db` host, `ENOTFOUND db`). The repo now ships **`.devcontainer`** again so Codespaces gets Postgres automatically.
