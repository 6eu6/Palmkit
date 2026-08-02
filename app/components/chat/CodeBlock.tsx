/**
 * CodeBlock — kibo-ui style code display with syntax highlighting.
 *
 * Features:
 *   - Language badge (top-left)
 *   - Copy button (top-right, always visible)
 *   - Syntax highlighting via shiki
 *   - Preview tab for frontend code (html, css, jsx, tsx, js)
 *   - Collapsible for long code (>20 lines)
 *   - Clean monochrome design matching Palmkit's aesthetic
 */

import { memo, useEffect, useState, type FormEvent } from 'react';
import { bundledLanguages, codeToHtml, isSpecialLang, type BundledLanguage, type SpecialLanguage } from 'shiki';
import { classNames } from '~/utils/classNames';
import { createScopedLogger } from '~/utils/logger';

import './CodeBlock.module.scss';

const logger = createScopedLogger('CodeBlock');

interface CodeBlockProps {
  className?: string;
  code: string;
  language?: BundledLanguage | SpecialLanguage;
  theme?: 'light-plus' | 'dark-plus';
  disableCopy?: boolean;
}

type Tab = 'code' | 'preview';

const PREVIEWABLE_LANGUAGES = new Set(['jsx', 'tsx', 'html', 'css', 'javascript']);

function isPreviewable(language: string): boolean {
  return PREVIEWABLE_LANGUAGES.has(language.toLowerCase());
}

function buildPreviewHtml(code: string, language: string): string {
  if (language === 'html') {
    return code;
  }

  if (language === 'css') {
    return `<!DOCTYPE html><html><head><style>${code}</style></head><body><div style="padding:20px;font-family:sans-serif;"><h2>CSS Preview</h2><p>Sample text with the applied styles.</p><button>Button</button><input placeholder="Input" /></div></body></html>`;
  }

  const isTsx = language === 'tsx';
  const babelPreset = isTsx ? 'react,typescript' : 'react';

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}#root{padding:16px;}</style><script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script></head><body><div id="root"></div><script type="text/babel" data-presets="${babelPreset}">${code.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
}

// Collapsible threshold (lines)
const COLLAPSE_THRESHOLD = 20;

export const CodeBlock = memo(
  ({ className, code, language = 'plaintext', theme = 'dark-plus', disableCopy = false }: CodeBlockProps) => {
    const [html, setHTML] = useState<string | undefined>(undefined);
    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('code');
    const [expanded, setExpanded] = useState(true);

    const languageStr = String(language);
    const canPreview = isPreviewable(languageStr);
    const lineCount = code.split('\n').length;
    const shouldCollapse = lineCount > COLLAPSE_THRESHOLD;

    const copyToClipboard = () => {
      if (copied) {
        return;
      }

      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    useEffect(() => {
      let effectiveLanguage = language;

      if (language && !isSpecialLang(language) && !(language in bundledLanguages)) {
        logger.warn(`Unsupported language '${language}', falling back to plaintext`);
        effectiveLanguage = 'plaintext';
      }

      const processCode = async () => {
        setHTML(await codeToHtml(code, { lang: effectiveLanguage, theme }));
      };
      processCode();
    }, [code, language, theme]);

    const handleTabChange = (tab: Tab) => (e: FormEvent) => {
      e.preventDefault();
      setActiveTab(tab);
    };

    const previewHtml = canPreview ? buildPreviewHtml(code, languageStr) : '';

    // If no preview support, render clean code block with header
    if (!canPreview) {
      return (
        <div
          className={classNames(
            'relative group text-left my-2 rounded-lg overflow-hidden border border-palmkit-elements-borderColor',
            className,
          )}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-palmkit-elements-background-depth-2 border-b border-palmkit-elements-borderColor">
            <span className="text-[10px] font-mono text-palmkit-elements-textTertiary uppercase tracking-wider">
              {languageStr}
            </span>
            {!disableCopy && (
              <button
                onClick={() => copyToClipboard()}
                className="flex items-center gap-1 text-[11px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary transition-colors"
                title="Copy code"
              >
                <span
                  className={
                    copied
                      ? 'i-ph:check inline-block w-3.5 h-3.5 text-emerald-500'
                      : 'i-ph:copy inline-block w-3.5 h-3.5'
                  }
                />
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {/* Code content — collapsible if long */}
          <div
            className={classNames('relative overflow-auto', {
              'max-h-[400px]': shouldCollapse && !expanded,
            })}
          >
            <div dangerouslySetInnerHTML={{ __html: html ?? '' }} />
            {shouldCollapse && !expanded && (
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-palmkit-elements-background-depth-1 to-transparent pointer-events-none" />
            )}
          </div>
          {/* Expand/collapse button */}
          {shouldCollapse && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full py-1.5 text-[11px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary transition-colors border-t border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2"
            >
              {expanded ? '▲ Collapse' : `▼ Show all ${lineCount} lines`}
            </button>
          )}
        </div>
      );
    }

    // With preview support: render tabs
    return (
      <div
        className={classNames(
          'relative text-left my-2 rounded-lg overflow-hidden border border-palmkit-elements-borderColor',
          className,
        )}
      >
        {/* Tab header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleTabChange('code')}
              className={classNames(
                'px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                activeTab === 'code'
                  ? 'bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text'
                  : 'text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary',
              )}
            >
              <span className="i-ph:code inline-block w-3 h-3 align-middle mr-1" />
              Code
            </button>
            <button
              type="button"
              onClick={handleTabChange('preview')}
              className={classNames(
                'px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                activeTab === 'preview'
                  ? 'bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text'
                  : 'text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary',
              )}
            >
              <span className="i-ph:eye inline-block w-3 h-3 align-middle mr-1" />
              Preview
            </button>
            <span className="ml-2 text-[10px] font-mono text-palmkit-elements-textTertiary uppercase tracking-wider">
              {languageStr}
            </span>
          </div>
          {!disableCopy && (
            <button
              type="button"
              onClick={() => copyToClipboard()}
              className="flex items-center gap-1 text-[11px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary transition-colors"
              title="Copy code"
            >
              <span
                className={
                  copied ? 'i-ph:check inline-block w-3.5 h-3.5 text-emerald-500' : 'i-ph:copy inline-block w-3.5 h-3.5'
                }
              />
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        {/* Tab content */}
        {activeTab === 'code' ? (
          <div
            className={classNames('overflow-auto', {
              'max-h-[400px]': shouldCollapse && !expanded,
            })}
          >
            <div dangerouslySetInnerHTML={{ __html: html ?? '' }} />
            {shouldCollapse && !expanded && (
              <div className="absolute bottom-12 left-0 right-0 h-16 bg-gradient-to-t from-palmkit-elements-background-depth-1 to-transparent pointer-events-none" />
            )}
          </div>
        ) : (
          <div className="bg-white">
            <iframe
              srcDoc={previewHtml}
              sandbox="allow-scripts"
              className="w-full border-0"
              style={{ minHeight: '200px', maxHeight: '500px' }}
              title="Code preview"
            />
          </div>
        )}

        {/* Expand/collapse button for code tab */}
        {shouldCollapse && activeTab === 'code' && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full py-1.5 text-[11px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary transition-colors border-t border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2"
          >
            {expanded ? '▲ Collapse' : `▼ Show all ${lineCount} lines`}
          </button>
        )}
      </div>
    );
  },
);
