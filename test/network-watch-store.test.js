const test = require('node:test');
const assert = require('node:assert/strict');
const { NetworkWatchStore, actionDescription, normalizedRequestUrl } = require('../packages/store/src/network-watch-store');

function addRequest(store, { id, wallTime, url, status = 200, method = 'GET', resourceType = 'Fetch', durationMs = 100, responseBodyHash = null }) {
  store.addNetworkEvent({ type: 'request', requestId: id, wallTime, timestamp: wallTime, url, method, resourceType });
  store.addNetworkEvent({ type: 'response', requestId: id, timestamp: wallTime + 0.05, url, status, statusText: String(status), resourceType });
  store.addNetworkEvent({ type: 'finished', requestId: id, timestamp: wallTime + durationMs / 1000, encodedDataLength: 100 });
  if (responseBodyHash) store.addNetworkEvent({ type: 'response-body-hash', requestId: id, responseBodyHash });
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

test('replay stores exact response equality and faster request timing without AI', () => {
  const store = new NetworkWatchStore();
  addRequest(store, {
    id: 'baseline', wallTime: 5000.2, url: 'https://example.test/api/search',
    durationMs: 250, responseBodyHash: 'same-body-hash',
  });
  store.addRecording(recording('REC-response', 5_000_000, [
    { id: 'ACT-search', type: 'click', selector: '#search', timestamp: 5_000_000, delayMs: 0 },
  ]));
  const job = store.createReplayJob('REC-response');
  store.claimReplayJob();
  addRequest(store, {
    id: 'replay', wallTime: 6000.2, url: 'https://example.test/api/search',
    durationMs: 100, responseBodyHash: 'same-body-hash',
  });
  store.addRecording(recording(job.runId, 6_000_000, [
    { id: 'ACT-search-replay', sourceActionId: 'ACT-search', type: 'click', selector: '#search', timestamp: 6_000_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-response' }));

  const event = store.getReplayJob(job.runId).comparison.events[0];
  const request = event.requests.matched[0];
  assert.equal(event.success, true);
  assert.equal(request.responseSame, true);
  assert.equal(request.responseComparisonBasis, 'body-hash');
  assert.equal(request.responseMessage, 'Same response received.');
  assert.equal(request.timingComparison, 'faster');
  assert.equal(Math.round(request.deltaMs), -150);
});

test('same request and status with a different response body fails comparison', () => {
  const store = new NetworkWatchStore();
  addRequest(store, { id: 'baseline', wallTime: 7000.2, url: 'https://example.test/api/profile', responseBodyHash: 'body-a' });
  store.addRecording(recording('REC-body-change', 7_000_000, [
    { id: 'ACT-profile', type: 'click', selector: '#profile', timestamp: 7_000_000, delayMs: 0 },
  ]));
  const job = store.createReplayJob('REC-body-change');
  store.claimReplayJob();
  addRequest(store, { id: 'replay', wallTime: 8000.2, url: 'https://example.test/api/profile', responseBodyHash: 'body-b' });
  store.addRecording(recording(job.runId, 8_000_000, [
    { id: 'ACT-profile-replay', sourceActionId: 'ACT-profile', type: 'click', selector: '#profile', timestamp: 8_000_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-body-change' }));

  const comparison = store.getReplayJob(job.runId).comparison;
  assert.equal(comparison.summary.requestsMatch, false);
  assert.equal(comparison.summary.responseChangedRequestCount, 1);
  assert.equal(comparison.events[0].requests.matched[0].responseSame, false);
  assert.equal(comparison.events[0].requests.matched[0].responseMessage, 'A different response was received.');
});

test('request hierarchy accepts a recorded request triggered during an earlier replay action', () => {
  const store = new NetworkWatchStore();
  addRequest(store, { id: 'baseline-first', wallTime: 9000.2, url: 'https://example.test/api/first' });
  addRequest(store, { id: 'baseline-second', wallTime: 9001.2, url: 'https://example.test/api/second' });
  store.addRecording(recording('REC-hierarchy', 9_000_000, [
    { id: 'ACT-first', type: 'click', selector: '#first', timestamp: 9_000_000, delayMs: 0 },
    { id: 'ACT-second', type: 'click', selector: '#second', timestamp: 9_001_000, delayMs: 0 },
  ]));
  const job = store.createReplayJob('REC-hierarchy');
  store.claimReplayJob();
  addRequest(store, { id: 'replay-first', wallTime: 10000.2, url: 'https://example.test/api/first' });
  addRequest(store, { id: 'replay-second-early', wallTime: 10000.5, url: 'https://example.test/api/second' });
  store.addRecording(recording(job.runId, 10_000_000, [
    { id: 'ACT-first-replay', sourceActionId: 'ACT-first', type: 'click', selector: '#first', timestamp: 10_000_000, delayMs: 0, outcome: 'success' },
    { id: 'ACT-second-replay', sourceActionId: 'ACT-second', type: 'click', selector: '#second', timestamp: 10_001_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-hierarchy' }));

  const comparison = store.getReplayJob(job.runId).comparison;
  const hierarchyMatch = comparison.events[1].requests.matched[0];
  assert.equal(comparison.summary.requestsMatch, true);
  assert.equal(comparison.summary.hierarchyAcceptedRequestCount, 1);
  assert.equal(comparison.summary.missingRequestCount, 0);
  assert.equal(comparison.summary.unexpectedRequestCount, 0);
  assert.equal(hierarchyMatch.hierarchyAccepted, true);
  assert.equal(hierarchyMatch.baselineActionSequence, 2);
  assert.equal(hierarchyMatch.replayActionSequence, 1);
  assert.match(hierarchyMatch.hierarchyMessage, /occurrence 1 across action windows: recorded action 2, replay action 1/);
});

test('request hierarchy accepts a request in a later replay action window', () => {
  const store = new NetworkWatchStore();
  addRequest(store, { id: 'baseline-early', wallTime: 11000.2, url: 'https://example.test/api/required-early' });
  store.addRecording(recording('REC-late-request', 11_000_000, [
    { id: 'ACT-first', type: 'click', selector: '#first', timestamp: 11_000_000, delayMs: 0 },
    { id: 'ACT-second', type: 'click', selector: '#second', timestamp: 11_001_000, delayMs: 0 },
  ]));
  const job = store.createReplayJob('REC-late-request');
  store.claimReplayJob();
  addRequest(store, { id: 'replay-late', wallTime: 12001.2, url: 'https://example.test/api/required-early' });
  store.addRecording(recording(job.runId, 12_000_000, [
    { id: 'ACT-first-replay', sourceActionId: 'ACT-first', type: 'click', selector: '#first', timestamp: 12_000_000, delayMs: 0, outcome: 'success' },
    { id: 'ACT-second-replay', sourceActionId: 'ACT-second', type: 'click', selector: '#second', timestamp: 12_001_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-late-request' }));

  const summary = store.getReplayJob(job.runId).comparison.summary;
  assert.equal(summary.requestsMatch, true);
  assert.equal(summary.hierarchyAcceptedRequestCount, 1);
  assert.equal(summary.missingRequestCount, 0);
  assert.equal(summary.unexpectedRequestCount, 0);
});

test('request hierarchy compares repeated requests by occurrence across the whole journey', () => {
  const store = new NetworkWatchStore();
  const requestA = 'https://example.test/api/a';
  const requestB = 'https://example.test/api/b';
  addRequest(store, { id: 'baseline-a-1', wallTime: 15000.2, url: requestA, responseBodyHash: 'a-first' });
  addRequest(store, { id: 'baseline-b-1', wallTime: 15000.4, url: requestB, responseBodyHash: 'b-first' });
  addRequest(store, { id: 'baseline-a-2', wallTime: 15001.2, url: requestA, responseBodyHash: 'a-second' });
  store.addRecording(recording('REC-occurrences', 15_000_000, [
    { id: 'ACT-one', type: 'click', selector: '#one', timestamp: 15_000_000, delayMs: 0 },
    { id: 'ACT-two', type: 'click', selector: '#two', timestamp: 15_001_000, delayMs: 0 },
  ]));
  const job = store.createReplayJob('REC-occurrences');
  store.claimReplayJob();
  addRequest(store, { id: 'replay-a-1', wallTime: 16000.2, url: requestA, responseBodyHash: 'a-first' });
  addRequest(store, { id: 'replay-a-2', wallTime: 16001.2, url: requestA, responseBodyHash: 'a-second' });
  addRequest(store, { id: 'replay-b-1', wallTime: 16001.4, url: requestB, responseBodyHash: 'b-first' });
  store.addRecording(recording(job.runId, 16_000_000, [
    { id: 'ACT-one-replay', sourceActionId: 'ACT-one', type: 'click', selector: '#one', timestamp: 16_000_000, delayMs: 0, outcome: 'success' },
    { id: 'ACT-two-replay', sourceActionId: 'ACT-two', type: 'click', selector: '#two', timestamp: 16_001_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-occurrences' }));

  const comparison = store.getReplayJob(job.runId).comparison;
  const matches = comparison.events.flatMap(event => event.requests.matched);
  const secondA = matches.find(request => request.url === requestA && request.requestOccurrence === 2);
  const firstB = matches.find(request => request.url === requestB && request.requestOccurrence === 1);
  assert.equal(comparison.summary.requestsMatch, true);
  assert.equal(comparison.summary.matchedRequestCount, 3);
  assert.equal(comparison.summary.reorderedRequestCount, 0);
  assert.equal(secondA.baselineRequestId, 'baseline-a-2');
  assert.equal(secondA.replayRequestId, 'replay-a-2');
  assert.equal(secondA.responseSame, true);
  assert.equal(firstB.baselineRequestId, 'baseline-b-1');
  assert.equal(firstB.replayRequestId, 'replay-b-1');
  assert.equal(firstB.hierarchyAccepted, true);
});

test('late response hashes automatically refresh replay comparison and stay out of exports', () => {
  const store = new NetworkWatchStore();
  const customerUrl = 'https://api-quality.pixartprinting.net/admin-portal/backend/api/v1/customer/fetch';
  addRequest(store, { id: 'baseline-customer', wallTime: 13000.2, url: customerUrl });
  store.addRecording(recording('REC-customer-fetch', 13_000_000, [
    { id: 'ACT-customer', type: 'click', selector: '#customer', timestamp: 13_000_000, delayMs: 0 },
  ]));

  // Chrome can return the body after the recording has already been persisted.
  store.addNetworkEvent({ type: 'response-body-hash', requestId: 'baseline-customer', responseBodyHash: 'identical-customer-response' });
  const job = store.createReplayJob('REC-customer-fetch');
  store.claimReplayJob();
  addRequest(store, { id: 'replay-customer', wallTime: 14000.2, url: customerUrl, durationMs: 80 });
  store.addRecording(recording(job.runId, 14_000_000, [
    { id: 'ACT-customer-replay', sourceActionId: 'ACT-customer', type: 'click', selector: '#customer', timestamp: 14_000_000, delayMs: 0, outcome: 'success' },
  ], { kind: 'replay', sourceRecordingId: 'REC-customer-fetch' }));
  store.addNetworkEvent({ type: 'response-body-hash', requestId: 'replay-customer', responseBodyHash: 'identical-customer-response' });

  const completed = store.getReplayJob(job.runId);
  assert.equal(completed.comparison.events[0].requests.matched[0].responseSame, true);
  assert.equal(completed.comparison.events[0].requests.matched[0].responseComparisonBasis, 'body-hash');
  assert.doesNotMatch(JSON.stringify(completed), /identical-customer-response|responseBodyHash/);
  assert.doesNotMatch(JSON.stringify(store.getPublicRecording('REC-customer-fetch')), /identical-customer-response|responseBodyHash/);
  assert.doesNotMatch(store.exportRecording({ recordingId: 'REC-customer-fetch', runId: job.runId, format: 'json' }).content, /identical-customer-response|responseBodyHash/);
  assert.doesNotMatch(store.exportNetwork('json').content, /identical-customer-response|responseBodyHash/);
});
