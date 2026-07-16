import type { CdpApi } from './types';

declare global {
  interface Window {
    cdp: CdpApi;
  }
}

export {};
