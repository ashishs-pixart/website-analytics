const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 1;
const MAX_RECORDINGS = 100;
const MAX_NETWORK_REQUESTS = 10000;
const VOLATILE_QUERY_KEY = /^(?:_|cb|cachebust|cachebuster|nonce|timestamp|ts|t|utm_.+|gclid|fbclid)$/i;
const SENSITIVE_QUERY_KEY = /(?:token|secret|password|passwd|authorization|api[-_]?key|session|cookie)/i;
const SENSITIVE_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function actionDescription(action) {
  const text = String(action.text || action.locator?.ariaLabel || action.locator?.text || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const target = text ? `“${text}”` : action.selector || action.tagName || 'the target';
  if (action.type === 'click') return `Click ${target}`;
  if (action.type === 'input') return `Enter text in ${target}`;
  if (action.type === 'change') return `Change ${target}`;
  if (action.type === 'keypress') return `Press ${action.key || 'a key'} in ${target}`;
  if (action.type === 'scroll') return `Scroll to ${Math.round(action.scrollX || 0)}, ${Math.round(action.scrollY || 0)}`;
  return `${action.type || 'Perform action'} on ${target}`;
}

function normalizeAction(action, index) {
  return {
    ...clone(action),
    sequence: index + 1,
    description: action.description || actionDescription(action),
  };
}

function safeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return String(rawUrl || '').slice(0, 4000);
  }
}

function normalizedRequestUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const query = [];
    for (const [key, value] of url.searchParams.entries()) {
      if (VOLATILE_QUERY_KEY.test(key)) continue;
      query.push([key, SENSITIVE_QUERY_KEY.test(key) ? '[REDACTED]' : value]);
    }
    query.sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
    const suffix = query.length ? `?${new URLSearchParams(query).toString()}` : '';
    return `${url.origin}${url.pathname}${suffix}`;
  } catch {
    return String(rawUrl || '').split('#')[0];
  }
}

function requestFingerprint(request) {
  return [
    String(request.method || 'GET').toUpperCase(),
    normalizedRequestUrl(request.url),
    request.resourceType || 'Other',
  ].join(' ');
}

function requestDuration(request) {
  if (typeof request.startedAt !== 'number' || typeof request.finishedAt !== 'number') return null;
  return Math.max(0, (request.finishedAt - request.startedAt) * 1000);
}

function requestSnapshot(request) {
  return {
    id: request.id,
    method: request.method || 'GET',
    url: safeUrl(request.url),
    normalizedUrl: normalizedRequestUrl(request.url),
    fingerprint: requestFingerprint(request),
    resourceType: request.resourceType || 'Other',
    status: request.status,
    statusText: request.statusText || '',
    failed: Boolean(request.failed),
    error: request.errorText || null,
    durationMs: requestDuration(request),
    transferredBytes: request.encodedDataLength || 0,
    startedAt: request.wallTime ? new Date(request.wallTime * 1000).toISOString() : null,
    requestHeaders: redactHeaders({ ...request.requestHeaders, ...request.requestExtraHeaders }),
    responseHeaders: redactHeaders({ ...request.responseHeaders, ...request.responseExtraHeaders }),
    payload: redactBody(request.postData),
  };
}

function redactHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE_HEADER.test(name) ? '[REDACTED]' : value]));
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_QUERY_KEY.test(key) ? '[REDACTED]' : redactObject(item)]));
}

function redactBody(body) {
  if (body == null) return null;
  const text = String(body).slice(0, 10000);
  try {
    return JSON.stringify(redactObject(JSON.parse(text)));
  } catch {
    try {
      const params = new URLSearchParams(text);
      if ([...params.keys()].length) {
        for (const key of [...params.keys()]) if (SENSITIVE_QUERY_KEY.test(key)) params.set(key, '[REDACTED]');
        return params.toString();
      }
    } catch { /* Return bounded non-structured content. */ }
    return text;
  }
}

function emptyRequest(id) {
  return {
    id,
    method: '',
    url: '',
    status: null,
    statusText: '',
    resourceType: 'Other',
    startedAt: null,
    finishedAt: null,
    wallTime: null,
    failed: false,
    errorText: '',
    encodedDataLength: 0,
    requestHeaders: {},
    requestExtraHeaders: {},
    responseHeaders: {},
    responseExtraHeaders: {},
    postData: null,
  };
}

function applyNetworkEvent(current, event) {
  const request = { ...current };
  if (event.type === 'request') {
    request.method = event.method || '';
    request.url = event.url || '';
    request.resourceType = event.resourceType || request.resourceType;
    request.startedAt = event.timestamp ?? request.startedAt;
    request.wallTime = event.wallTime ?? request.wallTime;
    request.requestHeaders = event.headers || {};
    request.postData = event.postData || null;
  } else if (event.type === 'request-extra') {
    request.requestExtraHeaders = event.headers || {};
  } else if (event.type === 'response') {
    request.status = event.status;
    request.statusText = event.statusText || '';
    request.resourceType = event.resourceType || request.resourceType;
    request.responseHeaders = event.headers || {};
  } else if (event.type === 'response-extra') {
    request.responseExtraHeaders = event.headers || {};
    if (request.status == null) request.status = event.statusCode ?? null;
  } else if (event.type === 'finished') {
    request.finishedAt = event.timestamp ?? request.finishedAt;
    request.encodedDataLength = event.encodedDataLength || 0;
  } else if (event.type === 'failed') {
    request.finishedAt = event.timestamp ?? request.finishedAt;
    request.failed = true;
    request.status = 'ERR';
    request.errorText = event.errorText || event.blockedReason || 'Failed';
  } else if (event.type === 'ws-created') {
    request.method = 'WS';
    request.url = event.url || '';
    request.resourceType = 'WebSocket';
  }
  return request;
}

function requestEvidenceForRecording(recording, requests) {
  const result = {};
  const actions = recording.actions || [];
  actions.forEach((action, index) => {
    const start = Number(action.timestamp || 0) - 100;
    const stoppedAt = Date.parse(recording.stoppedAt || '') || start + 15000;
    const nextTimestamp = Number(actions[index + 1]?.timestamp || 0);
    const end = nextTimestamp || Math.min(stoppedAt + 1000, start + 15100);
    result[action.id] = requests
      .filter(request => request.wallTime && request.wallTime * 1000 >= start && request.wallTime * 1000 < end)
      .map(requestSnapshot);
  });
  return result;
}

function compareRequestLists(baseline = [], replay = []) {
  const usedReplay = new Set();
  const matched = [];
  const missing = [];
  const reordered = [];
  const statusChanged = [];

  baseline.forEach((expected, expectedIndex) => {
    const actualIndex = replay.findIndex((candidate, index) => !usedReplay.has(index) && candidate.fingerprint === expected.fingerprint);
    if (actualIndex < 0) {
      missing.push(expected);
      return;
    }
    usedReplay.add(actualIndex);
    const actual = replay[actualIndex];
    const pair = {
      fingerprint: expected.fingerprint,
      baselineStatus: expected.status,
      replayStatus: actual.status,
      baselineDurationMs: expected.durationMs,
      replayDurationMs: actual.durationMs,
      deltaMs: expected.durationMs == null || actual.durationMs == null ? null : actual.durationMs - expected.durationMs,
      baselineRequestId: expected.id,
      replayRequestId: actual.id,
    };
    if (actualIndex !== expectedIndex) reordered.push({ ...pair, expectedPosition: expectedIndex + 1, replayPosition: actualIndex + 1 });
    if (expected.status !== actual.status) statusChanged.push(pair);
    matched.push(pair);
  });

  const unexpected = replay.filter((_request, index) => !usedReplay.has(index));
  return {
    match: missing.length === 0 && unexpected.length === 0 && reordered.length === 0 && statusChanged.length === 0,
    matched,
    missing,
    unexpected,
    reordered,
    statusChanged,
    ambiguous: [],
  };
}

function deterministicSummary(summary) {
  const actionText = summary.sequenceMatch
    ? `All ${summary.eventsTotal} actions replayed in order.`
    : `${summary.eventsSucceeded} of ${summary.eventsTotal} actions replayed successfully.`;
  const requestText = summary.requestsMatch
    ? `${summary.matchedRequestCount} of ${summary.baselineRequestCount} expected requests matched.`
    : `${summary.matchedRequestCount} of ${summary.baselineRequestCount} expected requests matched; ${summary.missingRequestCount} missing, ${summary.unexpectedRequestCount} unexpected, ${summary.reorderedRequestCount} reordered, and ${summary.statusChangedRequestCount} status changed.`;
  return `${actionText} ${requestText}`;
}

function compareReplay(sourceRecording, replayRecording) {
  const replayBySourceId = new Map((replayRecording.actions || []).map(action => [action.sourceActionId, action]));
  const events = [];
  let firstMismatch = null;
  let eventsSucceeded = 0;
  const totals = { matched: 0, baseline: 0, replay: 0, missing: 0, unexpected: 0, reordered: 0, statusChanged: 0, ambiguous: 0 };

  (sourceRecording.actions || []).forEach((sourceAction, index) => {
    const replayAction = replayBySourceId.get(sourceAction.id);
    const outcomeSucceeded = replayAction?.outcome === 'success';
    if (outcomeSucceeded) eventsSucceeded += 1;
    if (!firstMismatch && (!replayAction || !outcomeSucceeded || replayAction.sequence !== index + 1)) {
      firstMismatch = {
        sequence: index + 1,
        expectedActionId: sourceAction.id,
        actualActionId: replayAction?.id || null,
        error: replayAction?.replayError || (!replayAction ? 'The action was not replayed.' : 'The action was replayed out of sequence.'),
      };
    }
    const baselineRequests = sourceRecording.requestEvidence?.[sourceAction.id] || [];
    const replayRequests = replayAction ? replayRecording.requestEvidence?.[replayAction.id] || [] : [];
    const requests = compareRequestLists(baselineRequests, replayRequests);
    totals.baseline += baselineRequests.length;
    totals.replay += replayRequests.length;
    totals.matched += requests.matched.length;
    totals.missing += requests.missing.length;
    totals.unexpected += requests.unexpected.length;
    totals.reordered += requests.reordered.length;
    totals.statusChanged += requests.statusChanged.length;
    totals.ambiguous += requests.ambiguous.length;
    events.push({
      sourceEventId: sourceAction.id,
      replayEventId: replayAction?.id || null,
      sequence: index + 1,
      description: sourceAction.description || actionDescription(sourceAction),
      replayStatus: outcomeSucceeded ? 'succeeded' : 'failed',
      replayError: replayAction?.replayError || null,
      requests,
    });
  });

  const eventsTotal = sourceRecording.actions?.length || 0;
  if (!firstMismatch && (replayRecording.actions?.length || 0) !== eventsTotal) {
    const extraAction = replayRecording.actions?.[eventsTotal];
    firstMismatch = {
      sequence: Math.min(eventsTotal, replayRecording.actions?.length || 0) + 1,
      expectedActionId: null,
      actualActionId: extraAction?.id || null,
      error: (replayRecording.actions?.length || 0) > eventsTotal
        ? 'The replay produced an extra action.'
        : 'The replay ended before all recorded actions ran.',
    };
  }
  const sequenceMatch = !firstMismatch && (replayRecording.actions?.length || 0) === eventsTotal;
  const requestsMatch = totals.missing === 0 && totals.unexpected === 0 && totals.reordered === 0 && totals.statusChanged === 0 && totals.ambiguous === 0;
  const summary = {
    equivalent: sequenceMatch && requestsMatch,
    sequenceMatch,
    requestsMatch,
    eventsTotal,
    eventsSucceeded,
    eventsFailed: eventsTotal - eventsSucceeded,
    baselineRequestCount: totals.baseline,
    replayRequestCount: totals.replay,
    matchedRequestCount: totals.matched,
    missingRequestCount: totals.missing,
    unexpectedRequestCount: totals.unexpected,
    reorderedRequestCount: totals.reordered,
    statusChangedRequestCount: totals.statusChanged,
    ambiguousRequestCount: totals.ambiguous,
  };
  summary.message = deterministicSummary(summary);
  return { summary, events, firstMismatch };
}

function markdownExport(bundle) {
  const lines = ['# Network Watch recording export', ''];
  const source = bundle.recording;
  lines.push(`- Recording: ${source.id}`, `- Title: ${source.title || '(untitled)'}`, `- URL: ${source.url}`, `- Actions: ${source.actions.length}`, '');
  if (bundle.comparison) {
    lines.push('## Replay summary', '', bundle.comparison.summary.message, '', '```json', JSON.stringify(bundle.comparison.summary, null, 2), '```', '');
  }
  lines.push('## Recorded sequence', '');
  source.actions.forEach(action => {
    lines.push(`### ${action.sequence}. ${action.description}`, '', `- Action ID: ${action.id}`, `- Type: ${action.type}`, `- Selector: ${action.selector}`, `- Page: ${action.pageUrl || action.startUrl || source.url}`, '');
    const requests = source.requestEvidence?.[action.id] || [];
    lines.push('#### Baseline requests', '');
    if (!requests.length) lines.push('- None captured');
    else requests.forEach(request => lines.push(`- ${request.method} ${request.url} → ${request.status ?? 'pending'}${request.durationMs == null ? '' : ` in ${Math.round(request.durationMs)} ms`}`));
    lines.push('');
  });
  if (bundle.replay) {
    lines.push('## Replay details', '', '```json', JSON.stringify(bundle.comparison, null, 2), '```', '');
  }
  return lines.join('\n');
}

class NetworkWatchStore {
  constructor(storagePath = null) {
    this.storagePath = storagePath;
    this.recordings = [];
    this.jobs = [];
    this.networkRequests = new Map();
    this.networkOrder = [];
    this.load();
  }

  load() {
    if (!this.storagePath) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (data.version === STORE_VERSION) {
        this.recordings = Array.isArray(data.recordings) ? data.recordings : [];
        this.jobs = Array.isArray(data.jobs)
          ? data.jobs.map(job => job.status === 'running' ? { ...job, status: 'queued', startedAt: null } : job)
          : [];
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(`Could not load Network Watch store: ${error.message}`);
    }
  }

  persist() {
    if (!this.storagePath) return;
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: STORE_VERSION, recordings: this.recordings, jobs: this.jobs.slice(0, 100) }, null, 2));
    fs.renameSync(temporaryPath, this.storagePath);
  }

  addNetworkEvent(event) {
    if (!event?.requestId) return;
    const existed = this.networkRequests.has(event.requestId);
    this.networkRequests.set(event.requestId, applyNetworkEvent(this.networkRequests.get(event.requestId) || emptyRequest(event.requestId), event));
    if (!existed) this.networkOrder.push(event.requestId);
    while (this.networkOrder.length > MAX_NETWORK_REQUESTS) {
      this.networkRequests.delete(this.networkOrder.shift());
    }
  }

  networkSnapshot() {
    return this.networkOrder.map(id => this.networkRequests.get(id)).filter(Boolean).map(requestSnapshot);
  }

  addRecording(value) {
    if (!value || typeof value !== 'object' || !value.id || !Array.isArray(value.actions)) throw new Error('A recording ID and actions are required.');
    const recording = {
      ...clone(value),
      schemaVersion: 1,
      actions: value.actions.map(normalizeAction),
    };
    recording.requestEvidence = requestEvidenceForRecording(recording, this.networkOrder.map(id => this.networkRequests.get(id)).filter(Boolean));
    this.recordings = [recording, ...this.recordings.filter(item => item.id !== recording.id)].slice(0, MAX_RECORDINGS);
    if (recording.kind === 'replay' && recording.sourceRecordingId) {
      const source = this.getRecording(recording.sourceRecordingId);
      const job = this.jobs.find(item => item.runId === recording.id || (item.recordingId === recording.sourceRecordingId && item.status === 'running'));
      if (source && job) {
        const comparison = compareReplay(source, recording);
        Object.assign(job, { runId: recording.id, replayId: recording.id, status: 'completed', completedAt: new Date().toISOString(), comparison });
      }
    }
    this.persist();
    return clone(recording);
  }

  listRecordings({ limit = 20, cursor = 0 } = {}) {
    const originals = this.recordings.filter(recording => recording.kind !== 'replay');
    const offset = Math.max(0, Number(cursor) || 0);
    const page = originals.slice(offset, offset + Math.max(1, Math.min(100, Number(limit) || 20))).map(recording => ({
      id: recording.id,
      title: recording.title || '',
      url: recording.url || '',
      startedAt: recording.startedAt,
      stoppedAt: recording.stoppedAt,
      eventCount: recording.actions.length,
      actions: recording.actions.map(action => ({
        id: action.id,
        sequence: action.sequence,
        type: action.type,
        description: action.description,
        pageUrl: action.pageUrl || action.startUrl || recording.url,
        selector: action.selector,
        key: action.key,
        delayMs: action.delayMs,
        requestCount: recording.requestEvidence?.[action.id]?.length || 0,
      })),
    }));
    const nextOffset = offset + page.length;
    return { recordingCount: originals.length, recordings: clone(page), nextCursor: nextOffset < originals.length ? String(nextOffset) : null };
  }

  getRecording(id) {
    return this.recordings.find(recording => recording.id === id) || null;
  }

  clearRecordings() {
    this.recordings = [];
    this.jobs = [];
    this.persist();
  }

  createReplayJob(recordingId, idempotencyKey = null) {
    const recording = this.getRecording(recordingId);
    if (!recording || recording.kind === 'replay') throw new Error(`Recording ${recordingId} was not found.`);
    if (idempotencyKey) {
      const existing = this.jobs.find(job => job.idempotencyKey === idempotencyKey);
      if (existing) return clone(existing);
    }
    const job = {
      runId: `REPLAY-${crypto.randomUUID()}`,
      recordingId,
      idempotencyKey,
      status: 'queued',
      requestedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      comparison: null,
    };
    this.jobs.unshift(job);
    this.persist();
    return clone(job);
  }

  claimReplayJob() {
    const job = this.jobs.find(item => item.status === 'queued');
    if (!job) return null;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.persist();
    return { job: clone(job), recording: clone(this.getRecording(job.recordingId)) };
  }

  failReplayJob(runId, error) {
    const job = this.jobs.find(item => item.runId === runId);
    if (!job) return null;
    Object.assign(job, { status: 'failed', completedAt: new Date().toISOString(), error: String(error || 'Replay failed') });
    this.persist();
    return clone(job);
  }

  getReplayJob(runId) {
    return clone(this.jobs.find(job => job.runId === runId || job.replayId === runId) || null);
  }

  exportRecording({ recordingId, runId = null, format = 'markdown' }) {
    const recording = this.getRecording(recordingId);
    if (!recording) throw new Error(`Recording ${recordingId} was not found.`);
    const job = runId ? this.jobs.find(item => item.runId === runId || item.replayId === runId) : this.jobs.find(item => item.recordingId === recordingId && item.status === 'completed');
    const replay = job?.replayId ? this.getRecording(job.replayId) : null;
    const bundle = { exportedAt: new Date().toISOString(), recording: clone(recording), replay: clone(replay), comparison: clone(job?.comparison || null) };
    return { format, content: format === 'json' ? JSON.stringify(bundle, null, 2) : markdownExport(bundle), data: bundle };
  }

  exportNetwork(format = 'json') {
    const data = { exportedAt: new Date().toISOString(), source: 'Network Watch', requestCount: this.networkOrder.length, requests: this.networkSnapshot() };
    if (format === 'json') return { format, content: JSON.stringify(data, null, 2), data };
    const content = ['# Network Watch request export', '', `- Exported: ${data.exportedAt}`, `- Requests: ${data.requestCount}`, '', ...data.requests.map((request, index) => `## ${index + 1}. ${request.method} ${request.url}\n\n- Status: ${request.status ?? 'pending'}\n- Type: ${request.resourceType}\n- Duration: ${request.durationMs == null ? 'unknown' : `${Math.round(request.durationMs)} ms`}\n- Bytes: ${request.transferredBytes}`)].join('\n');
    return { format, content, data };
  }
}

module.exports = {
  NetworkWatchStore,
  actionDescription,
  compareReplay,
  normalizedRequestUrl,
  requestFingerprint,
};
