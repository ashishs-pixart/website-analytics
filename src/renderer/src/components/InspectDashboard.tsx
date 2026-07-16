import { useState } from 'react';
import type { ExtensionRecording, ExtensionState, NetworkRequest } from '../types';
import { formatBytes, formatMs, requestDuration } from '../utils/format';

type InspectDashboardProps = {
  state: ExtensionState;
  feedback: Record<string, string>;
  actionFeedback: Record<string, string>;
  networkRequests: NetworkRequest[];
  onFeedbackChange: (id: string, value: string) => void;
  onActionFeedbackChange: (id: string, value: string) => void;
  onRefresh: () => void;
  onClear: () => void;
};

function relatedRequests(recording: ExtensionRecording, actionIndex: number, requests: NetworkRequest[]) {
  const action = recording.actions[actionIndex];
  const nextAction = recording.actions[actionIndex + 1];
  const start = action.timestamp - 100;
  const end = nextAction?.timestamp ?? Math.min(Date.parse(recording.stoppedAt) + 1000, action.timestamp + 15000);
  return requests.filter((request) => {
    if (!request.wallTime) return false;
    const requestTime = request.wallTime * 1000;
    return requestTime >= start && requestTime < end;
  });
}

export function InspectDashboard({ state, feedback, actionFeedback, networkRequests, onFeedbackChange, onActionFeedbackChange, onRefresh, onClear }: InspectDashboardProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewScreenshot = state.screenshots.find((screenshot) => screenshot.id === previewId);

  return (
    <>
    <main id="inspect-mode">
      <section className="inspect-summary">
        <div>
          <div className={`bridge-status ${state.connected ? 'connected' : ''}`}>
            <span className="bridge-dot" /> {state.connected ? 'Extension connected' : 'Waiting for extension'}
          </div>
          <p>Local bridge: 127.0.0.1:{state.bridgePort} · {state.screenshots.length} screenshot{state.screenshots.length === 1 ? '' : 's'} · {state.recordings.length} recording{state.recordings.length === 1 ? '' : 's'}</p>
        </div>
        <div className="inspect-actions">
          <button className="btn btn-secondary" onClick={onRefresh}>Refresh</button>
          <button className="btn btn-ghost" onClick={onClear} disabled={!state.screenshots.length && !state.recordings.length}>Clear extension data</button>
        </div>
      </section>

      {state.recordings.length > 0 && (
        <section className="recording-panel">
          <div className="recording-panel-heading">
            <div><h2>Recorded journeys</h2><p>Recent action sequences received from the extension.</p></div>
          </div>
          <div className="recording-list">
            {state.recordings.slice(0, 5).map((recording) => (
              <details key={recording.id}>
                <summary>
                  <strong>{recording.kind === 'replay' ? 'Replay' : 'Recording'} · {recording.title || recording.url || 'Untitled journey'}</strong>
                  <span><code>{recording.id}</code> · {recording.actions.length} action{recording.actions.length === 1 ? '' : 's'}</span>
                </summary>
                <ol>
                  {recording.actions.map((action, index) => {
                    const requests = relatedRequests(recording, index, networkRequests);
                    return (
                      <li key={action.id || `${recording.id}-${index}`}>
                        <div className="recorded-action-heading">
                          <code>{action.id || `${recording.id}-ACTION-${index + 1}`}</code>
                          <strong>{action.type}</strong>
                          <span>{action.key ? `Key: ${action.key}` : action.text || action.selector}</span>
                          <small>{action.delayMs} ms after previous action</small>
                        </div>
                        {requests.length > 0 ? (
                          <div className="action-requests">
                            <h4>{requests.length} network request{requests.length === 1 ? '' : 's'} after this action</h4>
                            {requests.map((request) => (
                              <div key={request.id}><code>{request.method}</code><span title={request.url}>{request.url}</span><strong>{request.status || 'Pending'}</strong><small>{formatMs(requestDuration(request))}</small><small>{formatBytes(request.encodedDataLength)}</small></div>
                            ))}
                          </div>
                        ) : <p className="no-action-requests">No captured network requests after this action.</p>}
                        <label className="action-feedback-field">
                          <span>What should change for this event?</span>
                          <textarea
                            value={actionFeedback[action.id] || ''}
                            onChange={(event) => onActionFeedbackChange(action.id, event.target.value)}
                            placeholder={`Describe the desired change for ${action.id}...`}
                          />
                        </label>
                      </li>
                    );
                  })}
                </ol>
              </details>
            ))}
          </div>
        </section>
      )}

      {!state.screenshots.length ? (
        <section className="inspect-empty">
          <div className="empty-icon">▣</div>
          <h2>No responsive screenshots yet</h2>
          <p>Load the Website Analytics extension, pause a simulation, optionally select an element, and capture a screenshot.</p>
        </section>
      ) : (
        <section className="screenshot-grid">
          {state.screenshots.map((screenshot) => (
            <article className="screenshot-card" key={screenshot.id}>
              <button className="screenshot-preview" onClick={() => setPreviewId(screenshot.id)} aria-label={`Open full-page preview for ${screenshot.title || screenshot.url}`}>
                <img src={screenshot.dataUrl} alt={`${screenshot.title} at ${screenshot.width} by ${screenshot.height}`} />
                <span>{screenshot.width} × {screenshot.height}</span>
              </button>
              <div className="screenshot-content">
                <h2>{screenshot.title || 'Untitled page'}</h2>
                <div className="inspect-url" title={screenshot.url}>{screenshot.url}</div>
                <small>{new Date(screenshot.capturedAt).toLocaleString()}</small>
                {screenshot.element ? (
                  <details>
                    <summary>Selected element: <code>{screenshot.element.selector}</code></summary>
                    <h3>HTML</h3>
                    <pre>{screenshot.element.html}</pre>
                    <h3>CSS rules</h3>
                    <pre>{screenshot.element.cssRules.length ? screenshot.element.cssRules.join('\n\n') : 'No accessible matching rules.'}</pre>
                    <h3>Computed styles</h3>
                    <pre>{Object.entries(screenshot.element.computedStyles).map(([name, value]) => `${name}: ${value};`).join('\n')}</pre>
                  </details>
                ) : <p className="k">No element was selected for this screenshot.</p>}
                <label className="feedback-field">
                  <span>What should change at this breakpoint?</span>
                  <textarea
                    value={feedback[screenshot.id] || ''}
                    onChange={(event) => onFeedbackChange(screenshot.id, event.target.value)}
                    placeholder="Example: Keep this button visible and align it below the heading without overlapping the image."
                  />
                </label>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
    {previewScreenshot && (
      <div id="modal-overlay" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPreviewId(null);
      }}>
        <div className="full-page-preview" role="dialog" aria-modal="true" aria-label={`Full-page preview at ${previewScreenshot.width} by ${previewScreenshot.height}`}>
          <div className="full-page-preview-heading">
            <div><strong>{previewScreenshot.width} × {previewScreenshot.height}</strong><span>{previewScreenshot.title}</span></div>
            <button className="modal-close" aria-label="Close full-page preview" onClick={() => setPreviewId(null)}>×</button>
          </div>
          <div className="full-page-preview-scroll">
            <img src={previewScreenshot.dataUrl} alt={`${previewScreenshot.title} full-page capture`} />
          </div>
        </div>
      </div>
    )}
    </>
  );
}
