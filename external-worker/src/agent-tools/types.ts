/**
 * Agent tool type definitions.
 *
 * Extracted from agent-tools.ts during P4 decomposition to keep the
 * monolith's types reusable across submodules.
 */

/** Media configuration — routes image/video/vision API calls. */
export interface MediaConfig {
  // Image generation
  imageApiKey: string;
  imageModel: string;
  imageProvider: 'openrouter' | 'zai' | 'google';

  // Video generation
  videoApiKey: string;
  videoModel: string;
  videoProvider: 'zai' | 'openrouter' | 'google';

  // Vision (VLM for analyze_screenshot)
  visionApiKey: string;
  visionModel: string;
  visionProvider: 'zai' | 'openrouter' | 'google';

  // Legacy compat (some code still reads these)
  apiKey: string;
  model: string;
}

/** Per-job record of the last build/compile command run via run_shell. */
export interface BuildResult {
  command: string;
  passed: boolean;
  output: string; // trimmed stdout+stderr, enough to diagnose the failure
}
