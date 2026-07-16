import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FilterBar } from './components/FilterBar';
import { ExportModal, type ExportFormat } from './components/ExportModal';
import { HelpModal } from './components/HelpModal';
import { InspectDashboard } from './components/InspectDashboard';
import { InspectExportModal } from './components/InspectExportModal';
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
import { makeInspectPrompt } from './utils/inspectExport';

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
  const [exporting, setExporting] = useState(false);
  const [extensionState, setExtensionState] = useState<ExtensionState>(EMPTY_EXTENSION_STATE);
  const [screenshotFeedback, setScreenshotFeedback] = useState<Record<string, string>>({});
  const [actionFeedback, setActionFeedback] = useState<Record<string, string>>({});
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
      showToast('Extension data cleared');
    }
  }, [showToast]);

  const changeFeedback = useCallback((id: string, value: string) => {
    setScreenshotFeedback((current) => ({ ...current, [id]: value }));
  }, []);

  const changeActionFeedback = useCallback((id: string, value: string) => {
    setActionFeedback((current) => ({ ...current, [id]: value }));
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
      const data = isPostman ? makePostmanCollection(exportableRequests) : makeSelectedFieldsExport(exportableRequests, fields);
      const result = await window.cdp.saveFile({
        defaultPath: isPostman ? `network-postman-${timestamp}.json` : `network-export-${timestamp}.json`,
        content: JSON.stringify(data, null, 2),
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

  const exportInspectPrompt = useCallback(async () => {
    const reviewed = extensionState.screenshots.filter((screenshot) => screenshotFeedback[screenshot.id]?.trim());
    const reviewedActionCount = Object.values(actionFeedback).filter((value) => value.trim()).length;
    if (!reviewed.length && !reviewedActionCount) return;
    setExporting(true);
    try {
      const result = await window.cdp.saveFile({
        defaultPath: `website-improvements-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
        content: makeInspectPrompt(reviewed, screenshotFeedback, extensionState.recordings, actionFeedback, allRequests),
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
  }, [actionFeedback, allRequests, extensionState.recordings, extensionState.screenshots, screenshotFeedback, showToast]);

  const openModeExport = useCallback(() => {
    if (mode === 'inspect') setShowInspectExport(true);
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

  const startResize = useCallback(() => {
    const onMove = (event: MouseEvent) => {
      const width = window.innerWidth - event.clientX;
      setDetailWidth(`${Math.max(340, Math.min(window.innerWidth * 0.7, width))}px`);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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
            <div id="resize-handle" onMouseDown={startResize} />
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
          networkRequests={allRequests}
          onFeedbackChange={changeFeedback}
          onActionFeedbackChange={changeActionFeedback}
          onRefresh={loadExtensionData}
          onClear={clearExtensionData}
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
          exporting={exporting}
          onFeedbackChange={changeFeedback}
          onActionFeedbackChange={changeActionFeedback}
          onClose={() => setShowInspectExport(false)}
          onExport={exportInspectPrompt}
        />
      )}
      <Toast toast={toast} />
    </>
  );
}
