import { useEffect } from 'react';
import type { ExtensionRecording, ExtensionScreenshot } from '../types';

type InspectExportModalProps = {
  screenshots: ExtensionScreenshot[];
  feedback: Record<string, string>;
  recordings: ExtensionRecording[];
  actionFeedback: Record<string, string>;
  exporting: boolean;
  onFeedbackChange: (id: string, value: string) => void;
  onActionFeedbackChange: (id: string, value: string) => void;
  onClose: () => void;
  onExport: () => void;
};

export function InspectExportModal({ screenshots, feedback, recordings, actionFeedback, exporting, onFeedbackChange, onActionFeedbackChange, onClose, onExport }: InspectExportModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exporting, onClose]);

  const reviewedCount = screenshots.filter((screenshot) => feedback[screenshot.id]?.trim()).length;
  const reviewedActionCount = recordings.flatMap((recording) => recording.actions).filter((action) => actionFeedback[action.id]?.trim()).length;
  const canExport = reviewedCount + reviewedActionCount > 0;

  return (
    <div id="modal-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !exporting) onClose();
    }}>
      <div id="modal" className="inspect-export-modal" role="dialog" aria-modal="true" aria-labelledby="inspect-export-title">
        <div className="modal-heading">
          <div>
            <h2 id="inspect-export-title">Create improvement prompt</h2>
            <p className="modal-subtitle">Describe the requested change for every screenshot you want included.</p>
          </div>
          <button className="modal-close" aria-label="Close improvement prompt" onClick={onClose} disabled={exporting}>×</button>
        </div>
        <div className="prompt-feedback-list">
          {screenshots.map((screenshot) => (
            <label className="prompt-feedback-item" key={screenshot.id}>
              <img src={screenshot.dataUrl} alt="" />
              <span>
                <strong>{screenshot.width} × {screenshot.height} · {screenshot.element?.selector || 'No element selected'}</strong>
                <textarea
                  value={feedback[screenshot.id] || ''}
                  onChange={(event) => onFeedbackChange(screenshot.id, event.target.value)}
                  placeholder="Describe the visual or layout change needed..."
                />
              </span>
            </label>
          ))}
        </div>
        {recordings.length > 0 && (
          <details className="prompt-action-feedback">
            <summary>Recorded event changes ({reviewedActionCount} included)</summary>
            {recordings.map((recording) => (
              <div className="prompt-recording" key={recording.id}>
                <h3>{recording.id}</h3>
                {recording.actions.map((action) => (
                  <label key={action.id}>
                    <strong><code>{action.id}</code> · {action.type} · {action.key || action.text || action.selector}</strong>
                    <textarea
                      value={actionFeedback[action.id] || ''}
                      onChange={(event) => onActionFeedbackChange(action.id, event.target.value)}
                      placeholder="Describe what should change for this event..."
                    />
                  </label>
                ))}
              </div>
            ))}
          </details>
        )}
        {!canExport && <p className="field-error">Enter feedback for at least one screenshot or recorded event.</p>}
        <div className="modal-actions">
          <span className="review-count">{reviewedCount} screenshot{reviewedCount === 1 ? '' : 's'}, {reviewedActionCount} event{reviewedActionCount === 1 ? '' : 's'} included</span>
          <button className="btn btn-ghost" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="btn btn-primary" onClick={onExport} disabled={!canExport || exporting}>{exporting ? 'Preparing...' : 'Export prompt'}</button>
        </div>
      </div>
    </div>
  );
}
