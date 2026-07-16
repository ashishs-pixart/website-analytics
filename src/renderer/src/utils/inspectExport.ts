import type { ExtensionRecording, ExtensionScreenshot, NetworkRequest } from '../types';
import { requestDuration } from './format';

function fenced(value: string, language = '') {
  return `\`\`\`${language}\n${value.trim() || '(not captured)'}\n\`\`\``;
}

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

export function makeInspectPrompt(
  screenshots: ExtensionScreenshot[],
  feedback: Record<string, string>,
  recordings: ExtensionRecording[] = [],
  actionFeedback: Record<string, string> = {},
  networkRequests: NetworkRequest[] = [],
) {
  const reviewed = screenshots.filter((screenshot) => feedback[screenshot.id]?.trim());
  const sections = reviewed.map((screenshot, index) => {
    const element = screenshot.element;
    const css = element
      ? [
        ...element.cssRules,
        `Computed styles:\n${Object.entries(element.computedStyles).map(([name, value]) => `${name}: ${value};`).join('\n')}`,
      ].filter(Boolean).join('\n\n')
      : '(No element was selected for this screenshot.)';

    return [
      `## ${index + 1}. Breakpoint ${screenshot.width}×${screenshot.height}`,
      `- Page: ${screenshot.title || '(untitled)'}`,
      `- URL: ${screenshot.url}`,
      `- Captured: ${screenshot.capturedAt}`,
      `- Element selector: ${element?.selector || '(none)'}`,
      '',
      '### HTML element',
      fenced(element?.html || '(No element selected.)', 'html'),
      '',
      '### CSS',
      fenced(css, 'css'),
      '',
      '### Requested change',
      feedback[screenshot.id].trim(),
    ].join('\n');
  });

  const actionSections = recordings.flatMap((recording) => recording.actions.map((action, actionIndex) => {
    const requestedChange = actionFeedback[action.id]?.trim();
    if (!requestedChange) return null;
    const requests = relatedRequests(recording, actionIndex, networkRequests);
    const requestEvidence = requests.length
      ? requests.map((request) => {
        const duration = requestDuration(request);
        const bodyEvidence = request.bodyCache == null
          ? 'response body not loaded'
          : `response sample: ${JSON.stringify(request.bodyCache.slice(0, 2000))}`;
        return `- ${request.method} ${request.url} → ${request.status ?? 'pending'}${duration == null ? '' : ` in ${Math.round(duration)} ms`}; ${request.encodedDataLength || 0} bytes; ${request.mimeType || 'unknown type'}; ${bodyEvidence}`;
      }).join('\n')
      : '- No network requests were captured in this action window.';

    return [
      `## Recording event ${action.id}`,
      `- Recording ID: ${recording.id}`,
      `- Session kind: ${recording.kind || 'recording'}`,
      `- Source recording: ${recording.sourceRecordingId || '(original)'}`,
      `- Event: ${action.type}`,
      `- Selector: ${action.selector}`,
      `- Page: ${action.pageUrl || recording.url}`,
      `- Input/key: ${action.key || action.value || '(none)'}`,
      '',
      '### Network requests after this event',
      requestEvidence,
      '',
      '### Requested change for this event',
      requestedChange,
    ].join('\n');
  }).filter((section): section is string => Boolean(section)));

  return [
    '# Responsive website improvement request',
    '',
    'Use the breakpoint-specific evidence below to update the website. Preserve behavior at other breakpoints, prefer maintainable CSS, and explain any tradeoffs or assumptions.',
    '',
    ...sections,
    ...(actionSections.length ? ['', '# Recorded journey changes', '', ...actionSections] : []),
    '',
    '## Expected response',
    'Propose the smallest safe HTML/CSS changes, identify the files or selectors to update, and include a verification checklist for every breakpoint above.',
  ].join('\n');
}
