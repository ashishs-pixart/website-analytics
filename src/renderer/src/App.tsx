import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FilterBar } from './components/FilterBar';
import { ExportModal, type ExportFormat } from './components/ExportModal';
import { HelpModal } from './components/HelpModal';
import { InspectDashboard } from './components/InspectDashboard';
import { InspectExportModal } from './components/InspectExportModal';
import { CopilotSidebar } from './components/CopilotSidebar';
import { ModeBar, type AppMode } from './components/ModeBar';
import { RequestDetails } from './components/RequestDetails';
import { RequestTable } from './components/RequestTable';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import type { DetailTab, StatusKind } from './constants';
import type { ExtensionState, NetworkRequest, Target, ToastState } from './types';
import { captureReducer } from './utils/capture';
import { formatBytes } from './utils/format';
import { makePostmanCollection, makeSelectedFieldsExport, type ExportField } from './utils/export';
import { elementFeedbackId, makeInspectPrompt } from './utils/inspectExport';

const EMPTY_EXTENSION_STATE: ExtensionState = {
  screenshots: [],
  recordings: [],
  lastExtensionActivity: null,
  connected: false,
  bridgePort: 9231,
};

export function App() {
  const [mode, setMode] = useState<AppMode>('network');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(9222);
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [{ requests, order }, dispatchCapture] = useReducer(captureReducer, { requests: new Map(), order: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [launchingBrowser, setLaunchingBrowser] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<{ kind: StatusKind; text: string }>({ kind: 'idle', text: 'Idle' });
  const [currentTargetLabel, setCurrentTargetLabel] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('headers');
  const [detailWidth, setDetailWidth] = useState('43%');
  const [showExport, setShowExport] = useState(false);
  const [showInspectExport, setShowInspectExport] = useState(false);
  const [inspectPromptTarget, setInspectPromptTarget] = useState<'export' | 'copilot'>('export');
  const [includeMeaningfulRequests, setIncludeMeaningfulRequests] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [copilotSession, setCopilotSession] = useState({ directory: '', output: '', running: false, stopping: false });
  const [copilotChatDraft, setCopilotChatDraft] = useState('');
  const [extensionState, setExtensionState] = useState<ExtensionState>(EMPTY_EXTENSION_STATE);
  const [screenshotFeedback, setScreenshotFeedback] = useState<Record<string, string>>({});
  const [actionFeedback, setActionFeedback] = useState<Record<string, string>>({});
  const [elementFeedback, setElementFeedback] = useState<Record<string, string>>({});
  const exportRef = useRef(() => {});

  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ message, id });
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), 2500);
  }, []);

  const totalBytes = useMemo(() => Array.from(requests.values()).reduce((sum, req) => sum + (req.encodedDataLength || 0), 0), [requests]);
  const allRequests = useMemo(() => order.map((id) => requests.get(id)).filter((request): request is NetworkRequest => Boolean(request)), [order, requests]);
  const selectedRequest = selectedId ? requests.get(selectedId) : undefined;

  const filteredRequests = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return order
      .map((id) => requests.get(id))
      .filter((req): req is NetworkRequest => Boolean(req))
      .filter((req) => {
        if (filterType !== 'all' && req.resourceType !== filterType) return false;
        if (errorsOnly && !(req.failed || (typeof req.status === 'number' && req.status >= 400))) return false;
        if (!query) return true;
        return [req.url, req.method, req.status, req.resourceType, req.mimeType].some((value) => String(value ?? '').toLowerCase().includes(query));
      });
  }, [errorsOnly, filterText, filterType, order, requests]);

  const scanTargets = useCallback(async () => {
    setScanning(true);
    setTargets([]);
    setSelectedTarget('');
    setStatus({ kind: 'idle', text: 'Scanning' });
    try {
      const result = await window.cdp.listTargets({ host: host.trim() || 'localhost', port });
      if (!result.ok) {
        setStatus({ kind: 'error', text: 'No browser' });
        showToast(`Could not connect to ${host}:${port}. Open help for launch flags.`);
        setShowHelp(true);
        return;
      }
      setTargets(result.targets);
      setSelectedTarget(result.targets[0]?.id || '');
      setStatus({ kind: 'idle', text: result.targets.length ? 'Ready' : 'Idle' });
      showToast(result.targets.length ? `Found ${result.targets.length} tab${result.targets.length === 1 ? '' : 's'}` : 'Connected, but no page tabs were available.');
    } finally {
      setScanning(false);
    }
  }, [host, port, showToast]);

  const startBrowser = useCallback(async () => {
    setLaunchingBrowser(true);
    setStatus({ kind: 'idle', text: 'Starting browser' });

    try {
      const result = await window.cdp.startBrowserDebug({ port });
      if (!result.ok) {
        setStatus({ kind: result.canceled ? 'idle' : 'error', text: result.canceled ? 'Idle' : 'Launch failed' });
        if (!result.canceled) showToast(result.error || 'Could not start browser');
        return;
      }

      setHost(result.host);
      setPort(result.port);
      setStatus({ kind: 'idle', text: 'Browser started' });
      showToast(`Started ${result.browser}: ${result.executablePath}`);
    } finally {
      setLaunchingBrowser(false);
    }
  }, [port, showToast]);

  const attachSelected = useCallback(async () => {
    if (!selectedTarget) return;
    const result = await window.cdp.attachTarget({ host: host.trim() || 'localhost', port, targetId: selectedTarget });
    if (!result.ok) {
      setStatus({ kind: 'error', text: 'Attach failed' });
      showToast(result.error || 'Could not attach');
      return;
    }
    const target = targets.find((item) => item.id === selectedTarget);
    setConnected(true);
    setCurrentTargetLabel(target ? `${target.title} - ${target.url}` : selectedTarget);
    setStatus({ kind: 'live', text: 'Live' });
    showToast('Connected and capturing network traffic');
  }, [host, port, selectedTarget, showToast, targets]);

  const detach = useCallback(async () => {
    await window.cdp.detach();
    setConnected(false);
    setStatus({ kind: 'idle', text: 'Idle' });
    setCurrentTargetLabel('');
  }, []);

  const clearRequests = useCallback(() => {
    dispatchCapture({ type: 'clear' });
    setSelectedId(null);
  }, []);

  const openExport = useCallback(() => setShowExport(true), []);

  const loadExtensionData = useCallback(async () => {
    if (!window.cdp) return;
    const result = await window.cdp.getExtensionData();
    if (result.ok) setExtensionState(result.state);
  }, []);

  const clearExtensionData = useCallback(async () => {
    const result = await window.cdp.clearExtensionData();
    if (result.ok) {
      setExtensionState(result.state);
      setScreenshotFeedback({});
      setActionFeedback({});
      setElementFeedback({});
      showToast('Extension data cleared');
    }
  }, [showToast]);

  const changeFeedback = useCallback((id: string, value: string) => {
    setScreenshotFeedback((current) => ({ ...current, [id]: value }));
  }, []);

  const changeActionFeedback = useCallback((id: string, value: string) => {
    setActionFeedback((current) => ({ ...current, [id]: value }));
  }, []);

  const changeElementFeedback = useCallback((id: string, value: string) => {
    setElementFeedback((current) => ({ ...current, [id]: value }));
  }, []);

  const exportRequests = useCallback(async (format: ExportFormat, fields: Set<ExportField>) => {
    setExporting(true);
    try {
      let exportableRequests = filteredRequests;

      if (format === 'selected' && fields.has('response')) {
        exportableRequests = await Promise.all(filteredRequests.map(async (request) => {
          if (request.bodyCache != null || request.failed || request.finishedAt == null) return request;
          const result = await window.cdp.getResponseBody({ requestId: request.id });
          if (!result.ok) return request;
          dispatchCapture({ type: 'body', requestId: request.id, body: result.body, base64Encoded: result.base64Encoded });
          return { ...request, bodyCache: result.body, bodyBase64: result.base64Encoded };
        }));
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const isPostman = format === 'postman';
      const data = isPostman ? JSON.stringify(makePostmanCollection(exportableRequests), null, 2) : makeSelectedFieldsExport(exportableRequests, fields);
      const result = await window.cdp.saveFile({
        defaultPath: isPostman ? `network-postman-${timestamp}.json` : `network-export-${timestamp}.md`,
        content: data,
      });
      if (result.ok) {
        setShowExport(false);
        showToast(isPostman ? 'Postman collection exported' : 'Selected fields exported');
      } else if (!result.canceled) {
        showToast(result.error || 'Export failed');
      }
    } finally {
      setExporting(false);
    }
  }, [filteredRequests, showToast]);

  const exportInspectPrompt = useCallback(async (scope: { breakpoints: boolean; events: boolean }) => {
    const reviewed = scope.breakpoints ? extensionState.screenshots.filter((screenshot) => {
      const elements = screenshot.elements?.length ? screenshot.elements : screenshot.element ? [screenshot.element] : [];
      return screenshotFeedback[screenshot.id]?.trim() || elements.some((_element, index) => elementFeedback[elementFeedbackId(screenshot.id, index)]?.trim());
    }) : [];
    const eventCount = scope.events ? extensionState.recordings.reduce((total, recording) => total + recording.actions.length, 0) : 0;
    if (!reviewed.length && !eventCount) return;
    setExporting(true);
    try {
      const result = await window.cdp.saveFile({
        defaultPath: `website-improvements-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
        content: makeInspectPrompt(reviewed, screenshotFeedback, extensionState.recordings, actionFeedback, allRequests, includeMeaningfulRequests, elementFeedback, scope),
      });
      if (result.ok) {
        setShowInspectExport(false);
        showToast('Improvement prompt exported');
      } else if (!result.canceled) {
        showToast(result.error || 'Export failed');
      }
    } finally {
      setExporting(false);
    }
  }, [actionFeedback, allRequests, elementFeedback, extensionState.recordings, extensionState.screenshots, includeMeaningfulRequests, screenshotFeedback, showToast]);

  const selectCopilotDirectory = useCallback(async () => {
    const result = await window.cdp.selectCopilotDirectory();
    if (result.ok) setCopilotSession(current => ({ ...current, directory: result.directory }));
    else if (!result.canceled) showToast(result.error || 'Could not select directory');
  }, [showToast]);

  const launchCopilotPrompt = useCallback(async (prompt: string, continueSession = false) => {
    setCopilotSession(current => ({ ...current, output: `${current.output}${current.output ? '\n\n' : ''}> ${continueSession ? prompt : 'Generated improvement prompt'}\n\n`, running: true, stopping: false }));
    try {
      const result = await window.cdp.startCopilot({ prompt, directory: copilotSession.directory, continueSession });
      if (!result.ok) {
        setCopilotSession(current => ({ ...current, running: false, stopping: false }));
        if (!result.canceled) showToast(result.error || 'Could not start Copilot');
      }
    } catch (error) {
      setCopilotSession(current => ({ ...current, output: `${current.output}Error: ${error instanceof Error ? error.message : String(error)}\n`, running: false, stopping: false }));
    }
  }, [copilotSession.directory, showToast]);

  const makeScopedInspectPrompt = useCallback((scope: { breakpoints: boolean; events: boolean }) => {
    const reviewed = scope.breakpoints ? extensionState.screenshots.filter((screenshot) => {
      const elements = screenshot.elements?.length ? screenshot.elements : screenshot.element ? [screenshot.element] : [];
      return screenshotFeedback[screenshot.id]?.trim() || elements.some((_element, index) => elementFeedback[elementFeedbackId(screenshot.id, index)]?.trim());
    }) : [];
    const eventCount = scope.events ? extensionState.recordings.reduce((total, recording) => total + recording.actions.length, 0) : 0;
    if (!reviewed.length && !eventCount) return '';
    return makeInspectPrompt(reviewed, screenshotFeedback, extensionState.recordings, actionFeedback, allRequests, includeMeaningfulRequests, elementFeedback, scope);
  }, [actionFeedback, allRequests, elementFeedback, extensionState.recordings, extensionState.screenshots, includeMeaningfulRequests, screenshotFeedback]);

  const addScopedPromptToChat = useCallback((scope: { breakpoints: boolean; events: boolean }) => {
    const prompt = makeScopedInspectPrompt(scope);
    if (!prompt) return;
    setCopilotChatDraft(prompt);
    setShowInspectExport(false);
    setShowCopilot(true);
  }, [makeScopedInspectPrompt]);

  const runInspectPromptInCopilot = useCallback(() => {
    const prompt = makeScopedInspectPrompt({ breakpoints: true, events: true });
    if (prompt) launchCopilotPrompt(prompt);
  }, [launchCopilotPrompt, makeScopedInspectPrompt]);

  useEffect(() => window.cdp.onCopilotEvent((event) => {
    if (event.kind === 'output') {
      setCopilotSession(current => ({ ...current, output: current.output + event.text }));
    } else if (event.kind === 'error') {
      setCopilotSession(current => ({ ...current, output: `${current.output}\nError: ${event.error}\n`, running: false, stopping: false }));
    } else {
      setCopilotSession(current => ({
        ...current,
        output: `${current.output}\nCopilot exited${event.code == null ? '' : ` with code ${event.code}`}.${event.signal ? ` Signal: ${event.signal}.` : ''}\n`,
        running: false,
        stopping: false,
      }));
    }
  }), []);

  const openModeExport = useCallback(() => {
    if (mode === 'inspect') {
      setInspectPromptTarget('export');
      setShowInspectExport(true);
    }
    else setShowExport(true);
  }, [mode]);

  exportRef.current = openModeExport;

  const loadResponseBody = useCallback(async (requestId: string) => {
    const result = await window.cdp.getResponseBody({ requestId });
    if (!result.ok) {
      showToast(result.error || 'Could not load body');
      return;
    }
    dispatchCapture({ type: 'body', requestId, body: result.body, base64Encoded: result.base64Encoded });
  }, [showToast]);

  useEffect(() => {
    if (!window.cdp) {
      setStatus({ kind: 'error', text: 'Bridge error' });
      showToast('Preload bridge unavailable. Restart the app.');
      return;
    }

    window.cdp.onNetworkEvent((event) => dispatchCapture({ type: 'event', event }));
    window.cdp.onTargetDisconnected(() => {
      setConnected(false);
      setStatus({ kind: 'error', text: 'Disconnected' });
      setCurrentTargetLabel('');
      showToast('Browser target disconnected');
    });
    window.cdp.onExportRequests(() => exportRef.current());
    window.cdp.onShowHelp(() => setShowHelp(true));
    return () => window.cdp.removeAllListeners();
  }, [showToast]);

  useEffect(() => {
    if (!window.cdp) return;
    loadExtensionData();
    const interval = window.setInterval(loadExtensionData, 1000);
    return () => window.clearInterval(interval);
  }, [loadExtensionData]);

  const startResize = useCallback((handle: HTMLDivElement, pointerId: number) => {
    handle.setPointerCapture(pointerId);
    const onMove = (event: PointerEvent) => {
      const width = window.innerWidth - event.clientX;
      setDetailWidth(`${Math.max(340, Math.min(window.innerWidth * 0.7, width))}px`);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  return (
    <>
      <Toolbar
        host={host}
        port={port}
        targets={targets}
        selectedTarget={selectedTarget}
        connected={connected}
        scanning={scanning}
        launchingBrowser={launchingBrowser}
        status={status}
        onHostChange={setHost}
        onPortChange={setPort}
        onSelectedTargetChange={setSelectedTarget}
        onStartBrowser={startBrowser}
        onScan={scanTargets}
        onAttach={attachSelected}
        onDetach={detach}
        onClear={mode === 'network' ? clearRequests : clearExtensionData}
        onExport={openModeExport}
      />
      <ModeBar
        mode={mode}
        screenshotCount={extensionState.screenshots.length}
        extensionConnected={extensionState.connected}
        onChange={setMode}
      />
      {mode === 'network' ? (
        <>
          <FilterBar
            filterText={filterText}
            filterType={filterType}
            errorsOnly={errorsOnly}
            requestCount={filteredRequests.length}
            onFilterTextChange={setFilterText}
            onFilterTypeChange={setFilterType}
            onErrorsOnlyChange={setErrorsOnly}
          />
          <main id="split-pane">
            <RequestTable requests={filteredRequests} totalCount={order.length} selectedId={selectedId} onSelect={setSelectedId} />
            <div id="resize-handle" role="separator" aria-label="Resize request details" aria-orientation="vertical" onPointerDown={(event) => startResize(event.currentTarget, event.pointerId)} />
            <div id="detail-panel" style={{ width: detailWidth }}>
              <RequestDetails request={selectedRequest} activeTab={activeTab} setActiveTab={setActiveTab} onLoadBody={loadResponseBody} />
            </div>
          </main>
          <StatusBar requestCount={order.length} totalBytes={totalBytes} currentTargetLabel={currentTargetLabel} />
        </>
      ) : (
        <InspectDashboard
          state={extensionState}
          feedback={screenshotFeedback}
          actionFeedback={actionFeedback}
          elementFeedback={elementFeedback}
          networkRequests={allRequests}
          onFeedbackChange={changeFeedback}
          onActionFeedbackChange={changeActionFeedback}
          onElementFeedbackChange={changeElementFeedback}
          onRefresh={loadExtensionData}
          onClear={clearExtensionData}
          onSetupCopilot={() => setShowCopilot(true)}
          copilotConfigured={Boolean(copilotSession.directory)}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showExport && (
        <ExportModal
          requestCount={filteredRequests.length}
          scopeLabel={filterType === 'all' ? 'visible' : filterType}
          exporting={exporting}
          onClose={() => setShowExport(false)}
          onExport={exportRequests}
        />
      )}
      {showInspectExport && (
        <InspectExportModal
          screenshots={extensionState.screenshots}
          feedback={screenshotFeedback}
          recordings={extensionState.recordings}
          actionFeedback={actionFeedback}
          elementFeedback={elementFeedback}
          exporting={exporting}
          includeMeaningfulRequests={includeMeaningfulRequests}
          onIncludeMeaningfulRequestsChange={setIncludeMeaningfulRequests}
          networkRequests={allRequests}
          onFeedbackChange={changeFeedback}
          onActionFeedbackChange={changeActionFeedback}
          onElementFeedbackChange={changeElementFeedback}
          onClose={() => setShowInspectExport(false)}
          onExport={inspectPromptTarget === 'copilot' ? addScopedPromptToChat : exportInspectPrompt}
          submitLabel={inspectPromptTarget === 'copilot' ? 'Add to Chat' : 'Export prompt'}
        />
      )}
      {showCopilot && (
        <CopilotSidebar
          {...copilotSession}
          canRun={Boolean(extensionState.recordings.length || Object.values(screenshotFeedback).some(value => value.trim()) || Object.values(elementFeedback).some(value => value.trim()))}
          chatDraft={copilotChatDraft}
          onChatDraftChange={setCopilotChatDraft}
          onSelectDirectory={selectCopilotDirectory}
          onRun={runInspectPromptInCopilot}
          onGeneratePrompt={() => {
            setInspectPromptTarget('copilot');
            setShowInspectExport(true);
          }}
          onSendChat={(message) => launchCopilotPrompt(message, true)}
          onStop={async () => {
            setCopilotSession(current => ({ ...current, stopping: true, output: `${current.output}\nStopping Copilot CLI…\n` }));
            const result = await window.cdp.stopCopilot();
            if (!result.ok) {
              setCopilotSession(current => ({ ...current, stopping: false, output: `${current.output}Could not stop Copilot: ${result.error || 'Unknown error'}\n` }));
            }
          }}
          onClose={() => setShowCopilot(false)}
        />
      )}
      <Toast toast={toast} />
    </>
  );
}
