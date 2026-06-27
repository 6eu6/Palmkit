import React, { useState } from 'react';
import { classNames } from '~/utils/classNames';

interface ExamplePrompt {
  text: string;
  icon: string;
  mobile: boolean;
  category: 'website' | 'app' | 'game' | 'tool' | 'python';
}

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  // Websites
  {
    text: 'Build a dark SaaS landing page with pricing, features and testimonials sections',
    icon: 'i-ph:layout',
    mobile: false,
    category: 'website',
  },
  {
    text: 'Create a portfolio website with animated hero, project gallery and contact form',
    icon: 'i-ph:briefcase',
    mobile: true,
    category: 'website',
  },
  {
    text: 'Make a restaurant website with menu, reservations and about page',
    icon: 'i-ph:fork-knife',
    mobile: true,
    category: 'website',
  },
  {
    text: 'Build a minimal blog with dark mode, tags and reading time estimates',
    icon: 'i-ph:article',
    mobile: false,
    category: 'website',
  },

  // Apps
  {
    text: 'Build a Pomodoro timer with session history, streaks and dark mode',
    icon: 'i-ph:timer',
    mobile: true,
    category: 'app',
  },
  {
    text: 'Create a budget tracker with pie chart breakdown and monthly trends',
    icon: 'i-ph:chart-pie',
    mobile: true,
    category: 'app',
  },
  {
    text: 'Build a Kanban board with drag-and-drop cards and swimlanes',
    icon: 'i-ph:kanban',
    mobile: false,
    category: 'app',
  },
  {
    text: 'Make a recipe app where you can save, search and rate meals',
    icon: 'i-ph:cooking-pot',
    mobile: true,
    category: 'app',
  },

  // Games
  {
    text: 'Make a classic Snake game with speed levels, high score and smooth animations',
    icon: 'i-ph:game-controller',
    mobile: false,
    category: 'game',
  },
  {
    text: 'Build a memory card matching game with emoji cards and flip animations',
    icon: 'i-ph:cards',
    mobile: true,
    category: 'game',
  },
  {
    text: 'Create 2048 puzzle game with slide animations and best score tracking',
    icon: 'i-ph:grid-four',
    mobile: true,
    category: 'game',
  },
  {
    text: 'Build a Tetris clone with hold piece, preview and level system',
    icon: 'i-ph:squares-four',
    mobile: false,
    category: 'game',
  },

  // Tools
  {
    text: 'Create a JSON formatter and validator with syntax highlighting and error messages',
    icon: 'i-ph:code',
    mobile: false,
    category: 'tool',
  },
  {
    text: 'Build a color palette generator with HEX, RGB, HSL and copy-to-clipboard',
    icon: 'i-ph:palette',
    mobile: true,
    category: 'tool',
  },
  {
    text: 'Make a Markdown editor with live preview, word count and export to HTML',
    icon: 'i-ph:pencil-simple',
    mobile: false,
    category: 'tool',
  },
  {
    text: 'Build a QR code generator that supports URLs, text and WiFi credentials',
    icon: 'i-ph:qr-code',
    mobile: true,
    category: 'tool',
  },

  // Python
  {
    text: 'Build a FastAPI server with JWT auth, SQLite database and Swagger docs',
    icon: 'i-ph:lightning',
    mobile: false,
    category: 'python',
  },
  {
    text: 'Create a data visualization dashboard with pandas, matplotlib and a web UI',
    icon: 'i-ph:chart-bar',
    mobile: false,
    category: 'python',
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

export function ExamplePrompts(sendMessage?: { (event: React.UIEvent, messageInput?: string): void | undefined }) {
  const [activeCategory, setActiveCategory] = useState<Category>('all');

  const filtered =
    activeCategory === 'all' ? EXAMPLE_PROMPTS : EXAMPLE_PROMPTS.filter((p) => p.category === activeCategory);

  const mobileFiltered = filtered.filter((p) => p.mobile);
  const DESKTOP_LIMIT = 6;
  const desktopPrompts = filtered.slice(0, DESKTOP_LIMIT);

  return (
    <div id="examples" className="relative w-full max-w-3xl mx-auto mt-3 sm:mt-5">
      {/* Category filter — desktop only */}
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

      {/* Mobile prompts */}
      <div className="flex flex-wrap justify-center gap-1.5 sm:hidden">
        {mobileFiltered.slice(0, 4).map((examplePrompt, index) => (
          <button
            key={index}
            onClick={(event) => {
              sendMessage?.(event, examplePrompt.text);
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
            key={`${activeCategory}-${index}`}
            onClick={(event) => {
              sendMessage?.(event, examplePrompt.text);
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
