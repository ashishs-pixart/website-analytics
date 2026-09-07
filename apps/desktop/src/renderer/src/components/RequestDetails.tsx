import { DETAIL_TABS, type DetailTab } from '../constants';
import type { NetworkRequest } from '../types';
import { formatBytes, formatMs, requestDuration, statusClass, tryPrettyJson } from '../utils/format';
import { analyzeRequestSecurity } from '../utils/security';
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
  const security = analyzeRequestSecurity(request);
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
                {request.replayComparison && <>
                  <div className="k">Replay comparison</div><div className={`comparison-detail ${request.replayComparison.responseSame === true ? 'comparison-same' : request.replayComparison.responseSame === false ? 'comparison-different' : 'comparison-unknown'}`}>{request.replayComparison.responseMessage}</div>
                  <div className="k">Replay timing</div><div>{request.replayComparison.timingComparison === 'unknown' ? 'Timing unavailable' : request.replayComparison.timingComparison === 'same' ? 'Same duration' : `${request.replayComparison.timingComparison === 'faster' ? 'Faster' : 'Slower'} than the ${request.replayComparison.role === 'replay' ? 'recording' : 'replay'} (${formatMs(request.replayComparison.counterpartDurationMs)})`}</div>
                </>}
              </div>
            </div>
            <div className="section"><h3>Request Headers</h3><HeadersTable headers={{ ...request.requestHeaders, ...request.requestExtraHeaders }} /></div>
            <div className="section"><h3>Response Headers</h3><HeadersTable headers={{ ...request.responseHeaders, ...request.responseExtraHeaders }} /></div>
          </div>
        )}
        {activeTab === 'request-body' && <div className="detail-pane active">{request.postData ? <pre>{tryPrettyJson(request.postData)}</pre> : <p className="k">No request body captured.</p>}</div>}
        {activeTab === 'security' && (
          <div className="detail-pane active security-analysis">
            <div className={`security-summary security-${security.rating}`}>
              <div><strong>{security.label}</strong><span>{security.score == null ? 'Waiting for response' : `${security.score}/100`}</span></div>
              <p>Passive assessment of observable {security.scope} response controls. A high score does not prove the endpoint is secure.</p>
            </div>
            <div className="section security-coverage">
              <h3>Assessment coverage</h3>
              <div className="kv">
                <div className="k">Response category</div><div>{security.scope === 'api' ? 'API / structured data' : security.scope === 'document' ? 'Browser document' : 'Static or supporting resource'}</div>
                <div className="k">Transport evidence</div><div>{request.securityDetails ? 'TLS metadata captured' : request.url.startsWith('https:') || request.url.startsWith('wss:') ? 'Encrypted URL observed; detailed TLS metadata unavailable' : 'No encrypted transport observed'}</div>
                <div className="k">Headers</div><div>{Object.keys({ ...request.responseHeaders, ...request.responseExtraHeaders }).length} response header{Object.keys({ ...request.responseHeaders, ...request.responseExtraHeaders }).length === 1 ? '' : 's'} assessed</div>
                <div className="k">Response structure</div><div>{request.bodyCache == null ? 'Not assessed — load the response body to enable JSON and error-leakage checks' : request.bodyBase64 ? 'Skipped because the body is binary/base64' : 'Loaded body assessed locally'}</div>
              </div>
            </div>
            <div className="section">
              <h3>Observed findings</h3>
              {security.findings.length ? <div className="security-findings">{security.findings.map((finding) => (
                <article key={finding.id} className={`security-finding severity-${finding.severity}`}>
                  <div><span>{finding.severity}</span><strong>{finding.title}</strong></div>
                  <dl className="security-explanation">
                    <div><dt>Observed</dt><dd>{finding.detail}</dd></div>
                    <div><dt>Why it matters</dt><dd>{finding.impact}</dd></div>
                    <div><dt>Recommended action</dt><dd>{finding.recommendation}</dd></div>
                    <div><dt>Reference</dt><dd>{finding.standard}</dd></div>
                  </dl>
                </article>
              ))}</div> : <p className="k">No issues were identified by these passive checks.</p>}
            </div>
            {security.positiveSignals.length > 0 && <div className="section"><h3>Signals and next steps</h3><ul className="security-signals">{security.positiveSignals.map(signal => <li key={signal}>{signal}</li>)}</ul></div>}
            {request.securityDetails && <div className="section"><h3>TLS details</h3><div className="kv"><div className="k">Protocol</div><div>{request.securityDetails.protocol || '-'}</div><div className="k">Cipher</div><div>{request.securityDetails.cipher || '-'}</div><div className="k">Certificate</div><div>{request.securityDetails.subjectName || '-'}</div><div className="k">Issuer</div><div>{request.securityDetails.issuer || '-'}</div></div></div>}
            <div className="section security-methodology">
              <h3>How the rating works</h3>
              <p>The score starts at 100 and deducts 35 points for Critical findings, 20 for High, 10 for Medium, and 4 for Low. Any Critical finding forces the overall rating to Critical.</p>
              <div className="security-rating-key">
                <span className="security-good">Good 85–100</span><span className="security-review">Review 65–84</span><span className="security-risky">Risky 40–64</span><span className="security-critical">Critical 0–39 or a critical finding</span>
              </div>
              <p className="k">These checks cannot prove authorization, authentication, server-side validation, dependency safety, exploitability, or business impact. Confirm findings with authorized security testing and application context.</p>
            </div>
          </div>
        )}
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
