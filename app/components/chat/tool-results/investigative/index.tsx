/**
 * Investigative tool renderers
 * ==========================
 * Dispatcher for investigative tools:
 *   - web_search, read_url, scrape_page, deep_search, read_and_extract
 */

import { memo } from 'react';
import { WebSearchRenderer } from './WebSearchRenderer';
import { ReadUrlRenderer } from './ReadUrlRenderer';
import { ScrapePageRenderer } from './ScrapePageRenderer';
import { DeepSearchRenderer } from './DeepSearchRenderer';
import { ReadAndExtractRenderer } from './ReadAndExtractRenderer';
import { GenericToolResult } from '~/components/chat/tool-results/shared/GenericToolResult';

interface InvestigativeRenderersProps {
  toolName: string;
  result: unknown;
  theme: 'light' | 'dark';
}

function InvestigativeRenderersImpl({ toolName, result, theme: _theme }: InvestigativeRenderersProps) {
  switch (toolName) {
    case 'web_search':
      return <WebSearchRenderer result={result} theme={_theme} />;
    case 'read_url':
      return <ReadUrlRenderer result={result} theme={_theme} />;
    case 'scrape_page':
      return <ScrapePageRenderer result={result} theme={_theme} />;
    case 'deep_search':
      return <DeepSearchRenderer result={result} theme={_theme} />;
    case 'read_and_extract':
      return <ReadAndExtractRenderer result={result} theme={_theme} />;
    default:
      return <GenericToolResult result={result} toolName={toolName} />;
  }
}

export default memo(InvestigativeRenderersImpl);
