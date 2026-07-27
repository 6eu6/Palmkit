import { atom } from 'nanostores';

export const pendingEditPromptStore = atom<string | null>(null);

export interface QueuedEdit {
  selector: string;
  path: string;
  tagName: string;
  instruction: string;
  attachment: {
    name: string;
    type: string;
    size: number;
    dataUrl?: string;
    textContent?: string;
  } | null;
}
