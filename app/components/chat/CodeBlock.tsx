/**
 * CodeBlock — displays code with syntax highlighting + optional live Preview.
 *
 * For frontend code (jsx, tsx, html, css, javascript), a "Preview" tab renders
 * the code live in a sandboxed iframe using Babel standalone for transpilation.
 * For other languages (python, bash, json, etc.), only the Code tab is shown.
 *
 * Used in Chat tab to show code snippets with instant visual feedback —
 * the user sees the result without leaving the conversation.
 *
 * Security: the iframe uses sandbox="allow-scripts" (no allow-same-origin)
 * so the previewed code cannot access the parent page's cookies, localStorage,
 * or DOM. It runs in a null origin.
 */

import { memo, useEffect, useState, type FormEvent } from 'react';
import { bundledLanguages, codeToHtml, isSpecialLang, type BundledLanguage, type SpecialLanguage } from 'shiki';
import { classNames } from '~/utils/classNames';
import { createScopedLogger } from '~/utils/logger';

import styles from './CodeBlock.module.scss';

const logger = createScopedLogger('CodeBlock');

interface CodeBlockProps {
  className?: string;
  code: string;
  language?: BundledLanguage | SpecialLanguage;
  theme?: 'light-plus' | 'dark-plus';
  disableCopy?: boolean;
}

type Tab = 'code' | 'preview';

/** Languages that support live preview. */
const PREVIEWABLE_LANGUAGES = new Set(['jsx', 'tsx', 'html', 'css', 'javascript']);

/** Check if a language supports live preview. */
function isPreviewable(language: string): boolean {
  return PREVIEWABLE_LANGUAGES.has(language.toLowerCase());
}

/** HTML template for the preview iframe. */
function buildPreviewHtml(code: string, language: string): string {
  // For HTML, inject directly
  if (language === 'html') {
    return code;
  }

  // For CSS, wrap in a simple HTML page
  if (language === 'css') {
    return `<!DOCTYPE html>
<html>
<head>
<style>${code}</style>
</head>
<body>
<div style="padding: 20px; font-family: sans-serif;">
<h2>CSS Preview</h2>
<p>Sample text with the applied styles.</p>
<button>Button</button>
<input placeholder="Input" />
</div>
</body>
</html>`;
  }

  // For JSX/TSX/JS, use Babel standalone to transpile and React to render
  const isTsx = language === 'tsx';
  const babelPreset = isTsx ? 'react,typescript' : 'react';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #root { padding: 16px; }
</style>
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="${babelPreset}">
try {
${code}
} catch(e) {
  document.getElementById('root').innerHTML = '<pre style="color:red;padding:16px;">' + e.message + '</pre>';
}
</script>
<script>
// Auto-mount: find React components in the global scope after Babel transpiles
window.addEventListener('load', function() {
  setTimeout(function() {
    var rootEl = document.getElementById('root');
    if (rootEl.children.length === 0) {
      // Try to find a React component in the global scope
      var keys = Object.keys(window).filter(function(k) {
        return typeof window[k] === 'function' && /^[A-Z]/.test(k);
      });
      if (keys.length > 0) {
        var Component = window[keys[keys.length - 1]];
        var root = ReactDOM.createRoot(rootEl);
        root.render(React.createElement(Component));
      } else {
        rootEl.innerHTML = '<p style="color:#888;padding:16px;">No React component found. Define a component starting with a capital letter.</p>';
      }
    }
  }, 100);
});
</script>
</body>
</html>`;
}

export const CodeBlock = memo(
  ({ className, code, language = 'plaintext', theme = 'dark-plus', disableCopy = false }: CodeBlockProps) => {
    const [html, setHTML] = useState<string | undefined>(undefined);
    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('code');

    const languageStr = String(language);
    const canPreview = isPreviewable(languageStr);

    const copyToClipboard = () => {
      if (copied) {
        return;
      }

      navigator.clipboard.writeText(code);

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    };

    useEffect(() => {
      let effectiveLanguage = language;

      if (language && !isSpecialLang(language) && !(language in bundledLanguages)) {
        logger.warn(`Unsupported language '${language}', falling back to plaintext`);
        effectiveLanguage = 'plaintext';
      }

      logger.trace(`Language = ${effectiveLanguage}`);

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

    // If no preview support, render the original CodeBlock (no tabs)
    if (!canPreview) {
      return (
        <div className={classNames('relative group text-left', className)}>
          <div
            className={classNames(
              styles.CopyButtonContainer,
              'bg-transparant absolute top-[10px] right-[10px] rounded-md z-10 text-lg flex items-center justify-center opacity-0 group-hover:opacity-100',
              {
                'rounded-l-0 opacity-100': copied,
              },
            )}
          >
            {!disableCopy && (
              <button
                className={classNames(
                  'flex items-center bg-gray-800 dark:bg-gray-300 p-[6px] justify-center before:bg-white before:rounded-l-md before:text-gray-500 before:border-r before:border-gray-300 rounded-md transition-theme',
                  {
                    'before:opacity-0': !copied,
                    'before:opacity-100': copied,
                  },
                )}
                title="Copy Code"
                onClick={() => copyToClipboard()}
              >
                <div className="i-ph:clipboard-text-duotone"></div>
              </button>
            )}
          </div>
          <div dangerouslySetInnerHTML={{ __html: html ?? '' }}></div>
        </div>
      );
    }

    // With preview support: render tabs
    return (
      <div
        className={classNames(
          'relative text-left my-3 rounded-lg overflow-hidden border border-palmkit-elements-borderColor',
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
            <span className="ml-2 text-[10px] text-palmkit-elements-textTertiary uppercase tracking-wider">
              {languageStr}
            </span>
          </div>
          {!disableCopy && (
            <button
              type="button"
              onClick={() => copyToClipboard()}
              className="text-[11px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary transition-colors"
              title="Copy code"
            >
              <span className={copied ? 'i-ph:check inline-block w-3.5 h-3.5' : 'i-ph:copy inline-block w-3.5 h-3.5'} />
            </button>
          )}
        </div>

        {/* Tab content */}
        {activeTab === 'code' ? (
          <div dangerouslySetInnerHTML={{ __html: html ?? '' }} />
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
      </div>
    );
  },
);
