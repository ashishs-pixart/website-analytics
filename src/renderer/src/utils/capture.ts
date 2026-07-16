import type { NetworkEvent, NetworkRequest } from '../types';

export type CaptureState = { requests: Map<string, NetworkRequest>; order: string[] };

export type CaptureAction =
  | { type: 'event'; event: NetworkEvent }
  | { type: 'clear' }
  | { type: 'body'; requestId: string; body: string; base64Encoded: boolean };

export function createRequest(id: string): NetworkRequest {
  return {
    id,
    method: '',
    url: '',
    status: null,
    statusText: '',
    resourceType: 'Other',
    requestHeaders: {},
    responseHeaders: {},
    requestExtraHeaders: {},
    responseExtraHeaders: {},
    postData: null,
    mimeType: '',
    protocol: '',
    fromCache: false,
    encodedDataLength: 0,
    startedAt: null,
    finishedAt: null,
    failed: false,
    errorText: '',
    timing: null,
    initiator: null,
    wsFrames: [],
    bodyCache: null,
    bodyBase64: false,
  };
}

export function applyEventToRequest(current: NetworkRequest, event: NetworkEvent): NetworkRequest {
  const req = { ...current, wsFrames: [...current.wsFrames] };

  if (event.type === 'request') {
    req.method = event.method;
    req.url = event.url;
    req.resourceType = event.resourceType || req.resourceType;
    req.requestHeaders = event.headers || {};
    req.postData = event.postData || null;
    req.startedAt = event.timestamp ?? req.startedAt;
    req.wallTime = event.wallTime;
    req.initiator = event.initiator || null;
  } else if (event.type === 'request-extra') {
    req.requestExtraHeaders = event.headers || {};
  } else if (event.type === 'response') {
    req.status = event.status;
    req.statusText = event.statusText;
    req.responseHeaders = event.headers || {};
    req.mimeType = event.mimeType || '';
    req.protocol = event.protocol || '';
    req.fromCache = event.fromCache;
    req.remoteIPAddress = event.remoteIPAddress;
    req.remotePort = event.remotePort;
    req.timing = event.timing;
    req.resourceType = event.resourceType || req.resourceType;
  } else if (event.type === 'response-extra') {
    req.responseExtraHeaders = event.headers || {};
    if (!req.status && event.statusCode) req.status = event.statusCode;
    req.headersText = event.headersText;
  } else if (event.type === 'finished') {
    req.finishedAt = event.timestamp;
    req.encodedDataLength = event.encodedDataLength || 0;
  } else if (event.type === 'failed') {
    req.finishedAt = event.timestamp;
    req.failed = true;
    req.status = 'ERR';
    req.errorText = event.errorText || event.blockedReason || 'Failed';
  } else if (event.type === 'ws-created') {
    req.url = event.url;
    req.method = 'WS';
    req.resourceType = 'WebSocket';
    req.initiator = event.initiator || null;
  } else if (event.type === 'ws-sent' || event.type === 'ws-received') {
    req.resourceType = 'WebSocket';
    req.wsFrames.push({
      direction: event.type === 'ws-sent' ? 'sent' : 'received',
      timestamp: event.timestamp,
      opcode: event.opcode,
      payload: event.payload,
    });
  }

  return req;
}

export function captureReducer(state: CaptureState, action: CaptureAction): CaptureState {
  if (action.type === 'clear') {
    return { requests: new Map(), order: [] };
  }

  if (action.type === 'body') {
    const req = state.requests.get(action.requestId);
    if (!req) return state;
    const requests = new Map(state.requests);
    requests.set(action.requestId, { ...req, bodyCache: action.body, bodyBase64: action.base64Encoded });
    return { ...state, requests };
  }

  const { event } = action;
  const existed = state.requests.has(event.requestId);
  const requests = new Map(state.requests);
  requests.set(event.requestId, applyEventToRequest(requests.get(event.requestId) || createRequest(event.requestId), event));
  const order = existed || state.order.includes(event.requestId) ? state.order : [...state.order, event.requestId];
  return { requests, order };
}
