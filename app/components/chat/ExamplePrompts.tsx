import React from 'react';

const EXAMPLE_PROMPTS = [
  { text: 'Create a mobile app about bolt.diy', icon: 'i-ph:device-mobile', mobile: true },
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
            className={`
              border border-bolt-elements-borderColor rounded-full
              bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-button-primary-background
              text-bolt-elements-textSecondary hover:text-bolt-elements-button-primary-text
              px-2.5 py-1 text-[11px] font-medium
              transition-all duration-200 ease-out
              hover:border-bolt-elements-borderColorActive
              active:scale-[0.97]
            `}
          >
            <span className="flex items-center gap-1">
              <span className={`${examplePrompt.icon} text-xs opacity-60`} />
              {examplePrompt.text}
            </span>
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
            className={`
              group relative overflow-hidden
              border border-bolt-elements-borderColor rounded-full
              bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-button-primary-background
              text-bolt-elements-textSecondary hover:text-bolt-elements-button-primary-text
              px-3.5 py-1.5 text-xs font-medium
              transition-all duration-200 ease-out
              hover:border-bolt-elements-borderColorActive
              hover:shadow-[0_0_16px_var(--bolt-glow-color)]
            `}
            style={{
              animation: `fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${index * 60}ms forwards`,
              opacity: 0,
            }}
          >
            <span className="flex items-center gap-1.5">
              <span className={`${examplePrompt.icon} text-sm opacity-60 group-hover:opacity-100 transition-opacity`} />
              {examplePrompt.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
