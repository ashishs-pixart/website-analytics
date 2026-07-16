export type StatusCode = number | 'ERR' | null;

export type ToastState = { message: string; id: number } | null;

export type Target = {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
};

export type NetworkRequest = {
  id: string;
  method: string;
  url: string;
  status: StatusCode;
  statusText: string;
  resourceType: string;
  requestHeaders: Record<string, unknown>;
  responseHeaders: Record<string, unknown>;
  requestExtraHeaders: Record<string, unknown>;
  responseExtraHeaders: Record<string, unknown>;
  postData: string | null;
  mimeType: string;
  protocol: string;
  fromCache: boolean;
  encodedDataLength: number;
  startedAt: number | null;
  finishedAt: number | null;
  wallTime?: number;
  failed: boolean;
  errorText: string;
  timing: Record<string, number> | null;
  initiator: unknown;
  wsFrames: Array<{
    direction: 'sent' | 'received';
    timestamp: number;
    opcode: number;
    payload: string;
  }>;
  bodyCache: string | null;
  bodyBase64: boolean;
  remoteIPAddress?: string;
  remotePort?: number;
  headersText?: string;
};

export type NetworkEvent = {
  type:
    | 'request'
    | 'request-extra'
    | 'response'
    | 'response-extra'
    | 'finished'
    | 'failed'
    | 'ws-created'
    | 'ws-sent'
    | 'ws-received';
  requestId: string;
  [key: string]: any;
};

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error?: string; canceled?: boolean };

export type StartBrowserResult = {
  browser: string;
  executablePath: string;
  host: string;
  port: number;
};

export type CdpApi = {
  listTargets: (opts: { host: string; port: number }) => Promise<ApiResult<{ targets: Target[] }>>;
  attachTarget: (opts: { host: string; port: number; targetId: string }) => Promise<ApiResult<Record<string, never>>>;
  getResponseBody: (opts: { requestId: string }) => Promise<ApiResult<{ body: string; base64Encoded: boolean }>>;
  saveFile: (opts: { defaultPath: string; content: string }) => Promise<ApiResult<{ path: string }>>;
  startBrowserDebug: (opts: { port: number }) => Promise<ApiResult<StartBrowserResult>>;
  detach: () => Promise<ApiResult<Record<string, never>>>;
  onNetworkEvent: (callback: (event: NetworkEvent) => void) => void;
  onTargetDisconnected: (callback: (event: { targetId: string | null }) => void) => void;
  onExportHar: (callback: () => void) => void;
  onShowHelp: (callback: () => void) => void;
  removeAllListeners: () => void;
};
