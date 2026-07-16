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

function duration(value) {
  return value == null ? 'unknown' : `${Math.round(value)} ms`;
}

function timingMessage(request) {
  let classification = request.timingComparison;
  if (!classification) {
    if (request.baselineDurationMs == null || request.replayDurationMs == null) classification = 'unknown';
    else if (request.replayDurationMs < request.baselineDurationMs) classification = 'faster';
    else if (request.replayDurationMs > request.baselineDurationMs) classification = 'slower';
    else classification = 'same';
  }
  if (classification === 'unknown') return 'Timing unavailable.';
  if (classification === 'same') return `Replay took the same time (${duration(request.replayDurationMs)}).`;
  const deltaMs = request.deltaMs ?? request.replayDurationMs - request.baselineDurationMs;
  return `Replay took ${duration(Math.abs(deltaMs))} ${classification} (${duration(request.replayDurationMs)} vs ${duration(request.baselineDurationMs)} recorded).`;
}

export function formatReplayReport(job) {
  const comparison = job.comparison || {};
  const lines = [
    `Replay ${job.status}: ${job.runId}`,
    `Recording: ${job.recordingId}`,
  ];
  if (!comparison.events?.length) {
    if (job.error) lines.push(`Error: ${job.error}`);
    else lines.push('No completed action report is available yet.');
    return lines.join('\n');
  }

  for (const event of comparison.events) {
    const actionSucceeded = event.success ?? event.replayStatus === 'succeeded';
    lines.push('', `Action ${event.sequence} - Success: ${actionSucceeded}`, event.description);
    if (event.replayError) lines.push(`Error: ${event.replayError}`);
    const matched = event.requests?.matched || [];
    const missing = event.requests?.missing || [];
    const unexpected = event.requests?.unexpected || [];
    if (!matched.length && !missing.length && !unexpected.length) lines.push('Requests: none');
    matched.forEach((request, index) => {
      const responseSame = request.responseSame ?? request.baselineStatus === request.replayStatus;
      lines.push(
        `Request ${index + 1}: ${request.method || request.fingerprint} ${request.url || ''}`.trim(),
        ...(request.hierarchyMessage ? [`Hierarchy: ${request.hierarchyMessage}`] : []),
        `Response: ${request.responseMessage || (responseSame ? 'Same response received.' : 'A different response was received.')} (${request.baselineStatus ?? 'unknown'} recorded, ${request.replayStatus ?? 'unknown'} replay; compared by ${request.responseComparisonBasis || 'status'}).`,
        `Time: ${timingMessage(request)}`,
      );
    });
    missing.forEach((request, index) => lines.push(`Missing request ${index + 1}: ${request.method || ''} ${request.url || request.fingerprint}`.trim()));
    unexpected.forEach((request, index) => lines.push(`Unexpected request ${index + 1}: ${request.method || ''} ${request.url || request.fingerprint}`.trim()));
  }
  lines.push('', comparison.summary?.message || 'Replay comparison completed.');
  return lines.join('\n');
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
    description: 'Replay a saved REC-* browser journey in the active Chrome tab. Requests are matched across the whole journey by normalized identity and occurrence number, regardless of action window; for example, the second occurrence in the recording is compared with the second occurrence in the replay. Returns deterministic response equality and timing for every match, plus missing, unexpected, status-changed, and response-changed counts.',
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
      const structured = {
        runId: job.runId,
        recordingId: job.recordingId,
        status: job.status,
        summary: comparison.summary || null,
        events: comparison.events || [],
        firstMismatch: comparison.firstMismatch || null,
        error: job.error || null,
      };
      return result(structured, formatReplayReport(job));
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
      return result({ job: response.job }, formatReplayReport(response.job));
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
