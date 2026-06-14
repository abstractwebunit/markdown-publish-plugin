// Automated tests for the markdown-publish MCP server.
// Spawns the real server over stdio against a local fixture bundle and asserts
// the JSON-RPC responses for every tool + error path. Zero dependencies.
//
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, '..', 'mcp', 'server.mjs');
const FIXTURE = join(here, 'fixtures');

/** Send a batch of JSON-RPC requests, return responses keyed by id. */
function rpc(requests, { source = FIXTURE } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--source', source], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => {
      const byId = {};
      for (const line of out.trim().split('\n').filter(Boolean)) {
        const msg = JSON.parse(line);
        byId[msg.id] = msg;
      }
      resolve(byId);
    });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n');
    child.stdin.end();
  });
}

const call = (id, name, args = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});
const structured = (msg) => msg.result.structuredContent;

test('initialize returns protocol + serverInfo', async () => {
  const r = await rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
  assert.equal(r[1].result.serverInfo.name, 'markdown-publish');
  assert.ok(r[1].result.protocolVersion);
  assert.deepEqual(r[1].result.capabilities, { tools: {} });
});

test('tools/list exposes the four tools', async () => {
  const r = await rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
  const names = r[1].result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['get_backlinks', 'get_note', 'list_notes', 'search_notes']);
});

test('list_notes returns every fixture note', async () => {
  const r = await rpc([call(1, 'list_notes')]);
  assert.equal(structured(r[1]).count, 3);
});

test('search_notes ranks a title/keyword hit first', async () => {
  const r = await rpc([call(1, 'search_notes', { query: 'dopamine', limit: 5 })]);
  const hits = structured(r[1]).results;
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((h) => h.slug === 'welcome'));
  assert.ok(hits[0].snippet.toLowerCase().includes('dopamine'));
});

test('search_notes respects the limit', async () => {
  const r = await rpc([call(1, 'search_notes', { query: 'publish', limit: 1 })]);
  assert.equal(structured(r[1]).results.length, 1);
});

test('get_note returns full markdown + backlinks for a nested slug', async () => {
  const r = await rpc([
    call(1, 'get_note', { slug: 'welcome' }),
    call(2, 'get_note', { slug: 'guides/getting-started' }),
  ]);
  assert.match(structured(r[1]).markdown, /# Welcome/);
  assert.equal(structured(r[1]).backlinks[0].slug, 'faq');
  assert.equal(structured(r[2]).title, 'Getting Started');
});

test('get_backlinks returns linking notes', async () => {
  const r = await rpc([call(1, 'get_backlinks', { slug: 'welcome' })]);
  assert.equal(structured(r[1]).backlinks[0].slug, 'faq');
});

test('get_note on a missing slug is a clean isError, not a crash', async () => {
  const r = await rpc([call(1, 'get_note', { slug: 'nope' })]);
  assert.equal(r[1].result.isError, true);
  assert.match(r[1].result.content[0].text, /not found/i);
});

test('path-traversal slug is neutralised', async () => {
  const r = await rpc([call(1, 'get_note', { slug: '../../etc/passwd' })]);
  assert.equal(r[1].result.isError, true);
});

test('unknown tool yields a JSON-RPC error', async () => {
  const r = await rpc([call(1, 'bogus_tool')]);
  assert.ok(r[1].error);
  assert.equal(r[1].error.code, -32602);
});

test('no source configured surfaces a helpful error', async () => {
  const r = await rpc([call(1, 'list_notes')], { source: '${MARKDOWN_PUBLISH_SOURCE}' });
  assert.equal(r[1].result.isError, true);
  assert.match(r[1].result.content[0].text, /source/i);
});
