import { useEffect, useRef, useState } from 'react';
import type { ExtensionRecording, ExtensionScreenshot, NetworkRequest } from '../types';
import { elementFeedbackId, meaningfulRequestInsights } from '../utils/inspectExport';

type InspectExportModalProps = {
  screenshots: ExtensionScreenshot[];
  feedback: Record<string, string>;
  recordings: ExtensionRecording[];
  actionFeedback: Record<string, string>;
  elementFeedback: Record<string, string>;
  exporting: boolean;
  includeMeaningfulRequests: boolean;
  networkRequests: NetworkRequest[];
  onIncludeMeaningfulRequestsChange: (value: boolean) => void;
  onFeedbackChange: (id: string, value: string) => void;
  onActionFeedbackChange: (id: string, value: string) => void;
  onElementFeedbackChange: (id: string, value: string) => void;
  onClose: () => void;
  onExport: (scope: { breakpoints: boolean; events: boolean }) => void;
  submitLabel?: string;
};

export function InspectExportModal({ screenshots, feedback, recordings, actionFeedback, elementFeedback, exporting, includeMeaningfulRequests, networkRequests, onIncludeMeaningfulRequestsChange, onFeedbackChange, onActionFeedbackChange, onElementFeedbackChange, onClose, onExport, submitLabel = 'Export prompt' }: InspectExportModalProps) {
  const [includeBreakpoints, setIncludeBreakpoints] = useState(true);
  const [includeEvents, setIncludeEvents] = useState(false);
  const eventsAccordionRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exporting, onClose]);

  const reviewedCount = screenshots.filter((screenshot) => {
    const elements = screenshot.elements?.length ? screenshot.elements : screenshot.element ? [screenshot.element] : [];
    return feedback[screenshot.id]?.trim() || elements.some((_element, index) => elementFeedback[elementFeedbackId(screenshot.id, index)]?.trim());
  }).length;
  const reviewedElementCount = Object.values(elementFeedback).filter(value => value.trim()).length;
  const reviewedActionCount = recordings.flatMap((recording) => recording.actions).filter((action) => actionFeedback[action.id]?.trim()).length;
  const totalEventCount = recordings.reduce((total, recording) => total + recording.actions.length, 0);
  const breakpointFeedbackCount = reviewedCount + reviewedElementCount;
  const canExport = (includeBreakpoints && breakpointFeedbackCount > 0) || (includeEvents && totalEventCount > 0);
  const meaningfulCount = meaningfulRequestInsights(networkRequests).size;

  return (
    <div id="modal-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !exporting) onClose();
    }}>
      <div id="modal" className="inspect-export-modal" role="dialog" aria-modal="true" aria-labelledby="inspect-export-title">
        <div className="modal-heading">
          <div>
            <h2 id="inspect-export-title">Create improvement prompt</h2>
            <p className="modal-subtitle">Choose breakpoint evidence, recorded journeys, replay results, or any combination.</p>
          </div>
          <button className="modal-close" aria-label="Close improvement prompt" onClick={onClose} disabled={exporting}>×</button>
        </div>
        <details className="export-scope-accordion" open>
          <summary>
            <label onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" checked={includeBreakpoints} onChange={(event) => setIncludeBreakpoints(event.target.checked)} disabled={exporting} />
              <span><strong>Export breakpoints</strong><small>{screenshots.length} captured breakpoint{screenshots.length === 1 ? '' : 's'} available · selected by default</small></span>
            </label>
          </summary>
          <div className={`prompt-feedback-list ${includeBreakpoints ? '' : 'scope-disabled'}`}>
          {screenshots.map((screenshot) => (
            <div className="prompt-feedback-item" key={screenshot.id}>
              <img src={screenshot.dataUrl} alt="" />
              <span>
                <strong>{screenshot.width} × {screenshot.height} · {(screenshot.elements?.length || (screenshot.element ? 1 : 0))} selected element{(screenshot.elements?.length || (screenshot.element ? 1 : 0)) === 1 ? '' : 's'}</strong>
                <textarea
                  value={feedback[screenshot.id] || ''}
                  onChange={(event) => onFeedbackChange(screenshot.id, event.target.value)}
                  placeholder="Describe the visual or layout change needed..."
                  disabled={!includeBreakpoints || exporting}
                />
                {(screenshot.elements?.length ? screenshot.elements : screenshot.element ? [screenshot.element] : []).map((element, index) => (
                  <label className="prompt-element-feedback" key={`${element.selector}-${index}`}>
                    <small><code>{element.selector}</code></small>
                    <textarea
                      value={elementFeedback[elementFeedbackId(screenshot.id, index)] || ''}
                      onChange={(event) => onElementFeedbackChange(elementFeedbackId(screenshot.id, index), event.target.value)}
                      placeholder="Describe the change for this selected element..."
                      disabled={!includeBreakpoints || exporting}
                    />
                  </label>
                ))}
              </span>
            </div>
          ))}
          </div>
        </details>
        {recordings.length > 0 && (
          <details className="prompt-action-feedback export-scope-accordion" ref={eventsAccordionRef}>
            <summary>
              <label onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={includeEvents} onChange={(event) => {
                  setIncludeEvents(event.target.checked);
                  if (event.target.checked && eventsAccordionRef.current) eventsAccordionRef.current.open = true;
                }} disabled={exporting} />
                <span><strong>Export events and replays</strong><small>Includes all {totalEventCount} events from {recordings.length} recording/replay session{recordings.length === 1 ? '' : 's'} · change notes are optional</small></span>
              </label>
            </summary>
            <div className={includeEvents ? '' : 'scope-disabled'}>
            {recordings.map((recording) => (
              <div className="prompt-recording" key={recording.id}>
                <h3>{recording.id}</h3>
                {recording.actions.map((action) => (
                  <label key={action.id}>
                    <strong><code>{action.id}</code> · {action.type} · {action.key || action.text || action.selector}</strong>
                    <textarea
                      value={actionFeedback[action.id] || ''}
                      onChange={(event) => onActionFeedbackChange(action.id, event.target.value)}
                      placeholder="Optional: describe what should change for this event..."
                      disabled={!includeEvents || exporting}
                    />
                  </label>
                ))}
              </div>
            ))}
            </div>
          </details>
        )}
        <label className={`meaningful-request-option ${includeEvents ? '' : 'scope-disabled'}`}>
          <input
            type="checkbox"
            checked={includeMeaningfulRequests}
            onChange={(event) => onIncludeMeaningfulRequestsChange(event.target.checked)}
            disabled={!includeEvents || !meaningfulCount || exporting}
          />
          <span><strong>Include meaningful request analysis</strong><small>{meaningfulCount ? `${meaningfulCount} slow, failed, or repeated equivalent request${meaningfulCount === 1 ? '' : 's'} will be included.` : 'No slow, failed, or repeated equivalent requests were found.'}</small></span>
        </label>
        {!includeBreakpoints && !includeEvents && <p className="field-error">Select at least one export section.</p>}
        {(includeBreakpoints || includeEvents) && !canExport && <p className="field-error">The selected sections do not contain exportable breakpoint feedback or journey events.</p>}
        <div className="modal-actions">
          <span className="review-count">{includeBreakpoints ? reviewedCount : 0} screenshot{reviewedCount === 1 ? '' : 's'}, {includeBreakpoints ? reviewedElementCount : 0} element note{reviewedElementCount === 1 ? '' : 's'}, {includeEvents ? totalEventCount : 0} event{totalEventCount === 1 ? '' : 's'} · {includeEvents ? reviewedActionCount : 0} change note{reviewedActionCount === 1 ? '' : 's'}</span>
          <button className="btn btn-ghost" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onExport({ breakpoints: includeBreakpoints, events: includeEvents })} disabled={!canExport || exporting}>{exporting ? 'Preparing...' : submitLabel}</button>
        </div>
      </div>
    </div>
  );
}
