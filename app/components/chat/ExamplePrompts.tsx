import React from 'react';

const EXAMPLE_PROMPTS = [
  { text: 'Create a mobile app about bolt.diy', icon: 'i-ph:device-mobile' },
  { text: 'Build a todo app in React using Tailwind', icon: 'i-ph:check-square' },
  { text: 'Build a simple blog using Astro', icon: 'i-ph:article' },
  { text: 'Create a cookie consent form using Material UI', icon: 'i-ph:cookie' },
  { text: 'Make a space invaders game', icon: 'i-ph:game-controller' },
  { text: 'Make a Tic Tac Toe game in html, css and js only', icon: 'i-ph:grid-nine' },
];

export function ExamplePrompts(sendMessage?: { (event: React.UIEvent, messageInput?: string): void | undefined }) {
  return (
    <div
      id="examples"
      className="relative flex flex-col gap-9 w-full max-w-3xl mx-auto flex justify-center mt-4 sm:mt-6"
    >
      <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
        {EXAMPLE_PROMPTS.map((examplePrompt, index: number) => {
          return (
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
                px-2.5 py-1 sm:px-3.5 sm:py-1.5 text-[11px] sm:text-xs font-medium
                transition-all duration-200 ease-out
                hover:border-bolt-elements-borderColorActive
                hover:shadow-[0_0_16px_var(--bolt-glow-color)]
              `}
              style={{
                animation: `fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${index * 60}ms forwards`,
                opacity: 0,
              }}
            >
              <span className="flex items-center gap-1 sm:gap-1.5">
                <span
                  className={`${examplePrompt.icon} text-xs sm:text-sm opacity-60 group-hover:opacity-100 transition-opacity`}
                />
                {examplePrompt.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
