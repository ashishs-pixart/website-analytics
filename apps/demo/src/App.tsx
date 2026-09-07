import { useCallback, useMemo, useRef, useState } from 'react';
import { DictionaryReplayLab } from './DictionaryReplayLab';

type RequestState = 'idle' | 'loading' | 'success' | 'error';
type RequestLog = {
  id: number;
  label: string;
  method: string;
  url: string;
  status: number | null;
  duration: number;
  size: number;
  state: Exclude<RequestState, 'idle' | 'loading'>;
  time: string;
};

type DemoCard = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST';
  accent: 'lime' | 'coral' | 'sky' | 'violet';
  run: () => Promise<unknown>;
};

const endpoints = {
  people: 'https://jsonplaceholder.typicode.com/users',
  weather: 'https://api.open-meteo.com/v1/forecast?latitude=19.076&longitude=72.878&current=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=Asia%2FKolkata',
  dataset: 'https://jsonplaceholder.typicode.com/photos?_limit=100',
  missing: 'https://jsonplaceholder.typicode.com/posts/0',
  post: 'https://jsonplaceholder.typicode.com/posts',
};

function compactUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function nowLabel() {
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
}

export function App() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [states, setStates] = useState<Record<string, RequestState>>({});
  const [activeFilter, setActiveFilter] = useState<'all' | 'fetch' | 'errors'>('all');
  const [autoRun, setAutoRun] = useState(false);
  const [weather, setWeather] = useState<{ temperature: number; wind: number } | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [datasetCount, setDatasetCount] = useState<number | null>(null);
  const sequenceRef = useRef(0);

  const trackedFetch = useCallback(async (label: string, url: string, init?: RequestInit) => {
    const startedAt = performance.now();
    const method = init?.method || 'GET';
    let response: Response;
    try {
      response = await fetch(url, init);
      const raw = await response.text();
      const duration = Math.round(performance.now() - startedAt);
      const entry: RequestLog = {
        id: ++sequenceRef.current,
        label,
        method,
        url,
        status: response.status,
        duration,
        size: new Blob([raw]).size,
        state: response.ok ? 'success' : 'error',
        time: nowLabel(),
      };
      setLogs((current) => [entry, ...current].slice(0, 30));
      if (!response.ok) throw Object.assign(new Error(`Request returned ${response.status}`), { alreadyLogged: true });
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      if (!(error instanceof Error && 'alreadyLogged' in error)) {
        const failedEntry: RequestLog = {
          id: ++sequenceRef.current,
          label,
          method,
          url,
          status: null,
          duration: Math.round(performance.now() - startedAt),
          size: 0,
          state: 'error',
          time: nowLabel(),
        };
        setLogs((current) => [failedEntry, ...current].slice(0, 30));
      }
      throw error;
    }
  }, []);

  const runPeople = useCallback(async () => {
    const data = await trackedFetch('Load crew', endpoints.people) as Array<{ name: string }>;
    setPeople(data.slice(0, 4).map((person) => person.name));
    return data;
  }, [trackedFetch]);

  const runWeather = useCallback(async () => {
    const data = await trackedFetch('Mumbai weather', endpoints.weather) as { current: { temperature_2m: number; wind_speed_10m: number } };
    setWeather({ temperature: data.current.temperature_2m, wind: data.current.wind_speed_10m });
    return data;
  }, [trackedFetch]);

  const runDataset = useCallback(async () => {
    const data = await trackedFetch('Photo dataset', endpoints.dataset) as unknown[];
    setDatasetCount(data.length);
    return data;
  }, [trackedFetch]);

  const runMissing = useCallback(() => trackedFetch('Missing record', endpoints.missing), [trackedFetch]);
  const runPost = useCallback(() => trackedFetch('Create dispatch', endpoints.post, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Demo-Source': 'network-watch' },
    body: JSON.stringify({ title: 'Network Watch demo dispatch', body: 'Inspect this request payload.', userId: 7 }),
  }), [trackedFetch]);

  const cards: DemoCard[] = useMemo(() => [
    { id: 'people', eyebrow: 'JSON · 10 records', title: 'Load the crew', description: 'A clean GET with a compact JSON response.', endpoint: endpoints.people, method: 'GET', accent: 'lime', run: runPeople },
    { id: 'weather', eyebrow: 'LIVE · MUMBAI', title: weather ? `${weather.temperature}°C · ${weather.wind} km/h` : 'Read live weather', description: 'Query parameters, CORS headers, and fresh data.', endpoint: endpoints.weather, method: 'GET', accent: 'sky', run: runWeather },
    { id: 'dataset', eyebrow: 'LARGER PAYLOAD', title: datasetCount ? `${datasetCount} records received` : 'Pull a dataset', description: 'A larger response makes size and timing easier to compare.', endpoint: endpoints.dataset, method: 'GET', accent: 'violet', run: runDataset },
    { id: 'missing', eyebrow: 'INTENTIONAL · 404', title: 'Trigger an error', description: 'A safe not-found response for errors-only filtering.', endpoint: endpoints.missing, method: 'GET', accent: 'coral', run: runMissing },
    { id: 'post', eyebrow: 'JSON · REQUEST BODY', title: 'Send a dispatch', description: 'A mock POST with headers and an inspectable payload.', endpoint: endpoints.post, method: 'POST', accent: 'lime', run: runPost },
  ], [datasetCount, runDataset, runMissing, runPeople, runPost, runWeather, weather]);

  const execute = useCallback(async (card: DemoCard) => {
    setStates((current) => ({ ...current, [card.id]: 'loading' }));
    try {
      await card.run();
      setStates((current) => ({ ...current, [card.id]: 'success' }));
    } catch {
      setStates((current) => ({ ...current, [card.id]: 'error' }));
    }
  }, []);

  const runScenario = useCallback(async () => {
    if (autoRun) return;
    setAutoRun(true);
    for (const card of cards) await execute(card);
    await runPeople();
    setAutoRun(false);
  }, [autoRun, cards, execute, runPeople]);

  const visibleLogs = logs.filter((log) => activeFilter !== 'errors' || log.state === 'error');
  const errorCount = logs.filter((log) => log.state === 'error').length;
  const averageTime = logs.length ? Math.round(logs.reduce((sum, log) => sum + log.duration, 0) / logs.length) : 0;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Signal Room home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Network Watch <em>/ Signal Room</em></span>
        </a>
        <div className="topbar-right">
          <span className="live-pill"><i /> Live playground</span>
          <a href="#replay-lab">Dictionary <span>↗</span></a>
          <a href="#requests">Request log <span>↓</span></a>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker"><span>01</span> Capture something real</p>
          <h1>Make the invisible<br /><span>visible.</span></h1>
          <p className="lede">A tiny API control room designed to put Network Watch through its paces. Every button creates a real request you can capture, filter, inspect, replay, and export.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => void runScenario()} disabled={autoRun}>
              <span>{autoRun ? 'Running scenario…' : 'Run full scenario'}</span>
              <b>{autoRun ? '•••' : '↗'}</b>
            </button>
            <span className="run-note">6 requests · ~5 API patterns</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Animated network signal visualization">
          <div className="orbit orbit-one"><i /></div>
          <div className="orbit orbit-two"><i /></div>
          <div className="orbit orbit-three"><i /></div>
          <div className="radar-lines" />
          <div className="signal-core">
            <span>{logs.length.toString().padStart(2, '0')}</span>
            <small>requests</small>
          </div>
          <span className="coordinate coordinate-a">19.0760° N</span>
          <span className="coordinate coordinate-b">72.8777° E</span>
        </div>
      </section>

      <section className="metrics" aria-label="Request summary">
        <div><span>Total requests</span><strong>{logs.length.toString().padStart(2, '0')}</strong><small>this session</small></div>
        <div><span>Errors found</span><strong>{errorCount.toString().padStart(2, '0')}</strong><small className={errorCount ? 'bad' : ''}>● HTTP 4xx / failed</small></div>
        <div><span>Average time</span><strong>{averageTime || '—'}{averageTime ? <sup>ms</sup> : null}</strong><small>client measured</small></div>
      </section>

      <section className="workbench">
        <div className="section-heading">
          <div><p className="kicker"><span>02</span> Generate traffic</p><h2>Choose your signal.</h2></div>
          <p>Run one pattern at a time, or use the full scenario to produce a capture worth exploring.</p>
        </div>
        <div className="card-grid">
          {cards.map((card, index) => {
            const state = states[card.id] || 'idle';
            return (
              <article className={`request-card ${card.accent}`} key={card.id}>
                <div className="card-top"><span>{String(index + 1).padStart(2, '0')}</span><i /></div>
                <p>{card.eyebrow}</p>
                <h3>{card.title}</h3>
                <p className="description">{card.description}</p>
                {card.id === 'people' && people.length > 0 && <div className="mini-data">{people.slice(0, 3).map((name) => <span key={name}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>)}</div>}
                <code><b>{card.method}</b> {compactUrl(card.endpoint)}</code>
                <button onClick={() => void execute(card)} disabled={state === 'loading'}>
                  <span>{state === 'loading' ? 'Sending…' : state === 'success' ? 'Run again' : state === 'error' ? 'Retry request' : 'Send request'}</span>
                  <i className={state}>{state === 'loading' ? '···' : state === 'success' ? '✓' : state === 'error' ? '!' : '→'}</i>
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <DictionaryReplayLab trackedFetch={trackedFetch} />

      <section className="request-panel" id="requests">
        <div className="panel-head">
          <div><p className="kicker"><span>04</span> Watch it happen</p><h2>Session requests</h2></div>
          <div className="filters" aria-label="Filter requests">
            {(['all', 'fetch', 'errors'] as const).map((filter) => <button className={activeFilter === filter ? 'active' : ''} onClick={() => setActiveFilter(filter)} key={filter}>{filter}</button>)}
          </div>
        </div>
        <div className="table-wrap">
          <div className="request-row table-header"><span>Status</span><span>Method</span><span>Name</span><span>Size</span><span>Time</span><span>Started</span></div>
          {visibleLogs.length === 0 ? (
            <div className="empty-state"><span>⌁</span><strong>No signals captured yet.</strong><p>Send a request above or run the full scenario.</p></div>
          ) : visibleLogs.map((log) => (
            <div className="request-row" key={log.id}>
              <span><i className={log.state} /> {log.status ?? 'ERR'}</span>
              <span className="method">{log.method}</span>
              <span><strong>{log.label}</strong><small>{compactUrl(log.url)}</small></span>
              <span>{formatBytes(log.size)}</span>
              <span>{log.duration} ms</span>
              <span>{log.time}</span>
            </div>
          ))}
        </div>
        <div className="panel-foot"><span><i /> Browser requests are live</span><button onClick={() => setLogs([])}>Clear session</button></div>
      </section>

      <footer>
        <span>NW—DEMO / 2026</span>
        <p>Open DevTools <kbd>⌥</kbd><kbd>⌘</kbd><kbd>I</kbd> and select <strong>Network</strong>.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
