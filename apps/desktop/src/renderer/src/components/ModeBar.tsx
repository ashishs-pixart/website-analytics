export type AppMode = 'network' | 'inspect';

type ModeBarProps = {
  mode: AppMode;
  screenshotCount: number;
  extensionConnected: boolean;
  onChange: (mode: AppMode) => void;
};

export function ModeBar({ mode, screenshotCount, extensionConnected, onChange }: ModeBarProps) {
  return (
    <nav id="mode-bar" aria-label="Workspace mode">
      <button className={mode === 'network' ? 'active' : ''} onClick={() => onChange('network')}>Network</button>
      <button className={mode === 'inspect' ? 'active' : ''} onClick={() => onChange('inspect')}>
        Inspect {screenshotCount > 0 && <span>{screenshotCount}</span>}
      </button>
      <small className={extensionConnected ? 'extension-online' : ''}>{extensionConnected ? 'Website Analytics connected' : 'Website Analytics offline'}</small>
    </nav>
  );
}
