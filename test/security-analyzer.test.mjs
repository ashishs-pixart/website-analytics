import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRequestSecurity } from '../apps/desktop/src/renderer/src/utils/security.ts';

function request(overrides = {}) {
  return {
    id: 'request-1', method: 'GET', url: 'https://example.test/api/customer', status: 200,
    statusText: 'OK', resourceType: 'Fetch', requestHeaders: {}, responseHeaders: {},
    requestExtraHeaders: {}, responseExtraHeaders: {}, postData: null, mimeType: 'application/json',
    protocol: 'h2', fromCache: false, encodedDataLength: 100, startedAt: 1, finishedAt: 2,
    failed: false, errorText: '', timing: null, initiator: null, wsFrames: [], bodyCache: null,
    bodyBase64: false, ...overrides,
  };
}

test('security analyzer gives hardened API responses a good passive rating', () => {
  const analysis = analyzeRequestSecurity(request({
    responseHeaders: {
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
    bodyCache: JSON.stringify({ displayName: 'Example' }),
  }));
  assert.equal(analysis.rating, 'good');
  assert.equal(analysis.score, 100);
  assert.deepEqual(analysis.findings, []);
});

test('security analyzer identifies unencrypted wildcard API responses', () => {
  const analysis = analyzeRequestSecurity(request({
    url: 'http://api.example.test/customer',
    responseHeaders: { 'access-control-allow-origin': '*' },
  }));
  assert.equal(analysis.rating, 'critical');
  assert.ok(analysis.findings.some(finding => finding.id === 'transport'));
  assert.ok(analysis.findings.some(finding => finding.id === 'cors-wildcard'));
});

test('security analyzer reports sensitive field paths without response values', () => {
  const analysis = analyzeRequestSecurity(request({
    responseHeaders: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
    bodyCache: JSON.stringify({ account: { access_token: 'do-not-display', email: 'private@example.test' } }),
  }));
  const exported = JSON.stringify(analysis);
  assert.equal(analysis.rating, 'critical');
  assert.match(exported, /account\.access_token/);
  assert.match(exported, /account\.email/);
  assert.doesNotMatch(exported, /do-not-display|private@example\.test/);
  assert.ok(analysis.findings.some(finding => finding.id === 'sensitive-cache'));
  assert.ok(analysis.findings.every(finding => finding.impact && finding.recommendation && finding.standard));
});

test('document checks include CSP and frame protection', () => {
  const analysis = analyzeRequestSecurity(request({ resourceType: 'Document', mimeType: 'text/html' }));
  assert.ok(analysis.findings.some(finding => finding.id === 'csp'));
  assert.ok(analysis.findings.some(finding => finding.id === 'framing'));
  assert.ok(analysis.findings.some(finding => finding.id === 'hsts'));
});
