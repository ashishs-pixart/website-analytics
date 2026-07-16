import type { StatusKind } from '../constants';
import type { Target } from '../types';
import { truncateLabel } from '../utils/format';

type ToolbarProps = {
  host: string;
  port: number;
  targets: Target[];
  selectedTarget: string;
  connected: boolean;
  scanning: boolean;
  launchingBrowser: boolean;
  status: { kind: StatusKind; text: string };
  onHostChange: (value: string) => void;
  onPortChange: (value: number) => void;
  onSelectedTargetChange: (value: string) => void;
  onStartBrowser: () => void;
  onScan: () => void;
  onAttach: () => void;
  onDetach: () => void;
  onClear: () => void;
  onExport: () => void;
};

export function Toolbar({
  host,
  port,
  targets,
  selectedTarget,
  connected,
  scanning,
  launchingBrowser,
  status,
  onHostChange,
  onPortChange,
  onSelectedTargetChange,
  onStartBrowser,
  onScan,
  onAttach,
  onDetach,
  onClear,
  onExport,
}: ToolbarProps) {
  return (
    <header id="toolbar">
      <div className="toolbar-left">
        <div className="logo"><span className="logo-icon">NW</span><span className="logo-text">Network Inspector</span></div>
        <div className="connect-group">
          <label className="field-label">Host</label>
          <input id="inp-host" type="text" value={host} onChange={(event) => onHostChange(event.target.value)} spellCheck={false} disabled={connected} />
          <label className="field-label">Port</label>
          <input id="inp-port" type="number" value={port} min="1" max="65535" onChange={(event) => onPortChange(Number(event.target.value || 9222))} disabled={connected} />
          <button className="btn btn-secondary" title="Start Chrome, Brave, or Edge in debug mode" onClick={onStartBrowser} disabled={connected || scanning || launchingBrowser}>{launchingBrowser ? 'Starting...' : 'Start Browser'}</button>
          <button className="btn btn-secondary" title="Scan for tabs" onClick={onScan} disabled={connected || scanning}>{scanning ? 'Scanning...' : 'Scan'}</button>
        </div>
        <div className="target-group">
          <label className="field-label">Tab</label>
          <select value={selectedTarget} disabled={connected || scanning || !targets.length} onChange={(event) => onSelectedTargetChange(event.target.value)}>
            {scanning ? <option value="">Scanning...</option> : targets.length ? targets.map((target) => {
              const label = `${target.title} - ${target.url}`;
              return <option key={target.id} value={target.id} title={label}>{truncateLabel(label)}</option>;
            }) : <option value="">- scan first -</option>}
          </select>
          <button className="btn btn-primary" onClick={onAttach} disabled={connected || scanning || !selectedTarget}>Connect</button>
          <button className="btn btn-danger" onClick={onDetach} disabled={!connected}>Disconnect</button>
        </div>
      </div>
      <div className="toolbar-right">
        <span className={`badge badge-${status.kind}`}>{status.text}</span>
        <button className="btn btn-ghost" onClick={onClear}>Clear</button>
        <button className="btn btn-ghost" onClick={onExport}>HAR</button>
      </div>
    </header>
  );
}
