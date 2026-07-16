import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('stdio server exposes the recording, replay, and export tools', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['mcp/stdio.mjs'], cwd: process.cwd(), stderr: 'pipe' });
  const client = new Client({ name: 'network-watch-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const response = await client.listTools();
    const names = response.tools.map(tool => tool.name).sort();
    assert.deepEqual(names, [
      'export_network_capture',
      'export_recording_analysis',
      'get_recording',
      'get_replay_result',
      'list_recordings',
      'replay_recording',
    ]);
  } finally {
    await client.close();
  }
});
