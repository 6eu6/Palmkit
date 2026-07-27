import React, { useState, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { sidebarModeStore, type SidebarMode } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';

interface ExamplePrompt {
  text: string;
  icon: string;
  mobile: boolean;
  category: 'website' | 'app' | 'game' | 'tool' | 'python' | 'chat' | 'work';

  /** Which sidebar modes should show this prompt. */
  modes: SidebarMode[];
}

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  // ── Code mode: build prompts (websites, apps, games, tools, python) ──
  {
    text: 'Build a dark SaaS landing page with pricing, features and testimonials sections',
    icon: 'i-ph:layout',
    mobile: false,
    category: 'website',
    modes: ['code'],
  },
  {
    text: 'Create a portfolio website with animated hero, project gallery and contact form',
    icon: 'i-ph:briefcase',
    mobile: true,
    category: 'website',
    modes: ['code'],
  },
  {
    text: 'Make a restaurant website with menu, reservations and about page',
    icon: 'i-ph:fork-knife',
    mobile: true,
    category: 'website',
    modes: ['code'],
  },
  {
    text: 'Build a minimal blog with dark mode, tags and reading time estimates',
    icon: 'i-ph:article',
    mobile: false,
    category: 'website',
    modes: ['code'],
  },
  {
    text: 'Build a Pomodoro timer with session history, streaks and dark mode',
    icon: 'i-ph:timer',
    mobile: true,
    category: 'app',
    modes: ['code'],
  },
  {
    text: 'Create a budget tracker with pie chart breakdown and monthly trends',
    icon: 'i-ph:chart-pie',
    mobile: true,
    category: 'app',
    modes: ['code'],
  },
  {
    text: 'Build a Kanban board with drag-and-drop cards and swimlanes',
    icon: 'i-ph:kanban',
    mobile: false,
    category: 'app',
    modes: ['code'],
  },
  {
    text: 'Make a recipe app where you can save, search and rate meals',
    icon: 'i-ph:cooking-pot',
    mobile: true,
    category: 'app',
    modes: ['code'],
  },
  {
    text: 'Make a classic Snake game with speed levels, high score and smooth animations',
    icon: 'i-ph:game-controller',
    mobile: false,
    category: 'game',
    modes: ['code'],
  },
  {
    text: 'Build a memory card matching game with emoji cards and flip animations',
    icon: 'i-ph:cards',
    mobile: true,
    category: 'game',
    modes: ['code'],
  },
  {
    text: 'Create 2048 puzzle game with slide animations and best score tracking',
    icon: 'i-ph:grid-four',
    mobile: true,
    category: 'game',
    modes: ['code'],
  },
  {
    text: 'Build a Tetris clone with hold piece, preview and level system',
    icon: 'i-ph:squares-four',
    mobile: false,
    category: 'game',
    modes: ['code'],
  },
  {
    text: 'Create a JSON formatter and validator with syntax highlighting and error messages',
    icon: 'i-ph:code',
    mobile: false,
    category: 'tool',
    modes: ['code'],
  },
  {
    text: 'Build a color palette generator with HEX, RGB, HSL and copy-to-clipboard',
    icon: 'i-ph:palette',
    mobile: true,
    category: 'tool',
    modes: ['code'],
  },
  {
    text: 'Make a Markdown editor with live preview, word count and export to HTML',
    icon: 'i-ph:pencil-simple',
    mobile: false,
    category: 'tool',
    modes: ['code'],
  },
  {
    text: 'Build a QR code generator that supports URLs, text and WiFi credentials',
    icon: 'i-ph:qr-code',
    mobile: true,
    category: 'tool',
    modes: ['code'],
  },
  {
    text: 'Build a FastAPI server with JWT auth, SQLite database and Swagger docs',
    icon: 'i-ph:lightning',
    mobile: false,
    category: 'python',
    modes: ['code'],
  },
  {
    text: 'Create a data visualization dashboard with pandas, matplotlib and a web UI',
    icon: 'i-ph:chart-bar',
    mobile: false,
    category: 'python',
    modes: ['code'],
  },

  // ── Chat mode: general questions ──────────────────────────────────────
  {
    text: 'Explain how React Server Components work',
    icon: 'i-ph:chat-circle',
    mobile: true,
    category: 'chat',
    modes: ['chat'],
  },
  {
    text: 'What are the latest trends in AI for 2025?',
    icon: 'i-ph:trend-up',
    mobile: true,
    category: 'chat',
    modes: ['chat'],
  },
  {
    text: 'Compare PostgreSQL vs MongoDB for a SaaS app',
    icon: 'i-ph:scales',
    mobile: false,
    category: 'chat',
    modes: ['chat'],
  },
  {
    text: 'How does machine learning work? Explain simply',
    icon: 'i-ph:brain',
    mobile: true,
    category: 'chat',
    modes: ['chat'],
  },

  // ── Work mode: documents, analysis, images ────────────────────────────
  {
    text: 'Create a PDF report about climate change impacts',
    icon: 'i-ph:file-pdf',
    mobile: true,
    category: 'work',
    modes: ['work'],
  },
  {
    text: 'Generate an AI image of a mountain landscape at sunset',
    icon: 'i-ph:image',
    mobile: true,
    category: 'work',
    modes: ['work'],
  },
  {
    text: 'Analyze this CSV data and give me insights: name,age,salary',
    icon: 'i-ph:chart-line-up',
    mobile: false,
    category: 'work',
    modes: ['work'],
  },
  {
    text: 'Create a Word document with a project proposal template',
    icon: 'i-ph:file-doc',
    mobile: true,
    category: 'work',
    modes: ['work'],
  },
  {
    text: 'Research the latest trends in microservices architecture',
    icon: 'i-ph:binoculars',
    mobile: false,
    category: 'work',
    modes: ['work'],
  },
  {
    text: 'Make a pie chart showing market share: Apple=40%, Samsung=30%, Others=30%',
    icon: 'i-ph:chart-pie',
    mobile: true,
    category: 'work',
    modes: ['work'],
  },
];

const CATEGORIES = [
  { key: 'all', label: 'All', icon: 'i-ph:squares-four' },
  { key: 'website', label: 'Website', icon: 'i-ph:globe' },
  { key: 'app', label: 'App', icon: 'i-ph:device-mobile' },
  { key: 'game', label: 'Game', icon: 'i-ph:game-controller' },
  { key: 'tool', label: 'Tool', icon: 'i-ph:wrench' },
  { key: 'python', label: 'Python', icon: 'i-ph:terminal-window' },
] as const;

type Category = (typeof CATEGORIES)[number]['key'];

export function ExamplePrompts({ onSelect }: { onSelect?: (text: string) => void }) {
  const sidebarMode = useStore(sidebarModeStore);
  const [activeCategory, setActiveCategory] = useState<Category>('all');

  // Filter prompts by current sidebar mode
  const modePrompts = useMemo(() => EXAMPLE_PROMPTS.filter((p) => p.modes.includes(sidebarMode)), [sidebarMode]);

  // Only show category filter in code mode (chat/work have fewer prompts)
  const showCategories = sidebarMode === 'code';

  const filtered = activeCategory === 'all' ? modePrompts : modePrompts.filter((p) => p.category === activeCategory);

  const mobileFiltered = filtered.filter((p) => p.mobile);
  const DESKTOP_LIMIT = 6;
  const desktopPrompts = filtered.slice(0, DESKTOP_LIMIT);

  // Don't render if no prompts for this mode
  if (modePrompts.length === 0) {
    return null;
  }

  return (
    <div id="examples" className="relative w-full max-w-3xl mx-auto mt-3 sm:mt-5">
      {/* Category filter — code mode only, desktop only */}
      {showCategories && (
        <div className="hidden sm:flex justify-center gap-1.5 mb-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={classNames(
                'flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all duration-150',
                activeCategory === cat.key
                  ? 'bg-[rgba(255,255,255,0.08)] text-gray-200 border border-[rgba(255,255,255,0.12)]'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent hover:border-[rgba(255,255,255,0.06)]',
              )}
            >
              <span className={`${cat.icon} text-xs`} />
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Mobile prompts */}
      <div className="flex flex-wrap justify-center gap-1.5 sm:hidden">
        {mobileFiltered.slice(0, 4).map((examplePrompt, index) => (
          <button
            key={index}
            onClick={() => {
              onSelect?.(examplePrompt.text);
            }}
            className={classNames(
              'flex items-center gap-1.5',
              'border rounded-lg px-2.5 py-1.5',
              'bg-[rgba(0,0,0,0.03)] border-[rgba(0,0,0,0.06)]',
              'text-[11px] font-medium text-gray-400',
              'hover:bg-[rgba(0,0,0,0.06)] hover:border-[rgba(0,0,0,0.10)] hover:text-gray-200',
              'active:scale-[0.97]',
              'transition-all duration-200',
            )}
          >
            <span className={`${examplePrompt.icon} text-gray-400/50 text-xs`} />
            {examplePrompt.text.length > 45 ? examplePrompt.text.slice(0, 42) + '…' : examplePrompt.text}
          </button>
        ))}
      </div>

      {/* Desktop prompts */}
      <div className="hidden sm:flex flex-wrap justify-center gap-2">
        {desktopPrompts.map((examplePrompt, index) => (
          <button
            key={`${sidebarMode}-${index}`}
            onClick={() => {
              onSelect?.(examplePrompt.text);
            }}
            className={classNames(
              'group relative overflow-hidden',
              'border rounded-full',
              'bg-[rgba(0,0,0,0.02)] border-[rgba(0,0,0,0.08)]',
              'text-gray-400 hover:text-gray-200',
              'px-3.5 py-1.5 text-xs font-medium',
              'transition-all duration-200 ease-out',
              'hover:bg-[rgba(0,0,0,0.06)] hover:border-[rgba(0,0,0,0.15)]',
              'hover:shadow-[0_0_16px_var(--palmkit-glow-color)]',
            )}
            style={{
              animation: `fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${index * 50}ms forwards`,
              opacity: 0,
            }}
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`${examplePrompt.icon} text-gray-400/50 text-sm opacity-70 group-hover:opacity-100 transition-opacity`}
              />
              {examplePrompt.text.length > 65 ? examplePrompt.text.slice(0, 62) + '…' : examplePrompt.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
