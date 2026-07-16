export const RESOURCE_TYPES = ['all', 'XHR', 'Fetch', 'Document', 'Script', 'Stylesheet', 'Image', 'Font', 'WebSocket', 'Other'];
export const DETAIL_TABS = ['headers', 'request-body', 'response-body', 'timing', 'raw'] as const;
export const MAX_TARGET_LABEL_LENGTH = 100;

export type DetailTab = (typeof DETAIL_TABS)[number];
export type StatusKind = 'idle' | 'live' | 'error';
