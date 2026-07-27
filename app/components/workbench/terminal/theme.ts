import type { ITheme } from '@xterm/xterm';

const style = getComputedStyle(document.documentElement);
const cssVar = (token: string) => style.getPropertyValue(token) || undefined;

export function getTerminalTheme(overrides?: ITheme): ITheme {
  return {
    cursor: cssVar('--palmkit-elements-terminal-cursorColor'),
    cursorAccent: cssVar('--palmkit-elements-terminal-cursorColorAccent'),
    foreground: cssVar('--palmkit-elements-terminal-textColor'),
    background: cssVar('--palmkit-elements-terminal-backgroundColor'),
    selectionBackground: cssVar('--palmkit-elements-terminal-selection-backgroundColor'),
    selectionForeground: cssVar('--palmkit-elements-terminal-selection-textColor'),
    selectionInactiveBackground: cssVar('--palmkit-elements-terminal-selection-backgroundColorInactive'),

    // ansi escape code colors
    black: cssVar('--palmkit-elements-terminal-color-black'),
    red: cssVar('--palmkit-elements-terminal-color-red'),
    green: cssVar('--palmkit-elements-terminal-color-green'),
    yellow: cssVar('--palmkit-elements-terminal-color-yellow'),
    blue: cssVar('--palmkit-elements-terminal-color-blue'),
    magenta: cssVar('--palmkit-elements-terminal-color-magenta'),
    cyan: cssVar('--palmkit-elements-terminal-color-cyan'),
    white: cssVar('--palmkit-elements-terminal-color-white'),
    brightBlack: cssVar('--palmkit-elements-terminal-color-brightBlack'),
    brightRed: cssVar('--palmkit-elements-terminal-color-brightRed'),
    brightGreen: cssVar('--palmkit-elements-terminal-color-brightGreen'),
    brightYellow: cssVar('--palmkit-elements-terminal-color-brightYellow'),
    brightBlue: cssVar('--palmkit-elements-terminal-color-brightBlue'),
    brightMagenta: cssVar('--palmkit-elements-terminal-color-brightMagenta'),
    brightCyan: cssVar('--palmkit-elements-terminal-color-brightCyan'),
    brightWhite: cssVar('--palmkit-elements-terminal-color-brightWhite'),

    ...overrides,
  };
}
