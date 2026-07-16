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
    | 'response-body-hash'
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
  extensionPath: string | null;
  extensionLoaded: boolean;
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
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    pageX: number;
    pageY: number;
    viewportWidth: number;
    viewportHeight: number;
    visible: boolean;
  };
};

export type ExtensionScreenshot = {
  id: string;
  dataUrl: string;
  mimeType?: string;
  byteSize?: number;
  width: number;
  height: number;
  url: string;
  title: string;
  capturedAt: string;
  fullPage?: boolean;
  contentWidth?: number;
  contentHeight?: number;
  element: ElementMetadata | null;
  elements?: ElementMetadata[];
};

export type RecordedAction = {
  id: string;
  sourceActionId?: string;
  frameId?: number;
  type: 'click' | 'input' | 'change' | 'keypress' | 'scroll';
  selector: string;
  timestamp: number;
  delayMs: number;
  tagName?: string;
  text?: string;
  href?: string;
  value?: string;
  key?: string;
  code?: string;
  location?: number;
  repeat?: boolean;
  isComposing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  form?: { action: string; method: string };
  source?: string;
  locator?: {
    selector?: string;
    tagName?: string;
    id?: string;
    originalId?: string;
    testId?: string;
    name?: string;
    role?: string;
    accessibleName?: string;
    ariaLabel?: string;
    placeholder?: string;
    alt?: string;
    title?: string;
    inputType?: string;
    autocomplete?: string;
    label?: string;
    classList?: string[];
    ancestorSignature?: string;
    hierarchyPath?: Array<{
      tagName: string;
      nthOfType: number;
    }>;
    shadowPath?: Array<Array<{
      tagName: string;
      nthOfType: number;
    }>>;
    previousSiblingText?: string;
    nextSiblingText?: string;
    parentText?: string;
    roleIndex?: { role: string; index: number; total: number } | null;
    landmark?: { tagName: string; role: string; accessibleName: string } | null;
    heading?: { text: string; level: number | null } | null;
    form?: { action: string; method: string; name: string; id: string; accessibleName: string } | null;
    visualFingerprint?: {
      width: number;
      height: number;
      fontSize: string;
      color: string;
      backgroundColor: string;
      display: string;
    };
    xpath?: string;
    frameChain?: Array<{
      url: string;
      isTop: boolean;
      frameName?: string;
      frameTitle?: string;
      hierarchyPath?: Array<{ tagName: string; nthOfType: number }>;
    }>;
    semanticFingerprint?: {
      role?: string;
      name?: string;
      heading?: string;
      form?: string;
      parent?: string;
      landmark?: string;
    };
    domHierarchy?: Array<{
      tagName: string;
      id?: string;
      originalId?: string;
      testId?: string;
      name?: string;
      role?: string;
      ariaLabel?: string;
      classList: string[];
      nthOfType: number;
    }>;
    href?: string;
    text?: string;
  };
  inputType?: string;
  checked?: boolean;
  pageUrl?: string;
  startUrl?: string;
  frameUrl?: string;
  expectedUrl?: string;
  expectedResultUrl?: string | null;
  resultUrl?: string;
  urlChanged?: boolean;
  urlCorrection?: {
    fromUrl: string;
    toUrl: string;
    succeeded: boolean;
    error?: string;
  } | null;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollX?: number;
  scrollY?: number;
  outcome?: 'success' | 'failed';
  replayError?: string;
  executionMethod?: 'cdp-trusted-click' | 'dom-click-fallback' | 'cdp-trusted-key' | 'dom-key-event-fallback' | 'scroll' | 'input-value' | 'dom-key-event';
  executionWarning?: string;
  resolutionMethod?: string;
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
  summary?: {
    successfulActions: number;
    failedActions: number;
    totalActions: number;
  };
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
  selectCopilotDirectory: () => Promise<ApiResult<{ directory: string }>>;
  startCopilot: (opts: { prompt: string; directory: string; continueSession?: boolean }) => Promise<ApiResult<{ directory: string }>>;
  stopCopilot: () => Promise<ApiResult<Record<string, never>>>;
  startBrowserDebug: (opts: { port: number }) => Promise<ApiResult<StartBrowserResult>>;
  getExtensionData: () => Promise<ApiResult<{ state: ExtensionState }>>;
  clearExtensionData: () => Promise<ApiResult<{ state: ExtensionState }>>;
  detach: () => Promise<ApiResult<Record<string, never>>>;
  onNetworkEvent: (callback: (event: NetworkEvent) => void) => void;
  onTargetDisconnected: (callback: (event: { targetId: string | null }) => void) => void;
  onExportRequests: (callback: () => void) => void;
  onShowHelp: (callback: () => void) => void;
  onCopilotEvent: (callback: (event: CopilotEvent) => void) => () => void;
  removeAllListeners: () => void;
};

export type CopilotEvent =
  | { kind: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'error'; error: string }
  | { kind: 'exit'; code: number | null; signal: string | null };
