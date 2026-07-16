import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { formatReplayReport } from '../services/mcp/server.mjs';

test('replay report gives the model action success, response equality, and timing', () => {
  const report = formatReplayReport({
    runId: 'REPLAY-test', recordingId: 'REC-test', status: 'completed',
    comparison: {
      summary: { message: 'All 1 actions and requests matched.' },
      events: [{
        sequence: 1, description: 'Click “Search”', success: true, requests: {
          matched: [{
            method: 'GET', url: 'https://example.test/api/search',
            baselineStatus: 200, replayStatus: 200, responseSame: true,
            responseComparisonBasis: 'body-hash', responseMessage: 'Same response received.',
            baselineDurationMs: 250, replayDurationMs: 100, deltaMs: -150, timingComparison: 'faster',
            hierarchyAccepted: true,
            hierarchyMessage: 'Matched occurrence 1 across action windows: recorded action 2, replay action 1.',
          }],
          missing: [], unexpected: [],
        },
      }],
    },
  });

  assert.match(report, /Action 1 - Success: true/);
  assert.match(report, /Request 1: GET https:\/\/example\.test\/api\/search/);
  assert.match(report, /Response: Same response received\./);
  assert.match(report, /Hierarchy: Matched occurrence 1 across action windows: recorded action 2, replay action 1\./);
  assert.match(report, /Replay took 150 ms faster \(100 ms vs 250 ms recorded\)/);
});

test('stdio server exposes the recording, replay, and export tools', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['services/mcp/stdio.mjs'], cwd: process.cwd(), stderr: 'pipe' });
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
