/**
 * Creative tool renderers
 * ======================
 * Dispatcher for creative tools: generate_image, generate_video.
 * (screenshot is in the code category since it requires sandbox.)
 */

import { memo } from 'react';
import { ImageRenderer } from './ImageRenderer';
import { VideoRenderer } from './VideoRenderer';
import { GenericToolResult } from '~/components/chat/tool-results/shared/GenericToolResult';

interface CreativeRenderersProps {
  toolName: string;
  result: unknown;
  theme: 'light' | 'dark';
}

function CreativeRenderersImpl({ toolName, result, theme: _theme }: CreativeRenderersProps) {
  switch (toolName) {
    case 'generate_image':
      return <ImageRenderer result={result} theme={_theme} />;
    case 'generate_video':
      return <VideoRenderer result={result} theme={_theme} />;
    default:
      return <GenericToolResult result={result} toolName={toolName} />;
  }
}

export default memo(CreativeRenderersImpl);
