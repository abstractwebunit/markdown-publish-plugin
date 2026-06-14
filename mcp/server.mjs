#!/usr/bin/env node
// markdown-publish MCP server — exposes a published (or local) markdown-publish
// vault to AI clients over stdio. Zero dependencies: a minimal JSON-RPC 2.0
// loop speaking the Model Context Protocol (line-delimited JSON on stdin/stdout).
//
// Source of the vault data (a markdown-publish build's `content/` bundle) is
// resolved from, in order: --source <url|dir>, $MARKDOWN_PUBLISH_SOURCE.
//   - an http(s) URL  -> fetched over HTTP   (a published site root)
//   - a local path     -> read from disk     (a built site dir / bundle root)
// Both expect the same layout: <source>/content/{search-index,manifest,graph}.json
// and <source>/content/notes/<slug>.json — exactly what the engine emits.

import { readFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';

const SERVER_NAME = 'markdown-publish';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';

// ---------------------------------------------------------------- source ----

function resolveSource() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--source');
  let src = i !== -1 ? argv[i + 1] : process.env.MARKDOWN_PUBLISH_SOURCE;
  // Guard against an un-expanded "${VAR}" placeholder leaking in from config.
  if (!src || src.includes('${')) return null;
  return src.trim();
}

const SOURCE = resolveSource();
const IS_REMOTE = !!SOURCE && /^https?:\/\//i.test(SOURCE);

/** Read one content artifact (relative to the `content/` dir) as parsed JSON. */
async function readContent(relative) {
  if (!SOURCE) {
    throw new Error(
      'No vault source configured. Set MARKDOWN_PUBLISH_SOURCE to a published ' +
        'markdown-publish site URL (e.g. https://you.github.io/notes/) or to a ' +
        'local built-site directory.',
    );
  }
  if (IS_REMOTE) {
    const base = SOURCE.endsWith('/') ? SOURCE : SOURCE + '/';
    const url = new URL(`content/${relative}`, base);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for content/${relative}`);
    return res.json();
  }
  const root = isAbsolute(SOURCE) ? SOURCE : resolve(process.cwd(), SOURCE);
  const file = join(root, 'content', relative);
  const text = await readFile(file, 'utf8');
  return JSON.parse(text);
}

// in-memory caches (the bundle is immutable per server run)
let _index = null;
const _notes = new Map();

async function loadIndex() {
  if (!_index) _index = await readContent('search-index.json');
  return _index;
}

function safeSlug(slug) {
  // strip leading slash + collapse any path-traversal before it hits fs/fetch
  return String(slug)
    .replace(/^\/+/, '')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

async function loadNote(slug) {
  const key = safeSlug(slug);
  if (!_notes.has(key)) _notes.set(key, await readContent(`notes/${key}.json`));
  return _notes.get(key);
}

// ---------------------------------------------------------------- search ----

function tokenize(s) {
  return String(s)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Title-weighted keyword scoring with a snippet window — mirrors the engine. */
async function searchNotes(query, limit) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const { docs } = await loadIndex();
  const scored = [];
  for (const doc of docs) {
    const title = doc.title.toLowerCase();
    const text = (doc.text || '').toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 8;
      let from = 0;
      let idx;
      while ((idx = text.indexOf(t, from)) !== -1) {
        score += 1;
        from = idx + t.length;
      }
    }
    if (score > 0) scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ doc }) => ({
    title: doc.title,
    slug: doc.slug,
    url: doc.url,
    snippet: snippet(doc.text || '', terms),
  }));
}

function snippet(text, terms) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return text.slice(0, 200).trim();
  const start = Math.max(0, at - 80);
  const end = Math.min(text.length, at + 120);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

// ----------------------------------------------------------------- tools ----

const TOOLS = [
  {
    name: 'search_notes',
    description:
      'Search the published notes by keyword and return the best matches ' +
      '(title, slug, url, snippet). Use this first to find relevant notes, ' +
      'then fetch full text with get_note.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query.' },
        limit: {
          type: 'number',
          description: 'Max results to return (1–25, default 10).',
          minimum: 1,
          maximum: 25,
        },
      },
      required: ['query'],
    },
    run: async (args) => {
      const hits = await searchNotes(String(args?.query ?? ''), clamp(args?.limit, 1, 25, 10));
      return ok({ results: hits });
    },
  },
  {
    name: 'get_note',
    description:
      'Fetch the full markdown text of a single published note by its slug ' +
      '(as returned by search_notes or list_notes), with title, url and backlinks.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Note slug, e.g. "guides/getting-started".' },
      },
      required: ['slug'],
    },
    run: async (args) => {
      const slug = safeSlug(args?.slug ?? '');
      try {
        const note = await loadNote(slug);
        return ok({
          slug: note.slug,
          title: note.title,
          url: `/${note.slug}`,
          markdown: note.markdown,
          backlinks: note.backlinks ?? [],
        });
      } catch {
        return fail(`Note not found: ${slug}`);
      }
    },
  },
  {
    name: 'list_notes',
    description:
      'List every published note (title, slug, url) so an agent can browse the ' +
      'full contents of the site.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const { docs } = await loadIndex();
      return ok({
        count: docs.length,
        notes: docs.map((d) => ({ title: d.title, slug: d.slug, url: d.url })),
      });
    },
  },
  {
    name: 'get_backlinks',
    description: 'List the notes that link to the given note (its backlinks).',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Note slug.' } },
      required: ['slug'],
    },
    run: async (args) => {
      const slug = safeSlug(args?.slug ?? '');
      try {
        const note = await loadNote(slug);
        return ok({ slug: note.slug, backlinks: note.backlinks ?? [] });
      } catch {
        return fail(`Note not found: ${slug}`);
      }
    },
  },
];

function ok(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}
function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}
function clamp(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ---------------------------------------------------------------- rpc loop --

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function result(id, res) {
  send({ jsonrpc: '2.0', id, result: res });
}
function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  // Notifications (no id) get no response.
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(
        id,
        { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
      );
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        return result(id, await tool.run(params?.arguments ?? {}));
      } catch (e) {
        return result(id, fail(`Tool error: ${e?.message ?? e}`));
      }
    }
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = '';
let pending = 0;
let stdinEnded = false;
function maybeExit() {
  if (stdinEnded && pending === 0) process.exit(0);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // ignore malformed lines
    }
    pending++;
    handle(msg)
      .catch((e) => process.stderr.write(`handler crash: ${e}\n`))
      .finally(() => {
        pending--;
        maybeExit();
      });
  }
});
process.stdin.on('end', () => {
  stdinEnded = true;
  maybeExit();
});

process.stderr.write(
  `markdown-publish MCP server up — source: ${SOURCE ?? '(unset)'}` +
    `${SOURCE ? ` [${IS_REMOTE ? 'remote' : 'local'}]` : ''}\n`,
);
