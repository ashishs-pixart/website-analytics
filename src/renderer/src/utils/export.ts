import type { NetworkRequest } from '../types';
import { requestDuration } from './format';

export type ExportField = 'time' | 'payload' | 'headers' | 'request' | 'response';

export const EXPORT_FIELDS: Array<{ id: ExportField; label: string; description: string }> = [
  { id: 'time', label: 'Time to receive response', description: 'Total duration from request start to completion.' },
  { id: 'payload', label: 'Payload', description: 'The request body sent to the server.' },
  { id: 'headers', label: 'Headers', description: 'Request and response headers.' },
  { id: 'request', label: 'Request', description: 'URL, method, type, and start time.' },
  { id: 'response', label: 'Response', description: 'Status, content details, and response body.' },
];

function mergedRequestHeaders(request: NetworkRequest) {
  return { ...request.requestHeaders, ...request.requestExtraHeaders };
}

function mergedResponseHeaders(request: NetworkRequest) {
  return { ...request.responseHeaders, ...request.responseExtraHeaders };
}

function itemName(request: NetworkRequest) {
  try {
    const url = new URL(request.url);
    return `${request.method || 'GET'} ${url.pathname || '/'}`;
  } catch {
    return `${request.method || 'GET'} ${request.url || 'Request'}`;
  }
}

function postmanBody(request: NetworkRequest) {
  if (!request.postData) return undefined;
  let language: 'json' | 'text' = 'text';
  try {
    JSON.parse(request.postData);
    language = 'json';
  } catch {
    // Keep non-JSON bodies as plain text.
  }
  return { mode: 'raw', raw: request.postData, options: { raw: { language } } };
}

export function makePostmanCollection(requests: NetworkRequest[]) {
  return {
    info: {
      name: `Network Inspector export ${new Date().toLocaleString()}`,
      description: 'Requests captured by Network Inspector.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: requests.map((request) => ({
      name: itemName(request),
      request: {
        method: request.method || 'GET',
        header: Object.entries(mergedRequestHeaders(request)).map(([key, value]) => ({ key, value: String(value), type: 'text' })),
        body: postmanBody(request),
        url: request.url,
        description: `Captured ${request.resourceType || 'network'} request`,
      },
    })),
  };
}

export function makeSelectedFieldsExport(requests: NetworkRequest[], selectedFields: Set<ExportField>) {
  return {
    exportedAt: new Date().toISOString(),
    source: 'Network Inspector',
    fields: EXPORT_FIELDS.filter((field) => selectedFields.has(field.id)).map((field) => field.id),
    requests: requests.map((request) => {
      const exported: Record<string, unknown> = {};

      if (selectedFields.has('time')) exported.timeToReceiveResponseMs = requestDuration(request);
      if (selectedFields.has('payload')) exported.payload = request.postData;
      if (selectedFields.has('headers')) {
        exported.headers = {
          request: mergedRequestHeaders(request),
          response: mergedResponseHeaders(request),
        };
      }
      if (selectedFields.has('request')) {
        exported.request = {
          id: request.id,
          method: request.method || 'GET',
          url: request.url,
          resourceType: request.resourceType,
          startedAt: request.wallTime ? new Date(request.wallTime * 1000).toISOString() : null,
        };
      }
      if (selectedFields.has('response')) {
        exported.response = {
          status: request.status,
          statusText: request.statusText,
          mimeType: request.mimeType,
          protocol: request.protocol,
          body: request.bodyCache,
          bodyBase64Encoded: request.bodyBase64,
          transferredBytes: request.encodedDataLength,
          failed: request.failed,
          error: request.errorText || null,
        };
      }

      return exported;
    }),
  };
}
