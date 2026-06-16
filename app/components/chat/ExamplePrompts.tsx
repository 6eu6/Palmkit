import React from 'react';
import { classNames } from '~/utils/classNames';

const EXAMPLE_PROMPTS = [
  { text: 'Create a mobile app about Palmkit', icon: 'i-ph:device-mobile', mobile: true },
  { text: 'Build a todo app in React using Tailwind', icon: 'i-ph:check-square', mobile: true },
  { text: 'Build a simple blog using Astro', icon: 'i-ph:article', mobile: false },
  { text: 'Create a cookie consent form using Material UI', icon: 'i-ph:cookie', mobile: false },
  { text: 'Make a space invaders game', icon: 'i-ph:game-controller', mobile: true },
  { text: 'Make a Tic Tac Toe game in html, css and js only', icon: 'i-ph:grid-nine', mobile: false },
];

export function ExamplePrompts(sendMessage?: { (event: React.UIEvent, messageInput?: string): void | undefined }) {
  return (
    <div id="examples" className="relative w-full max-w-3xl mx-auto mt-3 sm:mt-5">
      {/* Mobile: show only mobile-friendly prompts */}
      <div className="flex flex-wrap justify-center gap-1.5 sm:hidden">
        {EXAMPLE_PROMPTS.filter((p) => p.mobile).map((examplePrompt, index: number) => (
          <button
            key={index}
            onClick={(event) => {
              sendMessage?.(event, examplePrompt.text);
            }}
            className={classNames(
              'flex items-center gap-1.5',
              'border rounded-lg px-2.5 py-1.5',
              'bg-[rgba(139,92,246,0.06)] border-[rgba(139,92,246,0.12)]',
              'text-[11px] font-medium text-purple-200/80',
              'hover:bg-[rgba(139,92,246,0.12)] hover:border-[rgba(139,92,246,0.2)] hover:text-purple-100',
              'active:scale-[0.97]',
              'transition-all duration-200',
            )}
          >
            <span className={`${examplePrompt.icon} text-purple-400/50 text-xs`} />
            {examplePrompt.text}
          </button>
        ))}
      </div>
      {/* Desktop: show all prompts */}
      <div className="hidden sm:flex flex-wrap justify-center gap-2">
        {EXAMPLE_PROMPTS.map((examplePrompt, index: number) => (
          <button
            key={index}
            onClick={(event) => {
              sendMessage?.(event, examplePrompt.text);
            }}
            className={classNames(
              'group relative overflow-hidden',
              'border rounded-full',
              'bg-[rgba(139,92,246,0.04)] border-[rgba(139,92,246,0.1)]',
              'text-purple-200/70 hover:text-purple-100',
              'px-3.5 py-1.5 text-xs font-medium',
              'transition-all duration-200 ease-out',
              'hover:bg-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.2)]',
              'hover:shadow-[0_0_16px_var(--palmkit-glow-color)]',
            )}
            style={{
              animation: `fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${index * 60}ms forwards`,
              opacity: 0,
            }}
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`${examplePrompt.icon} text-purple-400/50 text-sm opacity-70 group-hover:opacity-100 transition-opacity`}
              />
              {examplePrompt.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
