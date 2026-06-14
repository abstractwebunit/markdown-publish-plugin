# markdown-publish MCP server

A zero-dependency stdio [MCP](https://modelcontextprotocol.io/) server that
exposes a [`markdown-publish`](https://github.com/abstractwebunit/markdown-publish)
vault to AI clients.

## Source

Set where to read the vault from (a published site URL **or** a local built-site
directory), via env var or flag:

```bash
MARKDOWN_PUBLISH_SOURCE=https://you.github.io/notes/ node server.mjs
# or
node server.mjs --source /path/to/built-site
```

Both expect the engine's layout: `<source>/content/{search-index,graph}.json`
and `<source>/content/notes/<slug>.json`.

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `search_notes` | `query`, `limit?` (1–25) | best matches: title, slug, url, snippet |
| `get_note` | `slug` | full markdown + title + url + backlinks |
| `list_notes` | — | every note: title, slug, url |
| `get_backlinks` | `slug` | notes that link to this one |

No dependencies, no build step — plain Node 18+ (uses global `fetch`).
