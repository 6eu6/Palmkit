/**
 * ConnectorsPanel — unified MCP connector management.
 *
 * Opens from the sidebar "Context" button in any tab (chat/work/code).
 * Shows pre-defined MCP connectors with their original brand icons.
 * Users can connect/disconnect each connector directly — no need to
 * go to Settings → MCP tab and edit JSON.
 *
 * Each connector maps to an MCP server config. When connected, the MCP
 * service initializes the server and exposes its tools to the LLM.
 *
 * Connectors included:
 *   - GitHub (deepwiki MCP for repo analysis)
 *   - Supabase (database queries)
 *   - Vercel (deployments)
 *   - Netlify (deployments)
 *   - Filesystem (local file access)
 *   - Browser (Puppeteer for web scraping)
 *   - Memory (persistent context)
 *   - Everything (MCP test server)
 */

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { useMCPStore } from '~/lib/stores/mcp';
import type { MCPConfig, MCPServerConfig } from '~/lib/services/mcpService';

/* ────────────────────────────────────────────────────────────── */
/*  Connector definitions — each maps to an MCP server config     */
/* ────────────────────────────────────────────────────────────── */

export interface ConnectorDef {
  /** Unique key (matches MCP server name). */
  id: string;

  /** Display name. */
  name: string;

  /** Short description. */
  description: string;

  /** UnoCSS icon class (Phosphor or custom). */
  icon: string;

  /** Brand color for the icon background. */
  color: string;

  /** MCP server config to use when connected. */
  config: MCPServerConfig;

  /** Category for grouping. */
  category: 'development' | 'deployment' | 'data' | 'utility';

  /** Whether this connector requires an API key (shown in connect form). */
  requiresApiKey?: boolean;

  /** The env var name for the API key (if requiresApiKey). */
  apiKeyEnvVar?: string;

  /** Link to get an API key. */
  apiKeyLink?: string;
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: 'deepwiki',
    name: 'GitHub DeepWiki',
    description: 'Analyze any GitHub repository — read code, docs, and structure',
    icon: 'i-ph:github-logo',
    color: '#24292e',
    category: 'development',
    config: {
      type: 'streamable-http',
      url: 'https://mcp.deepwiki.com/mcp',
    },
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Query your Supabase database and manage data',
    icon: 'i-ph:database',
    color: '#3ecf8e',
    category: 'data',
    requiresApiKey: true,
    apiKeyEnvVar: 'SUPABASE_ACCESS_TOKEN',
    apiKeyLink: 'https://supabase.com/dashboard/account/tokens',
    config: {
      type: 'streamable-http',
      url: 'https://mcp.supabase.com/mcp',
    },
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Manage Vercel deployments and projects',
    icon: 'i-ph:triangle',
    color: '#000000',
    category: 'deployment',
    requiresApiKey: true,
    apiKeyEnvVar: 'VERCEL_API_KEY',
    apiKeyLink: 'https://vercel.com/account/tokens',
    config: {
      type: 'streamable-http',
      url: 'https://mcp.vercel.com/mcp',
    },
  },
  {
    id: 'netlify',
    name: 'Netlify',
    description: 'Deploy and manage Netlify sites',
    icon: 'i-ph:globe',
    color: '#00c7b7',
    category: 'deployment',
    requiresApiKey: true,
    apiKeyEnvVar: 'NETLIFY_API_KEY',
    apiKeyLink: 'https://app.netlify.com/user/applications',
    config: {
      type: 'streamable-http',
      url: 'https://mcp.netlify.com/mcp',
    },
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files on the server',
    icon: 'i-ph:folder-open',
    color: '#f59e0b',
    category: 'utility',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/project'],
    },
  },
  {
    id: 'browser',
    name: 'Browser (Puppeteer)',
    description: 'Navigate web pages, take screenshots, extract content',
    icon: 'i-ph:browser',
    color: '#3b82f6',
    category: 'utility',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent memory across conversations',
    icon: 'i-ph:brain',
    color: '#8b5cf6',
    category: 'utility',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
  {
    id: 'everything',
    name: 'MCP Test Server',
    description: 'Reference MCP server for testing tools',
    icon: 'i-ph:puzzle-piece',
    color: '#6b7280',
    category: 'utility',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    },
  },
];

const CATEGORY_LABELS: Record<ConnectorDef['category'], string> = {
  development: 'Development',
  deployment: 'Deployment',
  data: 'Data',
  utility: 'Utilities',
};

/* ────────────────────────────────────────────────────────────── */
/*  Panel component                                               */
/* ────────────────────────────────────────────────────────────── */

interface ConnectorsPanelProps {
  open: boolean;
  onClose: () => void;
}

function ConnectorsPanelImpl({ open, onClose }: ConnectorsPanelProps) {
  const mcpSettings = useMCPStore((s) => s.settings);
  const serverTools = useMCPStore((s) => s.serverTools);
  const isInitialized = useMCPStore((s) => s.isInitialized);
  const initialize = useMCPStore((s) => s.initialize);
  const updateSettings = useMCPStore((s) => s.updateSettings);

  const [connecting, setConnecting] = useState<string | null>(null);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isInitialized) {
      initialize().catch(() => undefined);
    }
  }, [isInitialized, initialize]);

  const connectedServers = mcpSettings.mcpConfig.mcpServers || {};
  const serverEntries = Object.entries(connectedServers);

  const isConnectorConnected = (id: string): boolean => {
    return id in connectedServers;
  };

  const getConnectorTools = (id: string): string[] => {
    const tools = serverTools[id];

    return tools ? Object.keys(tools) : [];
  };

  const handleConnect = async (connector: ConnectorDef) => {
    setConnecting(connector.id);

    try {
      const newConfig: MCPConfig = {
        mcpServers: {
          ...connectedServers,
          [connector.id]: connector.config,
        },
      };

      await updateSettings({
        ...mcpSettings,
        mcpConfig: newConfig,
      });
    } catch (err) {
      console.error('Failed to connect:', err);
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (connectorId: string) => {
    setConnecting(connectorId);

    try {
      const { [connectorId]: _, ...remaining } = connectedServers;
      void _;

      const newConfig: MCPConfig = {
        mcpServers: remaining,
      };

      await updateSettings({
        ...mcpSettings,
        mcpConfig: newConfig,
      });
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setConnecting(null);
    }
  };

  // Group connectors by category
  const grouped = CONNECTORS.reduce(
    (acc, c) => {
      if (!acc[c.category]) {
        acc[c.category] = [];
      }

      acc[c.category].push(c);

      return acc;
    },
    {} as Record<string, ConnectorDef[]>,
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200]"
          />

          {/* Panel — slides in from the right */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-palmkit-elements-background-depth-1 border-l border-palmkit-elements-borderColor z-[201] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-palmkit-elements-borderColor">
              <div className="flex items-center gap-2">
                <span className="i-ph:plugs-connected-duotone w-5 h-5 text-palmkit-elements-textPrimary" />
                <h2 className="text-sm font-semibold text-palmkit-elements-textPrimary">Connectors</h2>
                <span className="text-[10px] text-palmkit-elements-textTertiary">
                  ({serverEntries.length} connected)
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-palmkit-elements-background-depth-2 transition-colors"
              >
                <span className="i-ph:x w-4 h-4 text-palmkit-elements-textSecondary" />
              </button>
            </div>

            {/* Content — scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {Object.entries(grouped).map(([category, connectors]) => (
                <div key={category}>
                  {/* Category label */}
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-palmkit-elements-textTertiary mb-2">
                    {CATEGORY_LABELS[category as ConnectorDef['category']]}
                  </div>

                  {/* Connectors in this category */}
                  <div className="space-y-2">
                    {connectors.map((connector) => {
                      const isConnected = isConnectorConnected(connector.id);
                      const tools = getConnectorTools(connector.id);
                      const isConnecting = connecting === connector.id;

                      return (
                        <div
                          key={connector.id}
                          className={classNames(
                            'rounded-lg border p-3 transition-colors',
                            isConnected
                              ? 'border-palmkit-elements-button-success-background/40 bg-palmkit-elements-background-depth-2'
                              : 'border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 hover:bg-palmkit-elements-background-depth-3',
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {/* Icon */}
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${connector.color}20` }}
                            >
                              <span
                                className={classNames(connector.icon, 'w-5 h-5')}
                                style={{ color: connector.color }}
                              />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-palmkit-elements-textPrimary truncate">
                                  {connector.name}
                                </span>
                                {isConnected && (
                                  <span className="flex items-center gap-1 text-[10px] text-palmkit-elements-button-success-text">
                                    <span className="i-ph:check-circle-fill w-3 h-3" />
                                    Connected
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-palmkit-elements-textSecondary mt-0.5">
                                {connector.description}
                              </p>

                              {/* Tools preview (if connected) */}
                              {isConnected && tools.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {tools.slice(0, 5).map((tool) => (
                                    <span
                                      key={tool}
                                      className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-palmkit-elements-background-depth-3 text-palmkit-elements-textTertiary"
                                    >
                                      {tool}
                                    </span>
                                  ))}
                                  {tools.length > 5 && (
                                    <span className="text-[9px] text-palmkit-elements-textTertiary">
                                      +{tools.length - 5} more
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* API key input (if required and not connected) */}
                              {!isConnected && connector.requiresApiKey && (
                                <div className="mt-2">
                                  <input
                                    type="password"
                                    placeholder={`Enter ${connector.apiKeyEnvVar}`}
                                    value={apiKeyInputs[connector.id] || ''}
                                    onChange={(e) =>
                                      setApiKeyInputs((prev) => ({ ...prev, [connector.id]: e.target.value }))
                                    }
                                    className="w-full px-2 py-1 text-[11px] rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 text-palmkit-elements-textPrimary focus:outline-none focus:border-palmkit-elements-button-primary-background"
                                  />
                                  {connector.apiKeyLink && (
                                    <a
                                      href={connector.apiKeyLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[9px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textSecondary underline"
                                    >
                                      Get API key →
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Connect/Disconnect button */}
                            <button
                              onClick={() => (isConnected ? handleDisconnect(connector.id) : handleConnect(connector))}
                              disabled={isConnecting}
                              className={classNames(
                                'shrink-0 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors',
                                isConnected
                                  ? 'bg-palmkit-elements-button-danger-background text-palmkit-elements-button-danger-text hover:bg-palmkit-elements-button-danger-backgroundHover'
                                  : 'bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text hover:bg-palmkit-elements-button-primary-backgroundHover',
                                isConnecting && 'opacity-50 cursor-wait',
                              )}
                            >
                              {isConnecting ? (
                                <span className="i-ph:spinner w-3 h-3 inline-block animate-spin" />
                              ) : isConnected ? (
                                'Disconnect'
                              ) : (
                                'Connect'
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Custom MCP server link */}
              <div className="pt-4 border-t border-palmkit-elements-borderColor">
                <a
                  href="/settings#mcp"
                  onClick={(e) => {
                    e.preventDefault();
                    onClose();

                    // Open settings to MCP tab
                    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'mcp' } }));
                  }}
                  className="flex items-center gap-2 text-xs text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
                >
                  <span className="i-ph:plus-circle w-4 h-4" />
                  Add custom MCP server (advanced)
                </a>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export const ConnectorsPanel = memo(ConnectorsPanelImpl);
