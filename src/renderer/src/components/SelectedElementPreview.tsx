import type { ElementMetadata, ExtensionScreenshot } from '../types';

type SelectedElementPreviewProps = {
  element: ElementMetadata;
  screenshot: ExtensionScreenshot;
};

export function SelectedElementPreview({ element, screenshot }: SelectedElementPreviewProps) {
  const rect = element.rect;
  if (!rect?.visible || rect.width <= 0 || rect.height <= 0) {
    return (
      <div className="selected-element-preview unavailable">
        <div><strong>Element preview unavailable</strong><small>The element was outside the captured viewport. Capture again while it is visible.</small></div>
      </div>
    );
  }

  const viewportWidth = screenshot.contentWidth || rect.viewportWidth || screenshot.width;
  const viewportHeight = screenshot.contentHeight || rect.viewportHeight || screenshot.height;
  const padding = Math.max(16, Math.min(80, Math.max(rect.width, rect.height) * 0.3));
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const width = Math.min(viewportWidth - x, rect.width + padding * 2);
  const height = Math.min(viewportHeight - y, rect.height + padding * 2);

  return (
    <div className="selected-element-preview">
      <div><strong>Selected area</strong><small>Screenshot crop — not included in export</small></div>
      <svg viewBox={`${x} ${y} ${Math.max(1, width)} ${Math.max(1, height)}`} role="img" aria-label={`Screenshot crop of ${element.selector}`} preserveAspectRatio="xMidYMid meet">
        <image href={screenshot.dataUrl} x="0" y="0" width={viewportWidth} height={viewportHeight} />
        <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="none" stroke="#26c6da" strokeWidth={Math.max(2, Math.min(width, height) / 100)} />
      </svg>
    </div>
  );
}
