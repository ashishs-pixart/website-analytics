import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startNetworkWatchHttpServer } from '../services/mcp/http.mjs';

test('Streamable HTTP entry point exposes a health endpoint', async () => {
  const { listener } = startNetworkWatchHttpServer({ port: 0, host: '127.0.0.1' });
  if (!listener.listening) await once(listener, 'listening');
  try {
    const address = listener.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, app: 'Network Watch MCP' });
    const client = new Client({ name: 'network-watch-http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    try {
      const tools = await client.listTools();
      assert.equal(tools.tools.some(tool => tool.name === 'export_recording_analysis'), true);
      assert.equal(tools.tools.some(tool => tool.name === 'replay_recording'), true);
    } finally {
      await client.close();
    }
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});
