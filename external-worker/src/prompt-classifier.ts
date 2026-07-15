/**
 * Prompt Complexity Classifier
 *
 * Classifies a user prompt to determine whether it should use the
 * fast single-call path or the full orchestrator (brain agent) path.
 *
 * Simple/medium prompts → fast-builder (1 LLM call, ~10-20s)
 * Complex prompts / edit mode → orchestrator (15-25 LLM calls, ~4-16 min)
 *
 * This is NOT a heuristic guess — it uses pattern matching on concrete
 * indicators of app complexity.
 */

export type Complexity = 'simple' | 'medium' | 'complex';
export type AppType =
  | 'landing-page' | 'todo-app' | 'dashboard' | 'form' | 'blog'
  | 'portfolio' | 'ecommerce' | 'calculator' | 'chat-ui' | 'data-table'
  | 'auth-page' | 'pricing-page' | 'gallery' | 'custom';

export interface PromptClassification {
  complexity: Complexity;
  appType: AppType;
  features: string[];
  shouldUseFastPath: boolean;
  /** If true, a blueprint template exists for this app type */
  hasBlueprint: boolean;
}

// ── App-type patterns (ordered by specificity — multi-word first) ──

const APP_TYPE_PATTERNS: [AppType, string[]][] = [
  ['landing-page', [
    'landing page', 'homepage', 'hero section', 'cta button', 'pricing table',
    'testimonials', 'features section', 'saas landing', 'product page',
    'marketing page', 'coming soon', 'splash page',
  ]],
  ['todo-app', [
    'todo', 'to-do', 'task list', 'task manager', 'checklist',
    'task tracker',
  ]],
  ['dashboard', [
    'dashboard', 'admin panel', 'analytics', 'chart', 'graph',
    'kpi', 'metrics', 'data visualization', 'stat', 'overview panel',
    'control panel', 'monitoring',
  ]],
  ['form', [
    'contact form', 'survey', 'questionnaire', 'registration form',
    'multi-step form', 'wizard form', 'signup form',
  ]],
  ['blog', [
    'blog', 'article', 'blog post', 'cms', 'news', 'publication',
  ]],
  ['portfolio', [
    'portfolio', 'showcase', 'work samples', 'projects showcase',
    'personal website',
  ]],
  ['ecommerce', [
    'ecommerce', 'e-commerce', 'shop', 'store', 'product catalog',
    'cart', 'shopping cart', 'checkout', 'marketplace',
  ]],
  ['calculator', [
    'calculator', 'converter', 'unit converter', 'price calculator',
  ]],
  ['chat-ui', [
    'chat interface', 'chat ui', 'messenger', 'messaging', 'chat bubble',
  ]],
  ['data-table', [
    'data table', 'spreadsheet', 'data grid', 'crud table', 'admin table',
  ]],
  ['auth-page', [
    'login page', 'signup page', 'sign up page', 'sign in page', 'register page',
    'auth page', 'authentication page',
  ]],
  ['pricing-page', [
    'pricing page', 'pricing plans', 'subscription page', 'plan comparison',
  ]],
  ['gallery', [
    'photo gallery', 'image gallery', 'image grid', 'masonry',
  ]],
  ['custom', []],
];

// ── Complexity indicators ──

const COMPLEXITY_COMPLEX = [
  'real-time', 'websocket', 'socket.io', 'drag and drop', 'drag & drop',
  'infinite scroll', 'virtualized', 'webgl', 'three.js', 'canvas animation',
  'audio processing', 'video processing', 'camera', 'microphone',
  'geolocation', 'payment processing', 'stripe payment', 'oauth flow',
  'jwt authentication', 'database schema', 'api integration',
  'rest api', 'graphql', 'redux', 'state management', 'multiple pages',
  'routing', 'animated', 'collaborative', 'live editing',
  'map', 'google maps', 'pdf generation', 'email sending',
  'web scraping', 'server-sent events', 'pwa', 'service worker',
  'indexeddb', 'web worker', 'complex animation', '3d',
];

const COMPLEXITY_SIMPLE = [
  'simple', 'basic', 'single page', 'static', 'one page',
  'display', 'show', 'list', 'card',
];

// ── Feature detection (used for telemetry, not routing) ──

const FEATURE_PATTERNS: [string, string[]][] = [
  ['dark-mode', ['dark mode', 'dark theme', 'toggle theme', 'theme switch', 'light mode']],
  ['responsive', ['responsive', 'mobile', 'mobile-first', 'adaptive', 'tablet']],
  ['search', ['search', 'filter', 'find', 'query']],
  ['sort', ['sort', 'order by', 'arrange']],
  ['pagination', ['pagination', 'per page', 'page size']],
  ['modal', ['modal', 'dialog', 'popup', 'overlay', 'lightbox']],
  ['notification', ['notification', 'toast', 'alert', 'snackbar']],
  ['tabs', ['tab', 'tabs']],
  ['accordion', ['accordion', 'collapsible', 'expandable', 'expand']],
  ['carousel', ['carousel', 'slider', 'swipe', 'swiper']],
  ['drag-drop', ['drag', 'drop', 'reorder']],
  ['local-storage', ['save', 'persist', 'local storage', 'remember', 'offline']],
  ['animation', ['animation', 'animate', 'transition', 'fade in', 'slide in']],
  ['form-validation', ['validate', 'validation', 'required field', 'error message']],
  ['image-upload', ['upload', 'image upload', 'file upload', 'drop zone', 'drag and drop upload']],
];

// ── App types that have blueprint templates ──

const BLUEPRINT_TYPES: Set<AppType> = new Set([
  'todo-app', 'dashboard', 'landing-page', 'calculator', 'form',
]);

// ── Main classifier ──

export function classifyPrompt(prompt: string): PromptClassification {
  const lower = prompt.toLowerCase();

  // ── 1. Detect app type ──
  let bestType: AppType = 'custom';
  let bestScore = 0;

  for (const [type, patterns] of APP_TYPE_PATTERNS) {
    let score = 0;
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        score += pattern.split(' ').length; // multi-word patterns score higher
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // ── 2. Count complexity indicators ──
  const complexHits = COMPLEXITY_COMPLEX.filter(k => lower.includes(k)).length;
  const simpleHits = COMPLEXITY_SIMPLE.filter(k => lower.includes(k)).length;

  // ── 3. Detect features ──
  const features: string[] = [];
  for (const [feature, keywords] of FEATURE_PATTERNS) {
    if (keywords.some(k => lower.includes(k))) {
      features.push(feature);
    }
  }

  // ── 4. Determine complexity ──
  let complexity: Complexity;

  if (complexHits >= 2 || (complexHits >= 1 && features.length >= 3)) {
    complexity = 'complex';
  } else if (simpleHits > complexHits && features.length <= 2 && prompt.length < 300) {
    complexity = 'simple';
  } else if (complexHits === 0 && features.length <= 2) {
    complexity = 'medium';
  } else {
    complexity = 'complex';
  }

  // ── 5. Routing decision ──
  // Use fast path for simple/medium prompts with a known app type that has a blueprint
  const hasBlueprint = BLUEPRINT_TYPES.has(bestType);
  const shouldUseFastPath = (complexity === 'simple' || complexity === 'medium') && hasBlueprint;

  return {
    complexity,
    appType: bestType,
    features,
    shouldUseFastPath,
    hasBlueprint,
  };
}