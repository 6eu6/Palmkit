/**
 * Code-mode tool renderers
 * =======================
 * Dispatcher for code-mode tools:
 *   - read_file, list_files, grep (file-map based)
 *   - run_shell, screenshot, read_sandbox_file (sandbox based)
 */

import { memo } from 'react';
import { ReadFileRenderer } from './ReadFileRenderer';
import { ListFilesRenderer } from './ListFilesRenderer';
import { GrepRenderer } from './GrepRenderer';
import { RunShellRenderer } from './RunShellRenderer';
import { ScreenshotRenderer } from './ScreenshotRenderer';
import { ReadSandboxFileRenderer } from './ReadSandboxFileRenderer';
import { GenericToolResult } from '~/components/chat/tool-results/shared/GenericToolResult';

interface CodeRenderersProps {
  toolName: string;
  result: unknown;
  theme: 'light' | 'dark';
}

function CodeRenderersImpl({ toolName, result, theme: _theme }: CodeRenderersProps) {
  switch (toolName) {
    case 'read_file':
      return <ReadFileRenderer result={result} theme={_theme} />;
    case 'list_files':
      return <ListFilesRenderer result={result} theme={_theme} />;
    case 'grep':
      return <GrepRenderer result={result} theme={_theme} />;
    case 'run_shell':
      return <RunShellRenderer result={result} theme={_theme} />;
    case 'screenshot':
      return <ScreenshotRenderer result={result} theme={_theme} />;
    case 'read_sandbox_file':
      return <ReadSandboxFileRenderer result={result} theme={_theme} />;
    default:
      return <GenericToolResult result={result} toolName={toolName} />;
  }
}

export default memo(CodeRenderersImpl);
