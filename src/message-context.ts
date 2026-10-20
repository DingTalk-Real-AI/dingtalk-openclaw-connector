import { MessageContextStore } from './messages/index.ts';

let store = new MessageContextStore();
export const getMessageContextStore = () => store;
export function initializeMessageContextStore(storePath: string): void {
  store = new MessageContextStore({ storePath });
}
