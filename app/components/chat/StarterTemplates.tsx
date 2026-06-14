import React from 'react';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from '~/utils/constants';

interface FrameworkLinkProps {
  template: Template;
}

const FrameworkLink: React.FC<FrameworkLinkProps> = ({ template }) => (
  <a
    href={`/git?url=https://github.com/${template.githubRepo}.git`}
    data-state="closed"
    data-discover="true"
    className="group items-center justify-center"
  >
    <div className="relative flex flex-col items-center gap-1.5">
      <div
        className={`
          ${template.icon} w-9 h-9 text-3xl
          transition-all duration-300 ease-out
          grayscale opacity-60
          group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-110
          group-hover:drop-shadow-[0_0_8px_var(--bolt-glow-color)]
        `}
        title={template.label}
      />
      <span
        className="
        text-[10px] font-medium
        text-bolt-elements-textTertiary
        opacity-0 group-hover:opacity-100
        transition-all duration-200 ease-out
        translate-y-1 group-hover:translate-y-0
      "
      >
        {template.label}
      </span>
    </div>
  </a>
);

const StarterTemplates: React.FC = () => {
  return (
    <div
      className="flex flex-col items-center gap-3 sm:gap-4"
      style={{ animation: 'fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards', opacity: 0 }}
    >
      <span className="text-[10px] sm:text-xs font-medium text-bolt-elements-textTertiary uppercase tracking-wider">
        or start a blank app with your favorite stack
      </span>
      <div className="flex justify-center">
        <div className="flex flex-wrap justify-center items-start gap-3 sm:gap-5 max-w-xs sm:max-w-md">
          {STARTER_TEMPLATES.map((template) => (
            <FrameworkLink key={template.name} template={template} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default StarterTemplates;
