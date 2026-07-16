import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FilterBar } from './components/FilterBar';
import { HelpModal } from './components/HelpModal';
import { RequestDetails } from './components/RequestDetails';
import { RequestTable } from './components/RequestTable';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import type { DetailTab, StatusKind } from './constants';
import type { NetworkRequest, Target, ToastState } from './types';
import { captureReducer } from './utils/capture';
import { formatBytes } from './utils/format';
import { makeHar } from './utils/har';

export function App() {
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
  const exportRef = useRef(() => {});

  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ message, id });
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), 2500);
  }, []);

  const totalBytes = useMemo(() => Array.from(requests.values()).reduce((sum, req) => sum + (req.encodedDataLength || 0), 0), [requests]);
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

  const exportHar = useCallback(async () => {
    const content = JSON.stringify(makeHar(order, requests), null, 2);
    const result = await window.cdp.saveFile({ defaultPath: `network-${new Date().toISOString().replace(/[:.]/g, '-')}.har`, content });
    if (result.ok) showToast('HAR exported');
    else if (!result.canceled) showToast(result.error || 'Export failed');
  }, [order, requests, showToast]);

  exportRef.current = exportHar;

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
    window.cdp.onExportHar(() => exportRef.current());
    window.cdp.onShowHelp(() => setShowHelp(true));
    return () => window.cdp.removeAllListeners();
  }, [showToast]);

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
        onClear={clearRequests}
        onExport={exportHar}
      />
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
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <Toast toast={toast} />
    </>
  );
}
