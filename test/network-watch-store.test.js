const test = require('node:test');
const assert = require('node:assert/strict');
const { NetworkWatchStore, actionDescription, normalizedRequestUrl } = require('../packages/store/src/network-watch-store');

function addRequest(store, { id, wallTime, url, status = 200, method = 'GET', resourceType = 'Fetch' }) {
  store.addNetworkEvent({ type: 'request', requestId: id, wallTime, timestamp: wallTime, url, method, resourceType });
  store.addNetworkEvent({ type: 'response', requestId: id, timestamp: wallTime + 0.05, url, status, statusText: String(status), resourceType });
  store.addNetworkEvent({ type: 'finished', requestId: id, timestamp: wallTime + 0.1, encodedDataLength: 100 });
}

function recording(id, timestamp, actions, extra = {}) {
  return {
    id,
    kind: 'recording',
    url: 'https://example.test/',
    title: 'Fixture journey',
    startedAt: new Date(timestamp).toISOString(),
    stoppedAt: new Date(timestamp + 5000).toISOString(),
    actions,
    ...extra,
  };
}

test('actions receive stable sequence positions and human-readable descriptions', () => {
  const store = new NetworkWatchStore();
  store.addRecording(recording('REC-one', 1_000_000, [{ id: 'ACT-one', type: 'click', selector: '#buy', text: 'Buy now', timestamp: 1_000_000, delayMs: 0 }]));
  const listed = store.listRecordings();
  assert.equal(listed.recordingCount, 1);
  assert.deepEqual(listed.recordings[0].actions[0], {
    id: 'ACT-one', sequence: 1, type: 'click', description: 'Click “Buy now”', pageUrl: 'https://example.test/', selector: '#buy', delayMs: 0, requestCount: 0,
  });
  assert.equal(actionDescription({ type: 'keypress', key: 'Enter', selector: '#search' }), 'Press Enter in #search');
});

test('volatile query values normalize to the same request identity', () => {
  assert.equal(
    normalizedRequestUrl('https://example.test/api/items?utm_source=a&ts=100&q=book'),
    normalizedRequestUrl('https://example.test/api/items?q=book&ts=999&utm_source=b'),
  );
});

test('network exports include request data while redacting common secrets', () => {
  const store = new NetworkWatchStore();
  store.addNetworkEvent({
    type: 'request', requestId: 'secret-request', wallTime: 5000, timestamp: 5000,
    url: 'https://example.test/api?token=secret&q=safe', method: 'POST', resourceType: 'Fetch',
    headers: { Authorization: 'Bearer secret', Accept: 'application/json' },
    postData: JSON.stringify({ username: 'octocat', password: 'secret' }),
  });
  const exported = store.exportNetwork('json');
  assert.doesNotMatch(exported.content, /Bearer secret|"password":"secret"|token=secret/);
  assert.match(exported.content, /\[REDACTED\]/);
  assert.match(exported.content, /octocat/);
});

test('completed replay compares action order and request equality', () => {
  const store = new NetworkWatchStore();
  addRequest(store, { id: 'baseline-request', wallTime: 1000.5, method: 'POST', url: 'https://example.test/api/cart?ts=100' });
  store.addRecording(recording('REC-checkout', 1_000_000, [
    { id: 'ACT-add', type: 'click', selector: '#add', text: 'Add', timestamp: 1_000_000, delayMs: 0 },
  ]));
  const job = store.createReplayJob('REC-checkout', 'test-run');
  store.claimReplayJob();
  addRequest(store, { id: 'replay-request', wallTime: 2000.5, method: 'POST', url: 'https://example.test/api/cart?ts=999' });
  store.addRecording(recording(job.runId, 2_000_000, [
    { id: 'ACT-replayed-add', sourceActionId: 'ACT-add', type: 'click', selector: '#add', text: 'Add', timestamp: 2_000_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-checkout' }));

  const completed = store.getReplayJob(job.runId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.comparison.summary.sequenceMatch, true);
  assert.equal(completed.comparison.summary.requestsMatch, true);
  assert.equal(completed.comparison.summary.equivalent, true);
  assert.equal(completed.comparison.summary.matchedRequestCount, 1);
  assert.match(completed.comparison.summary.message, /All 1 actions replayed in order/);

  const exported = store.exportRecording({ recordingId: 'REC-checkout', runId: job.runId, format: 'markdown' });
  assert.match(exported.content, /# Network Watch recording export/);
  assert.match(exported.content, /All 1 actions replayed in order/);
  assert.match(exported.content, /POST https:\/\/example\.test\/api\/cart/);
});

test('status changes make a replay non-equivalent', () => {
  const store = new NetworkWatchStore();
  addRequest(store, { id: 'baseline', wallTime: 3000.2, url: 'https://example.test/api/order', status: 200 });
  store.addRecording(recording('REC-status', 3_000_000, [
    { id: 'ACT-submit', type: 'click', selector: '#submit', timestamp: 3_000_000, delayMs: 0 },
  ]));
  const job = store.createReplayJob('REC-status');
  store.claimReplayJob();
  addRequest(store, { id: 'replay', wallTime: 4000.2, url: 'https://example.test/api/order', status: 500 });
  store.addRecording(recording(job.runId, 4_000_000, [
    { id: 'ACT-submit-replay', sourceActionId: 'ACT-submit', type: 'click', selector: '#submit', timestamp: 4_000_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-status' }));
  const summary = store.getReplayJob(job.runId).comparison.summary;
  assert.equal(summary.sequenceMatch, true);
  assert.equal(summary.requestsMatch, false);
  assert.equal(summary.statusChangedRequestCount, 1);
  assert.equal(summary.equivalent, false);
});
