# Architecture Notes — palmkit.app

## Overview

palmkit.app is an AI-powered web development workspace that runs entirely in the browser. A user types a prompt, the app sends it to a user-configured LLM provider, the LLM streams back structured XML-like artifacts containing file actions (create/edit files, run shell commands), the client parses those actions, applies file changes into an in-browser WebContainer (a Node.js runtime emulating Linux), and finally renders the result in a live preview iframe.

The entire system is client-heavy: chat history lives in IndexedDB, API keys are stored in cookies/localStorage, the WebContainer boots in the browser, and the server is essentially a thin proxy that forwards requests to LLM providers using the AI SDK.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Remix v2 (React Router v7 pending) | File-based routing in `app/routes/` |
| Package Manager | pnpm 9.14.4 | `packageManager` field enforced |
| Build System | Vite 5 + Remix Vite plugin | `vite.config.ts` at root |
| Deployment Target | Cloudflare Pages (Wrangler) | `@remix-run/cloudflare`, `@remix-run/cloudflare-pages` |
| CSS | UnoCSS + SCSS modules + Tailwind-compatible reset | `uno.config.ts`, `app/styles/` |
| State Management | Nanostores (atoms/maps) + Zustand (settings only) | Most stores in `app/lib/stores/` |
| AI SDK | Vercel AI SDK (`ai` v4.3.16) | `useChat` hook on client, `streamText` on server |
| LLM Providers | 22 providers via `@ai-sdk/*` packages | Custom `BaseProvider` class hierarchy |
| In-Browser Runtime | WebContainer API v1.6.1-internal.1 | `@webcontainer/api` — boots a Node.js runtime in-browser |
| Terminal | xterm.js v5 | `@xterm/xterm` + fit addon |
| Code Editor | CodeMirror 6 | `@codemirror/*` packages |
| Persistence | IndexedDB (via raw IDB API) | `app/lib/persistence/db.ts` |
| API Key Storage | Cookies (`js-cookie`) + localStorage | Client-side only, sent as cookie header to server |
| UI Components | Radix UI primitives + custom | `@radix-ui/*` for dialogs, dropdowns, etc. |
| Animations | Framer Motion v11 | Chat transitions, workbench open/close |
| Drag & Drop | react-dnd + HTML5Backend | File tree, chat reordering |
| Electron Support | Electron v33 + electron-builder | `electron/` directory, optional desktop builds |
| Chat Export | JSZip + file-saver | Download project as ZIP |

---

## File Tree Summary

```
palmkit.app/
├── app/
│   ├── root.tsx                         # Remix root — Layout, theme, DndProvider, ToastContainer
│   ├── entry.client.tsx                 # Client-side Remix entry
│   ├── entry.server.tsx                 # Server-side Remix entry
│   ├── routes/
│   │   ├── _index.tsx                   # Landing page — Header + Chat
│   │   ├── chat.$id.tsx                 # Chat by ID (reuses _index)
│   │   ├── api.chat.ts                  # **CORE** — Chat API endpoint (streaming)
│   │   ├── api.models.ts               # Model listing API
│   │   ├── api.models.$provider.ts      # Per-provider model listing
│   │   ├── api.check-env-key.ts         # Check if env API key is set
│   │   ├── api.configured-providers.ts  # List providers configured on server
│   │   ├── api.enhancer.ts              # Prompt enhancement endpoint
│   │   ├── api.llmcall.ts               # Direct LLM call endpoint
│   │   ├── api.export-api-keys.ts       # Export API keys
│   │   ├── api.web-search.ts            # Web search endpoint
│   │   ├── api.github-*.ts             # GitHub integration APIs
│   │   ├── api.gitlab-*.ts             # GitLab integration APIs
│   │   ├── api.vercel-*.ts             # Vercel deployment APIs
│   │   ├── api.netlify-*.ts            # Netlify deployment APIs
│   │   ├── api.supabase*.ts            # Supabase integration APIs
│   │   ├── api.mcp-*.ts               # MCP (Model Context Protocol) APIs
│   │   ├── api.bug-report.ts           # Bug report submission
│   │   ├── api.health.ts               # Health check
│   │   ├── api.system.*.ts             # System diagnostics APIs
│   │   ├── api.update.ts               # Update check
│   │   ├── git.tsx                      # Git import route
│   │   ├── webcontainer.connect.$id.tsx # WebContainer connection route
│   │   └── webcontainer.preview.$id.tsx # WebContainer preview route
│   │
│   ├── components/
│   │   ├── chat/
│   │   │   ├── Chat.client.tsx          # **CORE** — Main chat logic (useChat, sendMessage, model/provider state)
│   │   │   ├── BaseChat.tsx             # Chat layout (sidebar + messages + input + workbench)
│   │   │   ├── BaseChat.module.scss     # Chat styles
│   │   │   ├── Messages.client.tsx      # Message list rendering
│   │   │   ├── AssistantMessage.tsx      # AI response rendering
│   │   │   ├── UserMessage.tsx           # User message rendering
│   │   │   ├── Artifact.tsx             # Artifact (file action group) rendering
│   │   │   ├── ChatBox.tsx              # Chat input area
│   │   │   ├── ModelSelector.tsx        # Model/provider selection dropdown
│   │   │   ├── APIKeyManager.tsx        # API key input/management per provider
│   │   │   ├── SendButton.client.tsx    # Send/stop button
│   │   │   ├── ExamplePrompts.tsx       # Example prompt suggestions
│   │   │   ├── StarterTemplates.tsx     # Starter template grid
│   │   │   ├── Markdown.tsx             # Markdown rendering in chat
│   │   │   ├── CodeBlock.tsx            # Code block rendering
│   │   │   ├── ProgressCompilation.tsx  # Progress indicators
│   │   │   ├── ThoughtBox.tsx           # Reasoning/thought display
│   │   │   ├── ChatAlert.tsx            # Action alert display
│   │   │   ├── LLMApiAlert.tsx          # LLM error alert display
│   │   │   ├── ToolInvocations.tsx      # MCP tool invocation display
│   │   │   ├── MCPTools.tsx             # MCP tools UI
│   │   │   ├── WebSearch.client.tsx     # Web search in chat
│   │   │   ├── SpeechRecognition.tsx    # Voice input
│   │   │   ├── ScreenshotStateManager.tsx # Screenshot capture state
│   │   │   ├── FilePreview.tsx          # File preview in chat
│   │   │   ├── DicussMode.tsx           # Discuss mode toggle
│   │   │   ├── SupabaseConnection.tsx   # Supabase connection UI
│   │   │   ├── SupabaseAlert.tsx        # Supabase alert display
│   │   │   ├── GitCloneButton.tsx       # Git clone import button
│   │   │   ├── ImportFolderButton.tsx   # Folder import button
│   │   │   ├── chatExportAndImport/     # Chat export/import buttons
│   │   │   └── NetlifyDeploymentLink.client.tsx / VercelDeploymentLink.client.tsx
│   │   │
│   │   ├── workbench/
│   │   │   ├── Workbench.client.tsx     # **CORE** — Right panel: code/diff/preview tabs
│   │   │   ├── EditorPanel.tsx          # CodeMirror editor panel
│   │   │   ├── Preview.tsx              # **CORE** — Live preview iframe with device frames
│   │   │   ├── Inspector.tsx            # Element inspector (Tap-to-Edit foundation)
│   │   │   ├── InspectorPanel.tsx       # Inspector panel UI
│   │   │   ├── ScreenshotSelector.tsx   # Screenshot selection
│   │   │   ├── FileTree.tsx             # Project file tree
│   │   │   ├── DiffView.tsx             # Diff view for file changes
│   │   │   ├── FileBreadcrumb.tsx       # Breadcrumb navigation
│   │   │   ├── Search.tsx               # File search
│   │   │   ├── PortDropdown.tsx         # Port selection for preview
│   │   │   ├── LockManager.tsx          # File lock management
│   │   │   ├── ExpoQrModal.tsx          # Expo QR code modal
│   │   │   └── terminal/
│   │   │       ├── Terminal.tsx          # **CORE** — xterm.js terminal component
│   │   │       ├── TerminalManager.tsx   # Terminal lifecycle management
│   │   │       ├── TerminalTabs.tsx      # Terminal tab UI
│   │   │       └── theme.ts             # Terminal theme
│   │   │
│   │   ├── editor/
│   │   │   └── codemirror/
│   │   │       ├── CodeMirrorEditor.tsx  # CodeMirror 6 wrapper
│   │   │       ├── cm-theme.ts           # Editor theme
│   │   │       ├── languages.ts          # Language support
│   │   │       ├── EnvMasking.ts         # Environment variable masking
│   │   │       └── BinaryContent.tsx     # Binary file display
│   │   │
│   │   ├── header/
│   │   │   └── Header.tsx               # Top header bar
│   │   │
│   │   ├── sidebar/
│   │   │   └── Menu.client.tsx          # **CORE** — Chat history sidebar
│   │   │
│   │   ├── deploy/                       # Deployment dialogs (GitHub, GitLab, Vercel, Netlify)
│   │   ├── git/                          # Git URL import
│   │   ├── ui/                           # Shared UI components (Button, Dialog, Tabs, etc.)
│   │   │
│   │   └── @settings/
│   │       ├── core/
│   │       │   ├── ControlPanel.tsx      # **CORE** — Settings dialog/modal
│   │       │   ├── types.ts             # Settings tab type definitions
│   │       │   └── constants.tsx         # Default tab configuration
│   │       ├── tabs/
│   │       │   ├── providers/
│   │       │   │   ├── cloud/CloudProvidersTab.tsx    # Cloud provider API key management
│   │       │   │   └── local/LocalProvidersTab.tsx    # Local provider (Ollama, LMStudio) management
│   │       │   ├── settings/SettingsTab.tsx           # App settings
│   │       │   ├── features/FeaturesTab.tsx           # Feature flags
│   │       │   ├── github/GitHubTab.tsx               # GitHub integration
│   │       │   ├── gitlab/GitLabTab.tsx               # GitLab integration
│   │       │   ├── vercel/VercelTab.tsx               # Vercel integration
│   │       │   ├── netlify/NetlifyTab.tsx              # Netlify integration
│   │       │   ├── supabase/SupabaseTab.tsx           # Supabase integration
│   │       │   ├── mcp/McpTab.tsx                     # MCP configuration
│   │       │   ├── profile/ProfileTab.tsx             # User profile
│   │       │   ├── data/DataTab.tsx                   # Data management
│   │       │   ├── event-logs/EventLogsTab.tsx        # Event logs
│   │       │   └── notifications/NotificationsTab.tsx  # Notifications
│   │       └── shared/                                 # Shared settings components
│   │
│   ├── lib/
│   │   ├── stores/
│   │   │   ├── chat.ts                  # Chat state (started, aborted, showChat)
│   │   │   ├── workbench.ts             # **CORE** — Workbench store (files, actions, previews, terminals, ZIP export)
│   │   │   ├── settings.ts             # **CORE** — Provider settings, API keys, tab configuration
│   │   │   ├── theme.ts                 # Theme store (dark/light)
│   │   │   ├── files.ts                 # File store (FileMap, reads from WebContainer)
│   │   │   ├── previews.ts             # Preview store (URLs, ports)
│   │   │   ├── terminal.ts             # Terminal store
│   │   │   ├── editor.ts               # Editor state
│   │   │   ├── streaming.ts            # Streaming state atom
│   │   │   ├── logs.ts                 # Event log store
│   │   │   ├── profile.ts              # User profile store
│   │   │   ├── mcp.ts                  # MCP store (Zustand)
│   │   │   ├── supabase.ts             # Supabase connection store
│   │   │   ├── github.ts               # GitHub store
│   │   │   ├── githubConnection.ts     # GitHub connection store
│   │   │   ├── gitlabConnection.ts     # GitLab connection store
│   │   │   ├── vercel.ts               # Vercel store
│   │   │   ├── netlify.ts              # Netlify store
│   │   │   ├── qrCodeStore.ts          # Expo QR code store
│   │   │   └── tabConfigurationStore.ts # Tab visibility store
│   │   │
│   │   ├── modules/
│   │   │   └── llm/
│   │   │       ├── manager.ts           # **CORE** — LLMManager singleton (provider registry)
│   │   │       ├── registry.ts          # Provider class exports
│   │   │       ├── base-provider.ts     # **CORE** — Abstract BaseProvider class
│   │   │       ├── types.ts             # ProviderInfo, ModelInfo types
│   │   │       └── providers/           # 22 provider implementations
│   │   │           ├── openai.ts
│   │   │           ├── anthropic.ts
│   │   │           ├── google.ts
│   │   │           ├── deepseek.ts
│   │   │           ├── groq.ts
│   │   │           ├── ollama.ts
│   │   │           ├── open-router.ts
│   │   │           ├── openai-like.ts
│   │   │           ├── lmstudio.ts
│   │   │           ├── mistral.ts
│   │   │           ├── cohere.ts
│   │   │           ├── perplexity.ts
│   │   │           ├── xai.ts
│   │   │           ├── together.ts
│   │   │           ├── huggingface.ts
│   │   │           ├── hyperbolic.ts
│   │   │           ├── amazon-bedrock.ts
│   │   │           ├── github.ts
│   │   │           ├── moonshot.ts
│   │   │           ├── cerebras.ts
│   │   │           ├── fireworks.ts
│   │   │           └── z-ai.ts
│   │   │
│   │   ├── .server/llm/                 # Server-only code (NOT sent to client)
│   │   │   ├── stream-text.ts           # **CORE** — Server-side streamText (calls AI SDK)
│   │   │   ├── constants.ts             # MAX_TOKENS, provider limits
│   │   │   ├── select-context.ts        # Context file selection for prompt
│   │   │   ├── create-summary.ts        # Chat summary generation
│   │   │   ├── switchable-stream.ts     # Custom streaming primitive
│   │   │   ├── stream-recovery.ts       # Stream timeout/recovery
│   │   │   └── utils.ts                 # Message parsing helpers
│   │   │
│   │   ├── runtime/
│   │   │   ├── action-runner.ts         # **CORE** — Executes file/shell actions in WebContainer
│   │   │   ├── message-parser.ts        # **CORE** — Parses XML-like <boltArtifact>/<boltAction> from LLM response
│   │   │   └── enhanced-message-parser.ts # Enhanced parser variant
│   │   │
│   │   ├── persistence/
│   │   │   ├── db.ts                    # IndexedDB operations (chats, snapshots)
│   │   │   ├── useChatHistory.ts        # Chat history hook
│   │   │   ├── chats.ts                # Chat CRUD operations
│   │   │   ├── localStorage.ts          # LocalStorage helpers
│   │   │   ├── lockedFiles.ts           # Locked files persistence
│   │   │   ├── ChatDescription.client.tsx # Chat description component
│   │   │   └── types.ts                 # Persistence types
│   │   │
│   │   ├── hooks/                        # React hooks
│   │   │   ├── useMessageParser.ts      # Message parser hook
│   │   │   ├── usePromptEnhancer.ts     # Prompt enhancement hook
│   │   │   ├── useShortcuts.ts          # Keyboard shortcuts
│   │   │   ├── useSettings.ts           # Settings hook
│   │   │   ├── useViewport.ts           # Viewport detection
│   │   │   ├── useChatHistory.ts        # (re-export from persistence)
│   │   │   ├── useGit.ts               # Git operations hook
│   │   │   ├── useGitHubAPI.ts          # GitHub API hook
│   │   │   ├── useGitLabAPI.ts          # GitLab API hook
│   │   │   ├── useSupabaseConnection.ts # Supabase connection hook
│   │   │   ├── useLocalProviders.ts     # Local provider health hook
│   │   │   ├── useLocalModelHealth.ts   # Local model health monitoring
│   │   │   ├── useNotifications.ts      # Notifications hook
│   │   │   ├── useSearchFilter.ts       # Search/filter hook
│   │   │   ├── useDataOperations.ts     # Data operations hook
│   │   │   ├── useConnectionStatus.ts   # Connection status hook
│   │   │   ├── useConnectionTest.ts     # Connection test hook
│   │   │   ├── useGitHubConnection.ts   # GitHub OAuth hook
│   │   │   ├── useGitLabConnection.ts   # GitLab OAuth hook
│   │   │   ├── useGitHubStats.ts        # GitHub stats hook
│   │   │   ├── useIndexedDB.ts          # IndexedDB hook
│   │   │   ├── useEditChatDescription.ts # Chat description editing
│   │   │   ├── StickToBottom.tsx         # Auto-scroll component
│   │   │   ├── useStickToBottom.tsx      # Auto-scroll hook
│   │   │   └── index.ts                 # useViewport default export
│   │   │
│   │   ├── webcontainer/
│   │   │   ├── index.ts                 # **CORE** — WebContainer boot + preview error handling
│   │   │   └── auth.client.ts           # WebContainer auth (if needed)
│   │   │
│   │   ├── services/
│   │   │   ├── mcpService.ts            # MCP (Model Context Protocol) service
│   │   │   ├── importExportService.ts   # Import/export service
│   │   │   ├── githubApiService.ts      # GitHub API service
│   │   │   ├── gitlabApiService.ts      # GitLab API service
│   │   │   └── localModelHealthMonitor.ts # Local model health monitor
│   │   │
│   │   ├── common/
│   │   │   ├── prompts/
│   │   │   │   ├── prompts.ts           # **CORE** — System prompt for LLM
│   │   │   │   ├── optimized.ts         # Optimized prompt variant
│   │   │   │   ├── new-prompt.ts        # New prompt template
│   │   │   │   └── discuss-prompt.ts    # Discuss mode system prompt
│   │   │   └── prompt-library.ts        # Prompt library registry
│   │   │
│   │   ├── api/                          # Client-side API helpers
│   │   │   ├── updates.ts               # Update check
│   │   │   ├── connection.ts            # Connection status
│   │   │   ├── debug.ts                 # Debug utilities
│   │   │   ├── notifications.ts         # Notification API
│   │   │   ├── features.ts              # Feature flags
│   │   │   └── cookies.ts               # Cookie helpers
│   │   │
│   │   ├── crypto.ts                     # Crypto utilities
│   │   ├── fetch.ts                      # Fetch wrapper
│   │   ├── security.ts                   # Security utilities
│   │   └── utils/
│   │       └── serviceErrorHandler.ts    # Service error handling
│   │
│   ├── types/
│   │   ├── actions.ts                    # Action types (BoltAction, ShellAction, FileAction, etc.)
│   │   ├── artifact.ts                   # Artifact types
│   │   ├── model.ts                      # Model/provider types
│   │   ├── template.ts                   # Template types
│   │   ├── terminal.ts                   # Terminal types
│   │   ├── context.ts                    # Context annotation types
│   │   ├── theme.ts                      # Theme types
│   │   ├── design-scheme.ts             # Design scheme types
│   │   ├── global.d.ts                   # Global type declarations
│   │   ├── GitHub.ts                     # GitHub types
│   │   ├── GitLab.ts                     # GitLab types
│   │   ├── supabase.ts                   # Supabase types
│   │   ├── vercel.ts                     # Vercel types
│   │   └── netlify.ts                    # Netlify types
│   │
│   ├── utils/
│   │   ├── constants.ts                  # **CORE** — WORK_DIR, PROVIDER_LIST, STARTER_TEMPLATES, DEFAULT_MODEL
│   │   ├── mobile.ts                     # isMobile() helper (640px breakpoint)
│   │   ├── classNames.ts                 # CSS class merge utility
│   │   ├── diff.ts                       # Diff computation
│   │   ├── path.ts                       # Path utilities (browser polyfill)
│   │   ├── shell.ts                      # BoltShell type (WebContainer shell)
│   │   ├── terminal.ts                   # Terminal utilities
│   │   ├── fileUtils.ts                  # File utilities
│   │   ├── fileLocks.ts                  # File lock utilities
│   │   ├── folderImport.ts              # Folder import utility
│   │   ├── selectStarterTemplate.ts      # Auto template selection
│   │   ├── sampler.ts                    # Message sampling utility
│   │   ├── debounce.ts                   # Debounce utility
│   │   ├── logger.ts                     # Scoped logger
│   │   ├── debugLogger.ts               # Debug logger
│   │   ├── markdown.ts                   # Markdown utilities (allowed HTML elements)
│   │   ├── stripIndent.ts                # String indentation utility
│   │   ├── formatSize.ts                 # File size formatting
│   │   ├── getLanguageFromExtension.ts   # Language detection from file extension
│   │   ├── os.ts                         # OS detection
│   │   ├── url.ts                        # URL utilities
│   │   ├── buffer.ts                     # Buffer utility
│   │   ├── promises.ts                   # Promise utilities
│   │   ├── stacktrace.ts                 # Stack trace cleaning
│   │   ├── unreachable.ts                # Unreachable code utility
│   │   ├── react.ts                      # React utilities
│   │   ├── projectCommands.ts            # Project command utilities
│   │   ├── githubStats.ts               # GitHub stats utilities
│   │   ├── gitlabStats.ts               # GitLab stats utilities
│   │   └── constants.ts                  # (also contains providerBaseUrlEnvKeys)
│   │
│   └── styles/
│       ├── index.scss                     # Global styles
│       ├── variables.scss                 # CSS variables
│       ├── animations.scss                # Animation styles
│       ├── z-index.scss                   # Z-index layers
│       ├── diff-view.css                  # Diff view styles
│       └── components/                    # Component-specific styles
│
├── electron/                              # Optional Electron desktop app
│   ├── main/                              # Main process
│   ├── preload/                           # Preload scripts
│   └── ...
│
├── public/                                # Static assets (favicons, provider icons)
├── icons/                                 # SVG icons for templates
├── docs/                                  # Documentation (MkDocs)
├── scripts/                               # Build/dev helper scripts
├── docker-compose.yaml                    # Docker configuration
├── Dockerfile                             # Docker build
├── wrangler.toml                          # Cloudflare Workers config
├── uno.config.ts                          # UnoCSS configuration
├── vite.config.ts                         # Vite configuration
├── tsconfig.json                          # TypeScript configuration
├── eslint.config.mjs                      # ESLint configuration
├── LICENSE                                # MIT License
└── package.json                           # Package manifest
```

---

## Key Runtime Flow

### Primary Flow: User Prompt to Preview

```
1. User types prompt in ChatBox (app/components/chat/ChatBox.tsx)
   │
2. sendMessage() in Chat.client.tsx wraps message with [Model: X] and [Provider: Y]
   │  Stores selection in cookies: selectedModel, selectedProvider
   │
3. useChat() hook (from @ai-sdk/react) POSTs to /api/chat
   │  Body includes: messages, apiKeys, files, promptId, contextOptimization, chatMode, designScheme, supabase, maxLLMSteps
   │
4. Server: app/routes/api.chat.ts
   │  ├── Parses cookies for apiKeys and providerSettings
   │  ├── Optional: Creates chat summary (create-summary.ts)
   │  ├── Optional: Selects context files (select-context.ts)
   │  ├── Calls streamText() (app/lib/.server/llm/stream-text.ts)
   │  │   ├── Extracts model + provider from last user message
   │  │   ├── Looks up provider via LLMManager / PROVIDER_LIST
   │  │   ├── Builds system prompt from PromptLibrary
   │  │   ├── Adds locked file restrictions to system prompt
   │  │   ├── Calls provider.getModelInstance() to get AI SDK model
   │  │   └── Calls _streamText() from Vercel AI SDK
   │  │
   │  └── Streams response back as SSE (Server-Sent Events)
   │      Uses SwitchableStream for multi-segment responses
   │      Includes progress annotations for UI feedback
   │
5. Client: useChat() receives streamed response
   │  Parsed by useMessageParser hook (app/lib/hooks/useMessageParser.ts)
   │  Which uses StreamingMessageParser (app/lib/runtime/message-parser.ts)
   │
6. MessageParser detects <boltArtifact> and <boltAction> tags
   │  ├── onArtifactOpen → creates artifact in WorkbenchStore
   │  ├── onActionOpen → adds action to ActionRunner
   │  ├── onActionStream → updates streaming content
   │  └── onActionClose → triggers action execution
   │
7. ActionRunner (app/lib/runtime/action-runner.ts) executes actions
   │  ├── File actions: writes files to WebContainer via fs
   │  ├── Shell actions: runs commands in WebContainer terminal
   │  └── Supabase actions: handles Supabase-specific operations
   │
8. WebContainer (app/lib/webcontainer/index.ts)
   │  ├── Files written appear in the in-browser filesystem
   │  ├── Shell commands run in xterm.js terminal
   │  └── Web server started by user's code triggers preview URL
   │
9. Preview (app/components/workbench/Preview.tsx)
   │  ├── Renders app in iframe pointing to WebContainer URL
   │  ├── Supports device frame simulation (iPhone, iPad, etc.)
   │  ├── Supports element inspector (Inspector.tsx) for Tap-to-Edit
   │  └── Supports screenshot capture
   │
10. User sees live preview and can iterate by sending more messages
```

### API Key Flow

```
1. User enters API key in APIKeyManager (app/components/chat/APIKeyManager.tsx)
   │  or in Settings > Cloud Providers tab
   │
2. Key saved to cookies via js-cookie: Cookies.set('apiKeys', JSON.stringify(keys))
   │  Also stored in React state (apiKeys) in Chat.client.tsx
   │
3. On each request, useChat() body includes apiKeys
   │  AND cookies are sent automatically in Cookie header
   │
4. Server api.chat.ts reads apiKeys from request body AND from cookies
   │  const apiKeys = JSON.parse(parseCookies(cookieHeader).apiKeys || '{}')
   │
5. apiKeys passed to streamText() → provider.getModelInstance()
   │  Each provider's getModelInstance() uses the API key to create the AI SDK client
   │
6. Environment variable API keys are checked server-side via api.check-env-key.ts
   │  These are set in .env.local and never sent to client
   │
7. Provider settings (enabled/disabled, base URL) stored in localStorage
   │  as 'provider_settings' and sent via cookies as 'providers'
   │
8. Server-side env keys take priority: if env key exists, user key still works
   │  but the env key is the "default" (checked via /api/check-env-key)
```

### Model Selection Flow

```
1. ModelSelector (app/components/chat/ModelSelector.tsx)
   │  Fetches model list from /api/models
   │  Uses LLMManager.getInstance().getModelList()
   │  Supports fuzzy search across all providers
   │
2. Model + Provider selection stored in cookies
   │  Cookies.set('selectedModel', model)
   │  Cookies.set('selectedProvider', provider.name)
   │
3. On message send, model+provider embedded in message content
   │  `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${message}`
   │
4. Server extracts from message in stream-text.ts
   │  const { model, provider, content } = extractPropertiesFromMessage(message)
   │
5. Dynamic model listing: providers can fetch models from their APIs
   │  LLMManager.updateModelList() → provider.getDynamicModels()
   │  Cached in provider.cachedDynamicModels
   │
6. Settings > Features > Context Optimization controls prompt optimization
   │  Settings > Features > Developer Mode shows additional options
   │
7. Default model: 'claude-3-5-sonnet-latest' (in app/utils/constants.ts)
   │  Default provider: first registered provider (usually OpenAI)
   │
8. Provider enable/disable: providersStore in app/lib/stores/settings.ts
   │  Local providers (Ollama, LMStudio, OpenAILike) disabled by default
   │  Auto-enabled if server detects them running
```

---

## Exact File Paths for Every Important Part

### Provider/API Key Configuration
- `app/components/chat/APIKeyManager.tsx` — Per-provider API key input widget
- `app/components/@settings/tabs/providers/cloud/CloudProvidersTab.tsx` — Cloud provider settings
- `app/components/@settings/tabs/providers/local/LocalProvidersTab.tsx` — Local provider settings
- `app/lib/stores/settings.ts` — Provider settings store (providersStore, updateProviderSettings)
- `app/routes/api.check-env-key.ts` — Server-side env key check
- `app/routes/api.configured-providers.ts` — Server-side configured providers list
- `app/routes/api.export-api-keys.ts` — API key export

### Model Selection
- `app/components/chat/ModelSelector.tsx` — Model/provider dropdown with fuzzy search
- `app/routes/api.models.ts` — Model listing API
- `app/routes/api.models.$provider.ts` — Per-provider model listing
- `app/lib/modules/llm/manager.ts` — LLMManager (model registry, dynamic model fetching)
- `app/utils/constants.ts` — DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST

### Chat UI
- `app/components/chat/BaseChat.tsx` — Main chat layout (sidebar + messages + workbench)
- `app/components/chat/Chat.client.tsx` — Chat logic (useChat, model state, send message)
- `app/components/chat/ChatBox.tsx` — Input area
- `app/components/chat/Messages.client.tsx` — Message list
- `app/components/chat/AssistantMessage.tsx` — AI message rendering
- `app/components/chat/UserMessage.tsx` — User message rendering
- `app/routes/_index.tsx` — Landing page route (Header + Chat)
- `app/routes/chat.$id.tsx` — Chat by ID route

### Prompt Submission
- `app/components/chat/Chat.client.tsx` — sendMessage() function
- `app/components/chat/SendButton.client.tsx` — Send/stop button
- `app/components/chat/SpeechRecognition.tsx` — Voice input

### AI Response Streaming
- `app/routes/api.chat.ts` — Server-side streaming endpoint
- `app/lib/.server/llm/stream-text.ts` — Core streamText function
- `app/lib/.server/llm/switchable-stream.ts` — Custom streaming primitive
- `app/lib/.server/llm/stream-recovery.ts` — Stream error recovery
- `app/lib/hooks/useMessageParser.ts` — Client-side message parsing hook

### Applying File Changes
- `app/lib/runtime/message-parser.ts` — Parses <boltArtifact>/<boltAction> XML tags from LLM output
- `app/lib/runtime/action-runner.ts` — Executes parsed actions (file writes, shell commands)
- `app/lib/stores/workbench.ts` — WorkbenchStore (coordinates file actions with WebContainer)
- `app/lib/stores/files.ts` — FilesStore (reads/writes files in WebContainer)

### Preview Panel
- `app/components/workbench/Preview.tsx` — Live preview iframe with device simulation
- `app/components/workbench/Workbench.client.tsx` — Workbench container (code/diff/preview tabs)
- `app/lib/stores/previews.ts` — Preview store (URLs, ports)
- `app/routes/webcontainer.preview.$id.tsx` — Preview route

### WebContainer Runtime
- `app/lib/webcontainer/index.ts` — WebContainer boot, preview error handling
- `app/lib/webcontainer/auth.client.ts` — WebContainer auth
- `app/routes/webcontainer.connect.$id.tsx` — WebContainer connection route

### Terminal/Logs
- `app/components/workbench/terminal/Terminal.tsx` — xterm.js terminal component
- `app/components/workbench/terminal/TerminalManager.tsx` — Terminal lifecycle
- `app/components/workbench/terminal/TerminalTabs.tsx` — Terminal tabs
- `app/lib/stores/terminal.ts` — Terminal store
- `app/lib/stores/logs.ts` — Event log store
- `app/utils/shell.ts` — BoltShell type (WebContainer shell interaction)

### Download/Export ZIP
- `app/lib/stores/workbench.ts` — `downloadZip()` method (uses JSZip + file-saver)

### Project Templates
- `app/utils/constants.ts` — STARTER_TEMPLATES array (14 templates)
- `app/components/chat/StarterTemplates.tsx` — Template selection grid
- `app/utils/selectStarterTemplate.ts` — Auto template selection logic
- `app/routes/api.github-template.ts` — GitHub template fetch

### Settings UI
- `app/components/@settings/core/ControlPanel.tsx` — Settings modal/dialog
- `app/components/@settings/tabs/settings/SettingsTab.tsx` — General settings
- `app/components/@settings/tabs/features/FeaturesTab.tsx` — Feature toggles
- `app/components/@settings/tabs/profile/ProfileTab.tsx` — Profile settings
- `app/lib/stores/settings.ts` — Settings store (useSettingsStore - Zustand)
- `app/components/header/Header.tsx` — Header with settings button

### Theme/Layout Components
- `app/lib/stores/theme.ts` — Theme store (dark/light)
- `app/styles/variables.scss` — CSS custom properties
- `app/styles/index.scss` — Global styles
- `app/styles/z-index.scss` — Z-index layers
- `app/components/ui/BackgroundRays/` — Background animation
- `app/components/ui/ThemeSwitch.tsx` — Theme toggle
- `app/root.tsx` — Root layout with theme initialization

### Inspector (Tap-to-Edit Foundation)
- `app/components/workbench/Inspector.tsx` — Element inspector component
- `app/components/workbench/InspectorPanel.tsx` — Inspector panel UI
- `app/public/inspector-script.js` — Inspector script injected into preview iframe

---

## Where Changes Should Be Made (and Where Not)

### SAFE to modify (for mobile-first / BYOK):
1. **`app/components/chat/BaseChat.tsx`** — Layout can be made responsive with CSS/UnoCSS
2. **`app/components/chat/BaseChat.module.scss`** — Style overrides for mobile
3. **`app/components/workbench/Workbench.client.tsx`** — Tab layout can be adapted for mobile
4. **`app/styles/`** — Global style additions for mobile breakpoints
5. **`app/uno.config.ts`** — UnoCSS breakpoint configuration
6. **`app/utils/mobile.ts`** — Extend mobile detection utilities
7. **`app/components/@settings/core/ControlPanel.tsx`** — Can add mobile-friendly layout
8. **New files in `app/components/mobile/`** — Mobile-specific shell components (safest approach)
9. **`app/lib/stores/settings.ts`** — Can add mobile-specific settings atoms
10. **`app/components/chat/ModelSelector.tsx`** — Can be adapted for mobile dropdown/sheet

### CAUTIOUS modification (understand dependencies first):
1. **`app/components/chat/Chat.client.tsx`** — Core chat logic; changes here affect everything
2. **`app/lib/stores/workbench.ts`** — Large file (760+ lines); tightly coupled to WebContainer
3. **`app/routes/api.chat.ts`** — Server-side streaming; breaking this breaks all chat
4. **`app/lib/modules/llm/`** — Provider system; adding providers is safe, modifying existing ones is risky
5. **`app/lib/runtime/action-runner.ts`** — Action execution; changes affect file/shell operations
6. **`app/components/chat/APIKeyManager.tsx`** — API key handling; security-sensitive
7. **`app/lib/persistence/`** — Data layer; schema changes need migration

### DO NOT modify yet (too risky for MVP):
1. **`app/lib/webcontainer/index.ts`** — WebContainer boot process; fragile
2. **`app/lib/.server/llm/stream-text.ts`** — Server streaming core; must remain stable
3. **`app/lib/runtime/message-parser.ts`** — XML parser; changing tag format breaks LLM interaction
4. **`app/lib/common/prompts/`** — System prompts; changing these changes LLM behavior
5. **`app/root.tsx`** — Root layout; changes affect entire app
6. **`vite.config.ts`** — Build configuration; must remain stable
7. **`@webcontainer/api`** version — Internal build, version-specific
8. **`app/types/actions.ts`** — Action type definitions; used everywhere

---

## Build & Run Commands

```bash
# Install
pnpm install

# Development server
pnpm run dev
# → http://localhost:5173/

# Build for production (may need NODE_OPTIONS="--max-old-space-size=4096")
pnpm run build

# Start production server (uses Wrangler)
pnpm run start

# Run tests
pnpm run test

# Lint
pnpm run lint
```

### Build Memory Issue

The production build can exceed Node's default heap limit. Fix:
```bash
NODE_OPTIONS="--max-old-space-size=4096" pnpm run build
```

This is documented in the verification section — it builds successfully with increased memory.
