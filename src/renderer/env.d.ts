import type { NbApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    nb: NbApi;
  }
}

export {};
