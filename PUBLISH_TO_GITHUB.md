# Publish this starter to GitHub (one manual repo-creation step)

The installed GitHub connection can edit/push to existing repositories but does **not** provide a create-repository operation. This export is prepared for a new `Hebx/ShipLock` repo.

1. Create an **empty** public or private repo at https://github.com/new (owner `Hebx`, repository name `ShipLock`; **do not** generate a README, license or .gitignore in the UI).
2. Unzip `ShipLock_GitHub_Starter.zip`, open a terminal in the extracted directory, and run:

```bash
git init -b main
git add .
git commit -m "docs: bootstrap ShipLock research-first agent workspace"
git remote add origin https://github.com/Hebx/ShipLock.git
git push -u origin main
```

If using HTTPS, configure GitHub credential manager or use SSH. Never put a PAT in a remote URL or command history.

Or, once the empty repo exists, ask ChatGPT to **upload the starter docs to `Hebx/ShipLock`** using the linked GitHub connector, which can write to existing repos.

**Important:** Create an independent *disposable* `Hebx/shiplock-demo-target` repo for actual merge demonstrations. The bot must never have merge rights to Hedron or to the product source repository during the demo.
