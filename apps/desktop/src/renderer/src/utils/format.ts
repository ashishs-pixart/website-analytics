import { MAX_TARGET_LABEL_LENGTH } from '../constants';
import type { NetworkRequest, StatusCode } from '../types';

export function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export function formatMs(ms: number | null) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function statusClass(code: StatusCode) {
  if (!code) return 'status-pending';
  if (code === 'ERR') return 'status-error';
  if (code < 300) return 'status-2xx';
  if (code < 400) return 'status-3xx';
  if (code < 500) return 'status-4xx';
  return 'status-5xx';
}

export function methodClass(method = '') {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method) ? `method-${method}` : 'method-OTHER';
}

export function tryPrettyJson(text: string | null) {
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function parseUrlParts(url: string) {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname + parsed.search + parsed.hash };
  } catch {
    return { host: '', path: url || '' };
  }
}

export function truncateLabel(value: string, maxLength = MAX_TARGET_LABEL_LENGTH) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

export function requestDuration(req: NetworkRequest) {
  if (req.startedAt == null || req.finishedAt == null) return null;
  return (req.finishedAt - req.startedAt) * 1000;
}
