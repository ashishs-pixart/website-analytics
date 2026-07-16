import { useState } from 'react';
import type { ExtensionRecording, ExtensionState, NetworkRequest } from '../types';
import { formatBytes, formatMs, requestDuration } from '../utils/format';
import { meaningfulRequestInsights } from '../utils/inspectExport';
import { SelectedElementsAccordion } from './SelectedElementsAccordion';

type InspectDashboardProps = {
  state: ExtensionState;
  feedback: Record<string, string>;
  actionFeedback: Record<string, string>;
  elementFeedback: Record<string, string>;
  networkRequests: NetworkRequest[];
  onFeedbackChange: (id: string, value: string) => void;
  onActionFeedbackChange: (id: string, value: string) => void;
  onElementFeedbackChange: (id: string, value: string) => void;
  onRefresh: () => void;
  onClear: () => void;
  onSetupCopilot: () => void;
  copilotConfigured: boolean;
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

export function InspectDashboard({ state, feedback, actionFeedback, elementFeedback, networkRequests, onFeedbackChange, onActionFeedbackChange, onElementFeedbackChange, onRefresh, onClear, onSetupCopilot, copilotConfigured }: InspectDashboardProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [requestModal, setRequestModal] = useState<{ recording: ExtensionRecording; actionIndex: number } | null>(null);
  const previewScreenshot = state.screenshots.find((screenshot) => screenshot.id === previewId);
  const modalRequests = requestModal ? relatedRequests(requestModal.recording, requestModal.actionIndex, networkRequests) : [];
  const requestInsights = meaningfulRequestInsights(networkRequests);

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
          <button className="btn btn-primary" onClick={onSetupCopilot}>{copilotConfigured ? 'Show Copilot' : 'Setup Copilot'}</button>
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
                  <span><code>{recording.id}</code> · {recording.actions.length} action{recording.actions.length === 1 ? '' : 's'}{recording.summary ? ` · ${recording.summary.successfulActions} succeeded · ${recording.summary.failedActions} failed` : ''}</span>
                </summary>
                <ol>
                  {recording.actions.map((action, index) => {
                    const requests = relatedRequests(recording, index, networkRequests);
                    return (
                      <li key={action.id || `${recording.id}-${index}`}>
                        <div className="recorded-action-heading">
                          <code>{action.id || `${recording.id}-ACTION-${index + 1}`}</code>
                          <strong>{action.type}</strong>
                          <span className={`replay-outcome ${action.outcome || 'recorded'}`}>{action.outcome || 'recorded'}</span>
                          <span>{action.key ? `Key: ${action.key}` : action.text || action.selector}</span>
                          <small>{action.delayMs} ms after previous action</small>
                        </div>
                        {action.replayError && <p className="replay-error">Could not execute: {action.replayError}</p>}
                        {action.executionWarning && <p className="replay-error">Fallback used: {action.executionWarning}</p>}
                        {(action.executionMethod || action.resultUrl || action.urlCorrection) && (
                          <div className="replay-action-evidence">
                            {action.executionMethod && <small>Method: {action.executionMethod}{action.resolutionMethod ? ` · Located by ${action.resolutionMethod}` : ''}</small>}
                            {action.urlCorrection && <small>URL restored: {action.urlCorrection.fromUrl} → {action.urlCorrection.toUrl}{action.urlCorrection.succeeded ? '' : ` · failed: ${action.urlCorrection.error}`}</small>}
                            {action.expectedResultUrl && <small>Expected next URL: {action.expectedResultUrl}</small>}
                            {action.resultUrl && <small>Result URL: {action.resultUrl}{action.urlChanged ? ' · changed during this action' : ' · unchanged'}</small>}
                          </div>
                        )}
                        {requests.length > 0 ? <button className="show-requests-button" onClick={() => setRequestModal({ recording, actionIndex: index })}>Show requests ({requests.length})</button> : <p className="no-action-requests">No captured network requests after this action.</p>}
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
          <p>Select elements at any time. Start responsive simulation only when you want to capture the visible viewport at a breakpoint.</p>
        </section>
      ) : (
        <section className="screenshot-section">
          <div className="screenshot-section-heading"><div><h2>Responsive screenshots</h2><p>Breakpoint captures and visual change notes.</p></div><span>{state.screenshots.length}</span></div>
          <div className="screenshot-grid">
          {state.screenshots.map((screenshot) => (
            <article className="screenshot-card" key={screenshot.id}>
              <button className="screenshot-preview" onClick={() => setPreviewId(screenshot.id)} aria-label={`Open screenshot preview for ${screenshot.title || screenshot.url}`}>
                <img src={screenshot.dataUrl} alt={`${screenshot.title} at ${screenshot.width} by ${screenshot.height}`} />
                <span>{screenshot.width} × {screenshot.height}</span>
              </button>
              <div className="screenshot-content">
                <h2>{screenshot.title || 'Untitled page'}</h2>
                <div className="inspect-url" title={screenshot.url}>{screenshot.url}</div>
                <small>{new Date(screenshot.capturedAt).toLocaleString()}</small>
                <small>{screenshot.mimeType === 'image/jpeg' ? 'JPEG' : 'Image'}{screenshot.byteSize ? ` · ${formatBytes(screenshot.byteSize)}` : ''} · {screenshot.fullPage ? 'full page' : 'visible viewport'} {Math.round(screenshot.contentWidth || screenshot.width)} × {Math.round(screenshot.contentHeight || screenshot.height)}</small>
                {(screenshot.elements?.length || screenshot.element)
                  ? <SelectedElementsAccordion screenshot={screenshot} feedback={elementFeedback} onFeedbackChange={onElementFeedbackChange} />
                  : <p className="k">No element was selected for this screenshot.</p>}
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
          </div>
        </section>
      )}
    </main>
    {previewScreenshot && (
      <div id="modal-overlay" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPreviewId(null);
      }}>
        <div className="full-page-preview" role="dialog" aria-modal="true" aria-label={`Screenshot preview at ${previewScreenshot.width} by ${previewScreenshot.height}`}>
          <div className="full-page-preview-heading">
            <div><strong>{previewScreenshot.width} × {previewScreenshot.height}</strong><span>{previewScreenshot.title}</span></div>
            <button className="modal-close" aria-label="Close screenshot preview" onClick={() => setPreviewId(null)}>×</button>
          </div>
          <div className="full-page-preview-scroll">
            <img src={previewScreenshot.dataUrl} alt={`${previewScreenshot.title} visible viewport capture`} />
          </div>
          <SelectedElementsAccordion
            screenshot={previewScreenshot}
            feedback={elementFeedback}
            onFeedbackChange={onElementFeedbackChange}
            className="expanded-preview-elements"
          />
        </div>
      </div>
    )}
    {requestModal && (
      <div id="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRequestModal(null); }}>
        <div id="modal" className="event-requests-modal" role="dialog" aria-modal="true" aria-label="Requests after recorded event">
          <div className="modal-heading">
            <div><h2>Requests after event</h2><p className="modal-subtitle"><code>{requestModal.recording.actions[requestModal.actionIndex].id}</code> · {modalRequests.length} request{modalRequests.length === 1 ? '' : 's'}</p></div>
            <button className="modal-close" aria-label="Close requests" onClick={() => setRequestModal(null)}>×</button>
          </div>
          <div className="event-request-list">
            {modalRequests.map(request => (
              <article key={request.id}>
                <div><code>{request.method}</code><strong>{request.status || 'Pending'}</strong><span>{formatMs(requestDuration(request))}</span><span>{formatBytes(request.encodedDataLength)}</span></div>
                <p title={request.url}>{request.url}</p>
                {requestInsights.has(request.id) && <small className="request-insight">Meaningful: {requestInsights.get(request.id)?.join('; ')}</small>}
              </article>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
