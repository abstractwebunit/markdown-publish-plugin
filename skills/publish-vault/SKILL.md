---
name: publish-vault
description: Use when the user wants to publish, deploy, or put online their Obsidian/Markdown vault (notes) as a website. Triggers on "publish my vault", "опубликуй мои заметки", "deploy my notes", "put my Obsidian online", "make a site from my markdown". Ships the vault to GitHub Pages via the markdown-publish engine, in the user's own GitHub account.
---

# Publish a Markdown / Obsidian vault to GitHub Pages

Turn a folder of Markdown notes (an Obsidian vault) into a live, searchable
website. The whole thing runs in the **user's own GitHub account** — a new
public repo, a GitHub Actions workflow that builds with the published
`markdown-publish` engine, and GitHub Pages hosting. No backend, no cost.

## Golden rules

- **Never create a repo or push anything before the user explicitly confirms**
  the plain-language config summary in step 3.
- Use smart defaults; only ask the user when something can't be inferred.
- Verify each step before moving on. If a step fails, stop and surface the real
  error — don't paper over it.

## Preconditions

The skill drives the `gh` CLI and `git`. Before anything else:

1. Check `gh` is installed and authenticated: run `gh auth status`.
   - If not authenticated, tell the user to run `! gh auth login` themselves
     (the `!` prefix runs it in the session), then re-check. The token needs
     `repo` and `workflow` scopes.
2. Capture their GitHub login for URLs: `gh api user -q .login`.

## Flow

### 1. Locate the vault

Find the folder of Markdown notes. If the user didn't say where it is, ask once.
Confirm it looks like a vault (contains `.md` files; an Obsidian vault may also
have `.canvas` files and a `.obsidian/` folder). Resolve its absolute path.

### 2. Resolve config (smart defaults, no questions yet)

| Field        | Default                                              |
|--------------|------------------------------------------------------|
| `repo`       | the vault folder name, slugified (lowercase, dashes) |
| `siteName`   | the vault folder name, human-cased                   |
| `lang`       | autodetect; fall back to `en`                         |
| `home`       | leave empty (engine auto-detects a welcome/index note)|
| `baseHref`   | `/<repo>/`  ← load-bearing, see note below           |

> **base-href is load-bearing.** GitHub Pages *project* sites serve under
> `https://<login>.github.io/<repo>/`. The build must use base href `/<repo>/`
> or every asset and link 404s. Always set it.

### 3. Show the config in plain words and get confirmation

Print a friendly summary and **wait for an explicit yes**:

```
Готов опубликовать твой vault. Вот что получится:

  📁 Заметки из:   <absolute vault path>
  🌐 Адрес сайта:  https://<login>.github.io/<repo>/
  📦 Репозиторий:  github.com/<login>/<repo>  (публичный, создам новый)
  🏷  Название:     <siteName>
  🌍 Язык:         <lang>

Публикуем? (да / изменить / отмена)
```

- **изменить / change** → let them edit any field, then re-show this summary.
- **отмена / cancel** → stop. Nothing has been created.
- **да / yes** → continue to step 4.

### 4. Validate the build locally first

Before creating any repo, do a dry build to catch a broken vault:

```bash
npx --yes @abstractwebunit/markdown-publish build \
  --vault "<vault path>" \
  --out "<temp dir>" \
  --base-href "/<repo>/" \
  --site-name "<siteName>" \
  --site-lang "<lang>"
```

Verify it exits 0 and `<temp dir>/index.html` exists. **If it fails, show the
error and stop — do not create the repo.**

### 5. Create the GitHub repo

```bash
gh repo create "<login>/<repo>" --public
```

If the name is taken, propose an alternative and loop back to step 3's summary.

### 6. Scaffold the repo

Clone the new repo locally (or init + add remote), then create:

- `vault/` — copy the user's vault contents here.
- `markdown-publish.config.json`:
  ```json
  {
    "vaultDir": "vault",
    "siteName": "<siteName>",
    "siteLang": "<lang>",
    "baseHref": "/<repo>/"
  }
  ```
- `.github/workflows/publish.yml` — see the template at the bottom of this skill.
  Do **not** add a `package-lock.json`; the workflow must not cache npm by lock.

### 7. Commit and push

```bash
git add -A && git commit -m "Publish vault with markdown-publish" && git push -u origin main
```

Verify the push succeeded.

### 8. Enable GitHub Pages (source = Actions)

```bash
gh api -X POST "repos/<login>/<repo>/pages" -f build_type=workflow
```

Ignore an "already enabled" error. Verify with `gh api repos/<login>/<repo>/pages`.

### 9. Wait for the build, then return the URL

```bash
gh run watch --repo "<login>/<repo>" --exit-status
```

- On success: print the live URL **`https://<login>.github.io/<repo>/`**. Note
  the first Pages deploy can take ~1 minute to propagate.
- On failure: show `gh run view --repo "<login>/<repo>" --log-failed` and leave
  the repo in place so the user can fix and retry.

## After publishing (optional)

Mention that the user can connect the published site to AI clients with the
bundled MCP server by pointing it at their new URL:

```
MARKDOWN_PUBLISH_SOURCE = https://<login>.github.io/<repo>/
```

Then Claude/Cursor can `search_notes`, `get_note`, `list_notes`, `get_backlinks`
over their published vault.

## Workflow template (`.github/workflows/publish.yml`)

The `markdown-publish@v1` Action builds the vault **and** uploads the Pages
artifact itself — do not add a separate `upload-pages-artifact` step.

```yaml
name: Publish vault
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: abstractwebunit/markdown-publish@v1
        with:
          vault-dir: vault
          site-url: https://<login>.github.io/<repo>
          base-href: /<repo>/
          site-name: <siteName>
          site-lang: <lang>
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Replace `<login>`, `<repo>`, `<siteName>`, `<lang>` with the resolved values.
