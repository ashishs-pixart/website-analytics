import type { NetworkRequest } from '../types';
import { requestDuration } from './format';

export function makeHar(order: string[], requests: Map<string, NetworkRequest>) {
  const entries = order
    .map((id) => requests.get(id))
    .filter(Boolean)
    .map((req) => {
      const request = req as NetworkRequest;
      const started = request.wallTime ? new Date(request.wallTime * 1000).toISOString() : new Date().toISOString();
      const requestHeaders = Object.entries({ ...request.requestHeaders, ...request.requestExtraHeaders }).map(([name, value]) => ({ name, value: String(value) }));
      const responseHeaders = Object.entries({ ...request.responseHeaders, ...request.responseExtraHeaders }).map(([name, value]) => ({ name, value: String(value) }));
      let urlObj: URL | null = null;
      try {
        urlObj = new URL(request.url);
      } catch {
        urlObj = null;
      }

      return {
        startedDateTime: started,
        time: requestDuration(request) || 0,
        request: {
          method: request.method || 'GET',
          url: request.url || '',
          httpVersion: request.protocol || 'HTTP/1.1',
          cookies: [],
          headers: requestHeaders,
          queryString: urlObj ? Array.from(urlObj.searchParams.entries()).map(([name, value]) => ({ name, value })) : [],
          headersSize: -1,
          bodySize: request.postData ? request.postData.length : 0,
          postData: request.postData
            ? { mimeType: String(request.requestHeaders['content-type'] || request.requestHeaders['Content-Type'] || ''), text: request.postData }
            : undefined,
        },
        response: {
          status: typeof request.status === 'number' ? request.status : 0,
          statusText: request.statusText || request.errorText || '',
          httpVersion: request.protocol || 'HTTP/1.1',
          cookies: [],
          headers: responseHeaders,
          content: {
            size: request.bodyCache ? request.bodyCache.length : request.encodedDataLength || 0,
            mimeType: request.mimeType || '',
            text: request.bodyCache || undefined,
            encoding: request.bodyBase64 ? 'base64' : undefined,
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: request.encodedDataLength || 0,
        },
        cache: {},
        timings: { send: -1, wait: -1, receive: -1 },
        serverIPAddress: request.remoteIPAddress,
        connection: request.remotePort ? String(request.remotePort) : undefined,
        _resourceType: request.resourceType,
      };
    });

  return { log: { version: '1.2', creator: { name: 'Network Inspector', version: '1.0.0' }, pages: [], entries } };
}
