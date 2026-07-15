/**
 * Blueprint Templates — Lightweight Structural Guides
 *
 * NOT full code. Only: design tokens + file structure + component guidance.
 * This gives the LLM enough direction to produce structured, consistent output
 * in a SINGLE call, without bloating the prompt with code it would ignore anyway.
 *
 * Key insight from experiments: Sending full template code (10KB+) crashes
 * the server and slows generation (50s+). Blueprints (1KB) are faster (13s)
 * and produce BETTER output because the LLM generates fresh code.
 */

import type { AppType } from './prompt-classifier';

// ── Types ──

export interface DesignTokens {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
}

export interface FileSpec {
  path: string;
  purpose: string;
}

export interface Blueprint {
  id: string;
  appType: AppType;
  designTokens: DesignTokens;
  fileStructure: FileSpec[];
  componentGuidance: string;
  /** Vite project template used as base (files copied before generation) */
  baseTemplate?: 'react' | 'vue' | 'nextjs';
}

// ── Blueprints ──

const blueprints: Blueprint[] = [
  {
    id: 'todo',
    appType: 'todo-app',
    baseTemplate: 'react',
    designTokens: {
      primary: '#18181b',
      accent: '#10b981',
      background: '#f9fafb',
      surface: '#ffffff',
      text: '#111827',
      textMuted: '#6b7280',
      border: '#e5e7eb',
    },
    fileStructure: [
      { path: 'src/App.jsx', purpose: 'Main app: todos state, filter state, CRUD handlers, localStorage persistence' },
      { path: 'src/components/Header.jsx', purpose: 'App title and subtitle' },
      { path: 'src/components/AddTodo.jsx', purpose: 'Input + submit button, controlled input, Enter key support, clear on submit' },
      { path: 'src/components/TodoList.jsx', purpose: 'Todo items with circular checkbox (accent when checked), strikethrough text, delete button visible on hover, empty state' },
      { path: 'src/components/FilterBar.jsx', purpose: 'Segmented control (All/Active/Completed) with bg-gray-100 container, active tab bg-white shadow-sm' },
      { path: 'src/components/Footer.jsx', purpose: 'Item count + clear completed link' },
    ],
    componentGuidance: `STRUCTURE:
- App manages: todos state [{id, text, completed}], filter state ('all'|'active'|'completed')
- Persist to localStorage via useEffect
- TodoList: circular checkbox button (accent bg when checked), text with line-through, delete (X) visible on hover via CSS group
- FilterBar: segmented control style — flex container bg-gray-100 rounded-lg p-1, active button bg-white shadow-sm rounded-md
- AddTodo: input + button side by side, rounded-lg, focus:ring-2 focus:ring-accent/50
- Empty state: centered text "No tasks yet" in muted color
- Layout: max-w-md mx-auto, centered vertically and horizontally, sticky footer at bottom`,
  },
  {
    id: 'dashboard',
    appType: 'dashboard',
    baseTemplate: 'react',
    designTokens: {
      primary: '#0f172a',
      accent: '#f59e0b',
      background: '#f1f5f9',
      surface: '#ffffff',
      text: '#0f172a',
      textMuted: '#64748b',
      border: '#e2e8f0',
    },
    fileStructure: [
      { path: 'src/App.jsx', purpose: 'Dashboard layout with header, stats grid, chart, and activity feed' },
      { path: 'src/components/Header.jsx', purpose: 'Dashboard title, subtitle, date range indicator, user avatar' },
      { path: 'src/components/StatsGrid.jsx', purpose: '4 stat cards (revenue, users, conversion, AOV) with metric, value, and % change indicator (green up / red down)' },
      { path: 'src/components/ChartSection.jsx', purpose: 'CSS-only bar chart with monthly data, hover tooltips, month labels on x-axis, value labels on bars' },
      { path: 'src/components/RecentActivity.jsx', purpose: 'Activity feed: avatar circle (first letter), name, action, relative timestamp' },
    ],
    componentGuidance: `STRUCTURE:
- Layout: max-w-7xl mx-auto, responsive grid
- StatsGrid: 4 cards in grid, each with label (muted), value (bold large), change % (green/red), hover:shadow-md
- ChartSection: CSS-only bar chart. Each bar = div with dynamic height via inline style. Hover shows tooltip. Amber/accent colored bars.
- RecentActivity: list of items. Each: avatar circle (bg-accent/10 text-accent), name (font-medium), action (muted), time (xs text)
- Use amber (#f59e0b) as the primary accent for all charts and highlights
- Cards: bg-white rounded-xl border border-slate-200 p-6`,
  },
  {
    id: 'landing',
    appType: 'landing-page',
    baseTemplate: 'react',
    designTokens: {
      primary: '#111827',
      accent: '#8b5cf6',
      background: '#ffffff',
      surface: '#f9fafb',
      text: '#111827',
      textMuted: '#6b7280',
      border: '#e5e7eb',
    },
    fileStructure: [
      { path: 'src/App.jsx', purpose: 'Page composition: Navbar → Hero → Features → Pricing → Testimonials → CTA → Footer' },
      { path: 'src/components/Navbar.jsx', purpose: 'Fixed top nav, backdrop-blur, logo left, nav links center, CTA right, mobile hamburger' },
      { path: 'src/components/Hero.jsx', purpose: 'Centered: badge pill above title, large h1, subtitle, 2 CTA buttons (primary filled + secondary outline)' },
      { path: 'src/components/Features.jsx', purpose: 'Section title + 6 feature cards (3-col grid). Each: emoji icon, title, 2-line description.' },
      { path: 'src/components/Pricing.jsx', purpose: '3 tiers (Free/Pro/Enterprise). Popular tier highlighted with accent bg. Feature checkmarks.' },
      { path: 'src/components/Testimonials.jsx', purpose: '3 cards with 5-star SVG ratings, quote, avatar circle, name, role' },
      { path: 'src/components/CTA.jsx', purpose: 'Full-width gradient banner (accent), white text, 2 buttons' },
      { path: 'src/components/Footer.jsx', purpose: '4-column link grid (Product, Company, Resources, Legal) + copyright' },
    ],
    componentGuidance: `STRUCTURE:
- Use violet (#8b5cf6) as accent. NEVER use default blue (#3B82F6) or indigo.
- Navbar: fixed top-0, bg-white/80 backdrop-blur-md, border-b, z-50
- Hero: pt-32 pb-20, centered text, badge (bg-accent/10 text-accent rounded-full), h1 text-4xl sm:text-5xl font-bold, subtitle text-lg text-gray-600, buttons gap-4
- Features: py-20 bg-gray-50, 6 cards in 3-col grid, each: text-3xl emoji, h3, p text-gray-600
- Pricing: 3 cards. Popular: accent bg, white text, shadow-xl. Others: white border. Include checkmarks for features.
- Testimonials: bg-gray-50, 5-star SVGs (fill current, amber-400), quote text, avatar (accent-100 bg, accent-600 text)
- CTA: bg-gradient-to-br from-accent-600 to-accent-700, rounded-2xl, white text
- Footer: border-t, 4 cols on md, copyright border-t pt-6
- Sections alternate white / gray-50 backgrounds`,
  },
  {
    id: 'calculator',
    appType: 'calculator',
    baseTemplate: 'react',
    designTokens: {
      primary: '#111827',
      accent: '#f97316',
      background: '#f9fafb',
      surface: '#ffffff',
      text: '#111827',
      textMuted: '#6b7280',
      border: '#e5e7eb',
    },
    fileStructure: [
      { path: 'src/App.jsx', purpose: 'Calculator layout: display area + button grid, state for expression and display value' },
      { path: 'src/components/Display.jsx', purpose: 'Dark bg (gray-900) display with expression line (muted) and result (large white text)' },
      { path: 'src/components/ButtonGrid.jsx', purpose: '4-column grid: C, DEL, %, /, 7-9, *, 4-6, -, 1-3, +, 0(span-2), ., =. Orange operators.' },
    ],
    componentGuidance: `STRUCTURE:
- Container: max-w-sm mx-auto, rounded-2xl shadow-lg, centered vertically in viewport
- Display: bg-gray-900 p-6, expression text-sm text-gray-400, result text-4xl font-light text-white
- Buttons: grid-cols-4 gap-2 p-3. Numbers: bg-gray-100 text-gray-900. Operators: bg-orange-500 text-white. = : bg-orange-500. C/DEL: bg-gray-200. 0: col-span-2.
- All buttons: rounded-xl, font-medium, active:scale-95 transition
- History panel: separate card below calculator showing past calculations`,
  },
  {
    id: 'form',
    appType: 'form',
    baseTemplate: 'react',
    designTokens: {
      primary: '#111827',
      accent: '#06b6d4',
      background: '#f9fafb',
      surface: '#ffffff',
      text: '#111827',
      textMuted: '#6b7280',
      border: '#e5e7eb',
    },
    fileStructure: [
      { path: 'src/App.jsx', purpose: 'Step wizard controller: current step, form data state, next/prev navigation' },
      { path: 'src/components/ProgressBar.jsx', purpose: 'Step names + animated progress bar (cyan accent), current step highlighted' },
      { path: 'src/components/StepPersonal.jsx', purpose: 'Step 1: Name, Email, Phone — labeled inputs with focus:ring-cyan-500/50' },
      { path: 'src/components/StepDetails.jsx', purpose: 'Step 2: Company, Role, Message textarea' },
      { path: 'src/components/StepReview.jsx', purpose: 'Step 3: key-value review of all entered data' },
      { path: 'src/components/Success.jsx', purpose: 'Green checkmark circle, "Submitted Successfully!" heading' },
    ],
    componentGuidance: `STRUCTURE:
- Use cyan (#06b6d4) as accent
- Container: max-w-lg mx-auto, centered vertically, white card rounded-xl shadow-sm border
- ProgressBar: step names at top, cyan progress bar, current step label highlighted
- Form inputs: w-full, px-4 py-2.5, rounded-lg, border-gray-200, focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500
- Review: simple key-value pairs with border-b dividers, label text-gray-500, value font-medium
- Success: green checkmark (bg-green-100 rounded-full), h2, subtitle
- Back/Continue buttons in footer area of card`,
  },
];

// ── Lookup functions ──

export function getBlueprint(appType: AppType): Blueprint | undefined {
  return blueprints.find(bp => bp.appType === appType);
}

export function getBlueprintById(id: string): Blueprint | undefined {
  return blueprints.find(bp => bp.id === id);
}

export function hasBlueprintFor(appType: AppType): boolean {
  return blueprints.some(bp => bp.appType === appType);
}