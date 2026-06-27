import { atom } from 'nanostores';

/*
 * When InspectorPanel generates an edit prompt, it's written here.
 * Chat.client.tsx watches it and applies to setInput.
 */
export const pendingEditPromptStore = atom<string | null>(null);
