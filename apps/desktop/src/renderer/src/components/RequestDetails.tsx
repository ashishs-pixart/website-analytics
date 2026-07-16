import { DETAIL_TABS, type DetailTab } from '../constants';
import type { NetworkRequest } from '../types';
import { formatBytes, formatMs, requestDuration, statusClass, tryPrettyJson } from '../utils/format';
import { HeadersTable } from './HeadersTable';

type RequestDetailsProps = {
  request: NetworkRequest | undefined;
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  onLoadBody: (id: string) => void;
};

function tabLabel(tab: DetailTab) {
  if (tab === 'request-body') return 'Request Body';
  if (tab === 'response-body') return 'Response Body';
  return tab[0].toUpperCase() + tab.slice(1);
}

export function RequestDetails({ request, activeTab, setActiveTab, onLoadBody }: RequestDetailsProps) {
  if (!request) {
    return (
      <div id="detail-empty">
        <div className="empty-icon">^</div>
        <p>Select a request to inspect it</p>
      </div>
    );
  }

  const timing = request.timing || {};
  const phases = [
    ['DNS', timing.dnsStart, timing.dnsEnd],
    ['Connect', timing.connectStart, timing.connectEnd],
    ['SSL', timing.sslStart, timing.sslEnd],
    ['Send', timing.sendStart, timing.sendEnd],
    ['Wait', timing.sendEnd, timing.receiveHeadersEnd],
  ].filter(([, start, end]) => typeof start === 'number' && typeof end === 'number' && start >= 0 && end >= 0 && end >= start) as Array<[string, number, number]>;
  const max = Math.max(...phases.map(([, , end]) => end), 1);

  return (
    <div id="detail-content">
      <div id="detail-tabs">
        {DETAIL_TABS.map((tab) => (
          <button key={tab} className={`detail-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            {tabLabel(tab)}
          </button>
        ))}
      </div>
      <div id="detail-panes">
        {activeTab === 'headers' && (
          <div className="detail-pane active">
            <div className="section">
              <h3>General</h3>
              <div className="kv">
                <div className="k">Request URL</div><div className="v">{request.url}</div>
                <div className="k">Method</div><div>{request.method || '-'}</div>
                <div className="k">Status</div><div><span className={statusClass(request.status)}>{request.status || 'Pending'}</span> {request.statusText || request.errorText}</div>
                <div className="k">Resource Type</div><div>{request.resourceType || 'Other'}</div>
                <div className="k">Protocol</div><div>{request.protocol || '-'}</div>
                <div className="k">Remote Address</div><div>{request.remoteIPAddress ? `${request.remoteIPAddress}:${request.remotePort || ''}` : '-'}</div>
                <div className="k">From Cache</div><div>{request.fromCache ? 'Yes' : 'No'}</div>
                <div className="k">Transferred</div><div>{formatBytes(request.encodedDataLength)}</div>
                <div className="k">Duration</div><div>{formatMs(requestDuration(request))}</div>
              </div>
            </div>
            <div className="section"><h3>Request Headers</h3><HeadersTable headers={{ ...request.requestHeaders, ...request.requestExtraHeaders }} /></div>
            <div className="section"><h3>Response Headers</h3><HeadersTable headers={{ ...request.responseHeaders, ...request.responseExtraHeaders }} /></div>
          </div>
        )}
        {activeTab === 'request-body' && <div className="detail-pane active">{request.postData ? <pre>{tryPrettyJson(request.postData)}</pre> : <p className="k">No request body captured.</p>}</div>}
        {activeTab === 'response-body' && (
          <div className="detail-pane active">
            {request.wsFrames.length > 0 && (
              <div className="section">
                <h3>WebSocket Frames</h3>
                <pre>{request.wsFrames.map((f) => `[${f.direction}] opcode=${f.opcode} ${f.payload}`).join('\n')}</pre>
              </div>
            )}
            {request.bodyCache != null ? (
              <pre>{request.bodyBase64 ? `[base64 encoded]\n${request.bodyCache}` : tryPrettyJson(request.bodyCache)}</pre>
            ) : request.failed ? (
              <p className="k">Request failed: {request.errorText}</p>
            ) : (
              <>
                <div className="body-actions"><button className="btn btn-secondary" onClick={() => onLoadBody(request.id)}>Load response body</button></div>
                <p className="k">Bodies are fetched on demand after the request finishes.</p>
              </>
            )}
          </div>
        )}
        {activeTab === 'timing' && (
          <div className="detail-pane active">
            <div className="section">
              <h3>Summary</h3>
              <div className="kv">
                <div className="k">Started</div><div>{request.wallTime ? new Date(request.wallTime * 1000).toLocaleString() : '-'}</div>
                <div className="k">Total</div><div>{formatMs(requestDuration(request))}</div>
                <div className="k">Encoded Size</div><div>{formatBytes(request.encodedDataLength)}</div>
              </div>
            </div>
            <div className="section">
              <h3>Phases</h3>
              {phases.length ? phases.map(([name, start, end]) => (
                <div className="timeline-row" key={name}>
                  <div className="k">{name}</div>
                  <div className="bar"><span style={{ marginLeft: `${(start / max) * 100}%`, width: `${Math.max(((end - start) / max) * 100, 1)}%` }} /></div>
                  <div>{formatMs(end - start)}</div>
                </div>
              )) : <p className="k">No detailed timing available.</p>}
            </div>
          </div>
        )}
        {activeTab === 'raw' && <div className="detail-pane active"><pre>{JSON.stringify(request, null, 2)}</pre></div>}
      </div>
    </div>
  );
}
