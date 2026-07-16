import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { NetworkWatchClient } from '../../packages/bridge-client/network-watch-client.mjs';

function result(value, text = null) {
  return {
    content: [{ type: 'text', text: text ?? JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}

export function createNetworkWatchMcpServer(options = {}) {
  const client = new NetworkWatchClient(options.baseUrl);
  const server = new McpServer({ name: 'network-watch', version: '1.0.0' });

  server.registerTool('list_recordings', {
    title: 'List Network Watch recordings',
    description: 'List the total number of saved browser recordings. Returns recording IDs and every action in sequence with stable action IDs and human-readable descriptions so you can identify the exact journey and action.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.string().nullable().optional(),
    },
    outputSchema: {
      recordingCount: z.number(),
      recordings: z.array(z.any()),
      nextCursor: z.string().nullable(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try {
      const response = await client.listRecordings(input);
      return result({ recordingCount: response.recordingCount, recordings: response.recordings, nextCursor: response.nextCursor });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('get_recording', {
    title: 'Get a Network Watch recording',
    description: 'Get one complete recording by its REC-* ID, including its stable ordered actions and baseline request evidence.',
    inputSchema: { recordingId: z.string().startsWith('REC-') },
    outputSchema: { recording: z.any() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ recordingId }) => {
    try {
      const response = await client.getRecording(recordingId);
      return result({ recording: response.recording });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('replay_recording', {
    title: 'Replay and compare a Network Watch recording',
    description: 'Replay a saved REC-* browser journey in the active Chrome tab. Returns whether all actions succeeded in the original sequence and whether the replay produced the same normalized requests, including matched, missing, unexpected, reordered, and status-changed counts.',
    inputSchema: {
      recordingId: z.string().startsWith('REC-'),
      timeoutMs: z.number().int().min(1000).max(600000).default(120000),
      idempotencyKey: z.string().max(200).nullable().optional(),
    },
    outputSchema: {
      runId: z.string(),
      recordingId: z.string(),
      status: z.enum(['queued', 'running', 'completed', 'failed']),
      summary: z.any().nullable(),
      events: z.array(z.any()),
      firstMismatch: z.any().nullable(),
      error: z.string().nullable(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async input => {
    try {
      const job = await client.replayRecording(input);
      const comparison = job.comparison || {};
      return result({
        runId: job.runId,
        recordingId: job.recordingId,
        status: job.status,
        summary: comparison.summary || null,
        events: comparison.events || [],
        firstMismatch: comparison.firstMismatch || null,
        error: job.error || null,
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('get_replay_result', {
    title: 'Get a Network Watch replay result',
    description: 'Get the current or completed result for a REPLAY-* run returned by replay_recording.',
    inputSchema: { runId: z.string().startsWith('REPLAY-') },
    outputSchema: { job: z.any() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ runId }) => {
    try {
      const response = await client.getReplayResult(runId);
      return result({ job: response.job });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('export_recording_analysis', {
    title: 'Export recording evidence for a coding agent',
    description: 'Return a Network Watch recording export directly as Markdown or JSON. The response contains the ordered actions, baseline requests, and an optional replay comparison so a coding agent such as GitHub Copilot CLI can immediately work from the evidence without opening a file.',
    inputSchema: {
      recordingId: z.string().startsWith('REC-'),
      runId: z.string().startsWith('REPLAY-').nullable().optional(),
      format: z.enum(['markdown', 'json']).default('markdown'),
    },
    outputSchema: {
      format: z.enum(['markdown', 'json']),
      recordingId: z.string(),
      runId: z.string().nullable(),
      export: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ recordingId, runId = null, format }) => {
    try {
      const response = await client.exportRecording({ recordingId, runId, format });
      const structured = { format: response.format, recordingId, runId, export: response.content };
      return result(structured, response.content);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('export_network_capture', {
    title: 'Export the current Network Watch capture',
    description: 'Return the current captured network requests directly as JSON or Markdown for analysis by the calling model or coding CLI.',
    inputSchema: { format: z.enum(['markdown', 'json']).default('json') },
    outputSchema: { format: z.enum(['markdown', 'json']), requestCount: z.number(), export: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ format }) => {
    try {
      const response = await client.exportNetwork(format);
      const structured = { format: response.format, requestCount: response.data.requestCount, export: response.content };
      return result(structured, response.content);
    } catch (error) {
      return errorResult(error);
    }
  });

  return server;
}
