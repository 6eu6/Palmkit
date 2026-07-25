import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import type { DesignScheme } from '~/types/design-scheme';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import type { Messages } from '~/lib/.server/llm/stream-text';
import { orchestrateStream } from '~/lib/.server/llm/stream-v2/orchestrator';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

const logger = createScopedLogger('api.chat');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

/**
 * Generate a short request ID for tool-call tracing.
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const {
    messages,
    files,
    promptId,
    contextOptimization,
    supabase,
    chatMode,
    sidebarMode,
    designScheme,
    maxLLMSteps,
    memoryBlock,
  } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
    chatMode: 'discuss' | 'build';
    sidebarMode?: 'chat' | 'work' | 'code';
    designScheme?: DesignScheme;
    supabase?: {
      isConnected: boolean;
      hasSelectedProject: boolean;
      credentials?: {
        anonKey?: string;
        supabaseUrl?: string;
      };
    };
    maxLLMSteps: number;
    memoryBlock?: string;
  }>();

  const cookieHeader = request.headers.get('Cookie');
  let apiKeys: Record<string, string> = {};
  let providerSettings: Record<string, IProviderSetting> = {};

  try {
    apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  } catch {
    logger.warn('Malformed apiKeys cookie — treating as empty');
  }

  try {
    providerSettings = JSON.parse(parseCookies(cookieHeader || '').providers || '{}');
  } catch {
    logger.warn('Malformed providers cookie — treating as empty');
  }

  // Get sandbox ID from environment (set when a sandbox is active)
  const sandboxId = (context as any)?.cloudflare?.env?.CURRENT_SANDBOX_ID as string | undefined;

  try {
    /*
     * ── Stream v2: delegate everything to the orchestrator ──────
     *
     * The old api.chat.ts had 900+ lines of inline orchestration:
     *   - MCP message processing
     *   - Context optimization (createSummary, selectContext)
     *   - Tool building (mode-aware)
     *   - Stream recovery (timeout detection)
     *   - Build orchestrator (complex prompt decomposition)
     *   - Main generation loop (while + validation + continue)
     *   - Error handling (per-status-code messages)
     *
     * All of that is now in stream-v2/orchestrator.ts — a clean,
     * mode-aware, testable function. api.chat.ts is now just:
     *   1. Parse request + cookies
     *   2. Call orchestrateStream()
     *   3. Return the response
     *
     * The orchestrator handles ALL mode-specific behavior via
     * resolveStreamModeConfig() — no scattered if/else checks.
     */

    const { response } = await orchestrateStream({
      messages,
      files,
      chatMode,
      sidebarMode,
      apiKeys,
      providerSettings,
      promptId,
      contextOptimization,
      supabase,
      maxLLMSteps,
      memoryBlock,
      designScheme,
      sandboxId,
      env: context.cloudflare?.env,
      requestId: generateRequestId(),
    });

    return response;
  } catch (error: any) {
    logger.error('chat stream error:', error);

    const errorResponse = {
      error: true,
      message: error.message || 'An unexpected error occurred',
      statusCode: error.statusCode || 500,
      isRetryable: error.isRetryable !== false,
      provider: error.provider || 'unknown',
    };

    if (error.message?.includes('API key')) {
      return new Response(
        JSON.stringify({
          ...errorResponse,
          message: 'Invalid or missing API key',
          statusCode: 401,
          isRetryable: false,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Unauthorized',
        },
      );
    }

    return new Response(JSON.stringify(errorResponse), {
      status: errorResponse.statusCode,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Error',
    });
  }
}
