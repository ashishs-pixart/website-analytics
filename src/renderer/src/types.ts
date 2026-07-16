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

export type ElementMetadata = {
  selector: string;
  tagName: string;
  id?: string;
  classList: string[];
  text?: string;
  html: string;
  cssRules: string[];
  computedStyles: Record<string, string>;
};

export type ExtensionScreenshot = {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  url: string;
  title: string;
  capturedAt: string;
  fullPage?: boolean;
  contentWidth?: number;
  contentHeight?: number;
  element: ElementMetadata | null;
};

export type RecordedAction = {
  id: string;
  sourceActionId?: string;
  frameId?: number;
  type: 'click' | 'input' | 'change' | 'keypress';
  selector: string;
  timestamp: number;
  delayMs: number;
  tagName?: string;
  text?: string;
  href?: string;
  value?: string;
  key?: string;
  code?: string;
  source?: string;
  checked?: boolean;
  pageUrl?: string;
};

export type ExtensionRecording = {
  id: string;
  kind?: 'recording' | 'replay';
  sourceRecordingId?: string;
  url: string;
  title: string;
  startedAt: string;
  stoppedAt: string;
  actions: RecordedAction[];
};

export type ExtensionState = {
  screenshots: ExtensionScreenshot[];
  recordings: ExtensionRecording[];
  lastExtensionActivity: string | null;
  connected: boolean;
  bridgePort: number;
};

export type CdpApi = {
  listTargets: (opts: { host: string; port: number }) => Promise<ApiResult<{ targets: Target[] }>>;
  attachTarget: (opts: { host: string; port: number; targetId: string }) => Promise<ApiResult<Record<string, never>>>;
  getResponseBody: (opts: { requestId: string }) => Promise<ApiResult<{ body: string; base64Encoded: boolean }>>;
  saveFile: (opts: { defaultPath: string; content: string }) => Promise<ApiResult<{ path: string }>>;
  startBrowserDebug: (opts: { port: number }) => Promise<ApiResult<StartBrowserResult>>;
  getExtensionData: () => Promise<ApiResult<{ state: ExtensionState }>>;
  clearExtensionData: () => Promise<ApiResult<{ state: ExtensionState }>>;
  detach: () => Promise<ApiResult<Record<string, never>>>;
  onNetworkEvent: (callback: (event: NetworkEvent) => void) => void;
  onTargetDisconnected: (callback: (event: { targetId: string | null }) => void) => void;
  onExportRequests: (callback: () => void) => void;
  onShowHelp: (callback: () => void) => void;
  removeAllListeners: () => void;
};
