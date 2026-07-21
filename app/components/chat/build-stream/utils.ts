/**
 * Build stream utilities — emoji stripping + tool icon/label maps.
 *
 * Extracted from BuildStream.tsx during P4 decomposition.
 */

/**
 * Regex matching emoji + dingbats + variation selectors + arrows + misc
 * technical symbols. Unicode property escapes cover most pictographic ranges.
 */
export const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu;

/**
 * Strip emojis + collapse double spaces. Used by every rendered text in the
 * build stream so the UI stays clean regardless of what the worker (or legacy
 * events) put in message strings. Icons — not emojis — carry the semantics
 * of each row.
 */
export function stripEmoji(text: string): string {
  return (text ?? '')
    .replace(EMOJI_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Tool → icon for the live activity chip ("what is the agent literally doing
 * right now"). Mirrors the icons used elsewhere in the stream.
 */
export const LIVE_TOOL_ICON: Record<string, string> = {
  write_files: 'i-ph:pencil-simple-line-bold',
  write_file: 'i-ph:pencil-simple-line-bold',
  edit_file: 'i-ph:pencil-simple-line-bold',
  read_file: 'i-ph:eye-bold',
  list_files: 'i-ph:list-bullets-bold',
  search_code: 'i-ph:magnifying-glass-bold',
  run_shell: 'i-ph:terminal-bold',
  run_tests: 'i-ph:flask-bold',
  analyze_screenshot: 'i-ph:camera-bold',
  generate_image: 'i-ph:image-bold',
  generate_video: 'i-ph:film-strip-bold',
  update_todos: 'i-ph:list-checks-bold',
  spawn_subagent: 'i-ph:robot-bold',
  done: 'i-ph:flag-checkered-bold',
};

export const LIVE_TOOL_LABEL: Record<string, string> = {
  write_files: 'Writing',
  write_file: 'Writing',
  edit_file: 'Editing',
  read_file: 'Reading',
  list_files: 'Listing files',
  search_code: 'Searching',
  run_shell: 'Running',
  run_tests: 'Testing',
  analyze_screenshot: 'Taking a screenshot',
  generate_image: 'Generating image',
  generate_video: 'Generating video',
  update_todos: 'Updating plan',
  spawn_subagent: 'Delegating',
  done: 'Wrapping up',
};
