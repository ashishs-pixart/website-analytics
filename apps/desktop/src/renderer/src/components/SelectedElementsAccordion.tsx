import type { ExtensionScreenshot } from '../types';
import { elementFeedbackId } from '../utils/inspectExport';
import { SelectedElementPreview } from './SelectedElementPreview';

type SelectedElementsAccordionProps = {
  screenshot: ExtensionScreenshot;
  feedback: Record<string, string>;
  onFeedbackChange: (id: string, value: string) => void;
  className?: string;
};

export function SelectedElementsAccordion({ screenshot, feedback, onFeedbackChange, className = '' }: SelectedElementsAccordionProps) {
  const elements = screenshot.elements?.length ? screenshot.elements : screenshot.element ? [screenshot.element] : [];
  if (!elements.length) return null;

  return (
    <details className={`selected-elements-panel ${className}`.trim()}>
      <summary>{elements.length} selected element{elements.length === 1 ? '' : 's'}</summary>
      <div className="selected-elements-accordion">
        {elements.map((element, index) => (
          <details key={`${element.selector}-${index}`}>
            <summary><code>{element.selector}</code></summary>
            <SelectedElementPreview element={element} screenshot={screenshot} />
            <label className="element-feedback-field">
              <span>What should change for this selected element?</span>
              <textarea
                value={feedback[elementFeedbackId(screenshot.id, index)] || ''}
                onChange={(event) => onFeedbackChange(elementFeedbackId(screenshot.id, index), event.target.value)}
                placeholder={`Describe the change needed for ${element.selector}...`}
              />
            </label>
          </details>
        ))}
      </div>
    </details>
  );
}
