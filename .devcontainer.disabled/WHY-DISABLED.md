# Dev container archived (local Windows)

This folder was **`/.devcontainer`** and is renamed to **`.devcontainer.disabled`** so **Cursor / VS Code** no longer detect a Dev Container at the repo root.

That stops prompts to **“Reopen in Container”**, which on Windows usually requires **Docker Desktop** and **WSL 2** (a Linux kernel)—what many users describe as “Windows trying to install Linux.”

## GitHub Codespaces

Codespaces expects **`/.devcontainer/devcontainer.json`**. To use the full stack in **GitHub Codespaces** again, rename this directory back:

```powershell
Rename-Item .devcontainer.disabled .devcontainer
```

Commit that change on the branch you open in Codespaces, or keep `.devcontainer` on `main` and only use `.devcontainer.disabled` in a personal branch/fork.

## Local development on Windows without Linux

Use **`docs/WINDOWS-LOCAL-SETUP.md`**, **`npm run dev`**, and **`npm run doctor:win`** (not `npm run codespaces:up` from plain PowerShell unless you use Git Bash).
