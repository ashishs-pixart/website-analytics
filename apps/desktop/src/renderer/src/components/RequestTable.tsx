import type { NetworkRequest } from '../types';
import { formatBytes, formatMs, methodClass, parseUrlParts, requestDuration, statusClass } from '../utils/format';

type RequestTableProps = {
  requests: NetworkRequest[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function RequestTable({ requests, totalCount, selectedId, onSelect }: RequestTableProps) {
  return (
    <div id="request-list-wrap">
      <table id="request-table">
        <thead>
          <tr><th className="col-status">Status</th><th className="col-method">Method</th><th className="col-type">Type</th><th className="col-url">URL</th><th className="col-size">Size</th><th className="col-time">Time</th></tr>
        </thead>
        <tbody>
          {requests.map((req) => {
            const url = parseUrlParts(req.url);
            return (
              <tr key={req.id} className={selectedId === req.id ? 'selected' : ''} onClick={() => onSelect(req.id)}>
                <td><span className={`status-pill ${statusClass(req.status)}`}>{req.status || '...'}</span></td>
                <td><span className={`method-pill ${methodClass(req.method)}`}>{req.method || '-'}</span></td>
                <td><span className="type-pill">{req.resourceType || 'Other'}</span></td>
                <td title={req.url}><span className="url-host">{url.host}</span>{url.path}</td>
                <td>{formatBytes(req.encodedDataLength)}</td>
                <td>{formatMs(requestDuration(req))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!totalCount ? (
        <div id="empty-state">
          <div className="empty-icon">[]</div>
          <p>Connect to a browser tab to start capturing</p>
          <small>Launch your browser with <code>--remote-debugging-port=9222</code></small>
        </div>
      ) : null}
    </div>
  );
}
