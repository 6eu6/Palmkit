/**
 * GenericToolResult
 * =================
 * Fallback renderer for unknown tools, error results, or while a
 * specialized renderer is loading.
 *
 * Renders the raw result as formatted JSON in a collapsible <details>
 * section. This preserves the behavior of the original ToolInvocations
 * component for backward compatibility.
 */

import { memo, useState } from 'react';

interface GenericToolResultProps {
  result: unknown;
  toolName: string;
  loading?: boolean;
  error?: string;
}

function GenericToolResultImpl({ result, toolName, loading, error }: GenericToolResultProps) {
  const [expanded, setExpanded] = useState(false);

  let formattedResult: string;

  if (typeof result === 'string') {
    // Try to parse as JSON for nicer formatting
    try {
      const parsed = JSON.parse(result);
      formattedResult = JSON.stringify(parsed, null, 2);
    } catch {
      formattedResult = result;
    }
  } else {
    try {
      formattedResult = JSON.stringify(result, null, 2);
    } catch {
      formattedResult = String(result);
    }
  }

  return (
    <div className="bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md">
      {loading && <div className="text-xs text-palmkit-elements-textSecondary mb-2 italic">Loading renderer…</div>}
      {error && (
        <div className="text-xs text-palmkit-elements-icon-error mb-2">
          Renderer error: {error}. Showing raw result.
        </div>
      )}
      <div className="text-xs text-palmkit-elements-textSecondary mb-1">Result ({toolName}):</div>
      <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
        {formattedResult}
      </pre>
      {formattedResult.length > 500 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary mt-1 underline"
        >
          {expanded ? 'Show less' : `Show all (${formattedResult.length} chars)`}
        </button>
      )}
    </div>
  );
}

export const GenericToolResult = memo(GenericToolResultImpl);
