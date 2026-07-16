import { formatBytes } from '../utils/format';

type StatusBarProps = {
  requestCount: number;
  totalBytes: number;
  currentTargetLabel: string;
};

export function StatusBar({ requestCount, totalBytes, currentTargetLabel }: StatusBarProps) {
  return (
    <footer id="status-bar">
      <span>{requestCount} request{requestCount === 1 ? '' : 's'}</span>
      <span>{formatBytes(totalBytes)} transferred</span>
      <span>{currentTargetLabel ? `Connected: ${currentTargetLabel}` : 'Not connected'}</span>
    </footer>
  );
}
