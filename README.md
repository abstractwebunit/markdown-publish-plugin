<div align="center">

# markdown-publish — Claude Code plugin

**Publish your Obsidian / Markdown vault as a website in one chat — then read it back through AI.**

[![Engine](https://img.shields.io/npm/v/%40abstractwebunit%2Fmarkdown-publish?label=engine&color=cb3837&logo=npm)](https://www.npmjs.com/package/@abstractwebunit/markdown-publish)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-live-success)](https://abstractwebunit.github.io/markdown-publish-docs/)

</div>

This plugin bundles two things that work together:

| | What it does |
|---|---|
| 🚀 **`/publish-vault` skill** | Tell Claude *"publish my vault"* and it ships your notes to **GitHub Pages** — in your own account, for free. |
| 🔌 **MCP server** | Point any MCP client (Claude Desktop, Cursor, Claude Code) at your published site so the AI can `search_notes`, `get_note`, `list_notes`, and `get_backlinks`. |

Both are powered by the [`markdown-publish`](https://github.com/abstractwebunit/markdown-publish)
static-site engine: an Obsidian vault → a fast, searchable site with backlinks,
a knowledge graph, and canvas boards.

---

## Install

From Claude Code:

```
/plugin marketplace add abstractwebunit/markdown-publish-plugin
/plugin install markdown-publish
```

That gives you the `/publish-vault` skill and the `markdown-publish` MCP server.

---

## 1. Publish a vault — the `publish-vault` skill

> **You:** publish my Obsidian vault at `~/Notes`

Claude walks you through it and **always shows a plain-language summary before
anything is created**:

```
Готов опубликовать твой vault. Вот что получится:

  📁 Заметки из:   /home/me/Notes
  🌐 Адрес сайта:  https://me.github.io/notes/
  📦 Репозиторий:  github.com/me/notes  (публичный, создам новый)
  🏷  Название:     Notes
  🌍 Язык:         ru

Публикуем? (да / изменить / отмена)
```

Say **да** and it:

1. validates the build locally (catches a broken vault early),
2. creates a new public GitHub repo in **your** account,
3. commits your vault + a GitHub Actions workflow,
4. enables GitHub Pages and waits for the build,
5. hands you the live URL.

Everything runs under your GitHub login — **no backend, no cost, you own it.**

**Requirements:** the [`gh` CLI](https://cli.github.com/) installed and
authenticated (`gh auth login`).

---

## 2. Read your notes from AI — the MCP server

Once your vault is live (or even a local build), connect it to an AI client by
setting one environment variable to your site:

```
MARKDOWN_PUBLISH_SOURCE = https://me.github.io/notes/
```

It also accepts a **local** directory (a built site / bundle root) so you can
query notes before publishing:

```
MARKDOWN_PUBLISH_SOURCE = /path/to/built-site
```

Now the AI has four tools over your vault:

| Tool | Description |
|------|-------------|
| `search_notes(query, limit?)` | Keyword search → title, slug, url, snippet |
| `get_note(slug)` | Full markdown of one note + its backlinks |
| `list_notes()` | Every note (title, slug, url) |
| `get_backlinks(slug)` | What links to this note |

> **You:** what did I write about dopamine in my notes?
>
> **Claude:** *(calls `search_notes("dopamine")` → `get_note(...)`)* In your
> note **"Habits & Reward"** you wrote… [links to your real notes]

### Manual MCP config (without the plugin)

The server is a single zero-dependency Node file. Any MCP client config:

```json
{
  "mcpServers": {
    "markdown-publish": {
      "command": "node",
      "args": ["/path/to/markdown-publish-plugin/mcp/server.mjs"],
      "env": { "MARKDOWN_PUBLISH_SOURCE": "https://me.github.io/notes/" }
    }
  }
}
```

You can also pass the source as a flag: `node mcp/server.mjs --source <url|dir>`.

---

## How it fits together

```
   ~/Notes  ──/publish-vault──▶  github.com/you/notes  ──Actions──▶  GitHub Pages
   (vault)        (skill)            (your repo)         (engine)      (live site)
                                                                          │
                                                            content/*.json bundle
                                                                          │
                                          MARKDOWN_PUBLISH_SOURCE ──▶  MCP server
                                                                          │
                                              Claude Desktop / Cursor / Claude Code
```

The published site emits a machine-readable `content/` bundle
(`search-index.json`, `notes/<slug>.json`, `graph.json`). The MCP server reads
exactly those files — over HTTP for a published site, or from disk for a local
build.

---

## Links

- **Engine & CLI:** [github.com/abstractwebunit/markdown-publish](https://github.com/abstractwebunit/markdown-publish)
- **Docs (6 languages):** [abstractwebunit.github.io/markdown-publish-docs](https://abstractwebunit.github.io/markdown-publish-docs/)
- **Starter template:** [github.com/abstractwebunit/markdown-publish-template](https://github.com/abstractwebunit/markdown-publish-template)

## License

[MIT](./LICENSE). Not affiliated with Obsidian.MD.
