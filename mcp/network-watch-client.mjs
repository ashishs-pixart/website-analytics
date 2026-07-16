const DEFAULT_BASE_URL = 'http://127.0.0.1:9231';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class NetworkWatchClient {
  constructor(baseUrl = process.env.NETWORK_WATCH_URL || DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch (error) {
      throw new Error(`Network Watch is not available at ${this.baseUrl}. Start the desktop app and reload the Chrome extension. ${error.message}`);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `Network Watch returned HTTP ${response.status}.`);
    return body;
  }

  listRecordings({ limit = 20, cursor = null } = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return this.request(`/api/recordings?${query}`);
  }

  getRecording(recordingId) {
    return this.request(`/api/recordings/${encodeURIComponent(recordingId)}`);
  }

  async replayRecording({ recordingId, timeoutMs = 120000, idempotencyKey = null }) {
    const created = await this.request('/api/replay-jobs', {
      method: 'POST',
      body: JSON.stringify({ recordingId, idempotencyKey }),
    });
    const runId = created.job.runId;
    const deadline = Date.now() + Math.max(1000, Math.min(600000, timeoutMs));
    let job = created.job;
    while (Date.now() < deadline && !['completed', 'failed'].includes(job.status)) {
      await sleep(1000);
      job = (await this.getReplayResult(runId)).job;
    }
    return job;
  }

  getReplayResult(runId) {
    return this.request(`/api/replay-jobs/${encodeURIComponent(runId)}`);
  }

  exportRecording({ recordingId, runId = null, format = 'markdown' }) {
    const query = new URLSearchParams({ recordingId, format });
    if (runId) query.set('runId', runId);
    return this.request(`/api/export/recording?${query}`);
  }

  exportNetwork(format = 'json') {
    return this.request(`/api/export/network?format=${encodeURIComponent(format)}`);
  }
}
