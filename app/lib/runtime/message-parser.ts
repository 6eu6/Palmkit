import type {
  ActionType,
  PalmkitAction,
  PalmkitActionData,
  FileAction,
  ShellAction,
  SupabaseAction,
  AssetAction,
  EditAction,
} from '~/types/actions';
import type { PalmkitArtifactData } from '~/types/artifact';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';

const ARTIFACT_TAG_OPEN = '<palmkitArtifact';
const ARTIFACT_TAG_CLOSE = '</palmkitArtifact>';
const ARTIFACT_ACTION_TAG_OPEN = '<palmkitAction';
const ARTIFACT_ACTION_TAG_CLOSE = '</palmkitAction>';

/*
 * Backward compatibility: normalize old boltArtifact/boltAction tags to palmkitArtifact/palmkitAction.
 * NOTE: retained for re-wiring into the parse path (old saved projects still use bolt* tags).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function normalizeLegacyTags(input: string): string {
  return input
    .replace(/<boltArtifact/g, '<palmkitArtifact')
    .replace(/<\/boltArtifact>/g, '</palmkitArtifact>')
    .replace(/<boltAction/g, '<palmkitAction')
    .replace(/<\/boltAction>/g, '</palmkitAction>');
}

const PALMKIT_QUICK_ACTIONS_OPEN = '<palmkit-quick-actions>';
const PALMKIT_QUICK_ACTIONS_CLOSE = '</palmkit-quick-actions>';

/**
 * A block of questions the model asks when it genuinely cannot proceed.
 *
 * Not a wizard and not a form the user has to clear before anything happens —
 * a model that knows enough is expected to start building and never emit this
 * at all. It exists so that "which of the two do you mean?" is a question
 * rather than a guess that wastes a whole build.
 *
 *   <palmkit-questions>
 *     <palmkit-question ask="Who is this for?" key="audience" multiple="true">
 *       <palmkit-option>Restaurants</palmkit-option>
 *       <palmkit-option hint="table booking, menus">Cafés</palmkit-option>
 *     </palmkit-question>
 *     <palmkit-question ask="Anything else I should know?" key="notes" />
 *   </palmkit-questions>
 *
 * Every question carries a free-text box whether or not it offers options,
 * because the answer the model did not think of is the one worth having.
 */
const PALMKIT_QUESTIONS_OPEN = '<palmkit-questions>';
const PALMKIT_QUESTIONS_CLOSE = '</palmkit-questions>';

export interface ParsedQuestionOption {
  label: string;
  hint?: string;
}

export interface ParsedQuestion {
  key: string;
  ask: string;
  multiple: boolean;
  options: ParsedQuestionOption[];
}

const logger = createScopedLogger('MessageParser');

export interface ArtifactCallbackData extends PalmkitArtifactData {
  messageId: string;
  artifactId?: string;
}

export interface ActionCallbackData {
  artifactId: string;
  messageId: string;
  actionId: string;
  action: PalmkitAction;
}

export type ArtifactCallback = (data: ArtifactCallbackData) => void;
export type ActionCallback = (data: ActionCallbackData) => void;

export interface ParserCallbacks {
  onArtifactOpen?: ArtifactCallback;
  onArtifactClose?: ArtifactCallback;
  onActionOpen?: ActionCallback;
  onActionStream?: ActionCallback;
  onActionClose?: ActionCallback;
}

interface ElementFactoryProps {
  messageId: string;
  artifactId?: string;
}

type ElementFactory = (props: ElementFactoryProps) => string;

export interface StreamingMessageParserOptions {
  callbacks?: ParserCallbacks;
  artifactElement?: ElementFactory;
}

interface MessageState {
  position: number;
  insideArtifact: boolean;
  insideAction: boolean;
  artifactCounter: number;
  currentArtifact?: PalmkitArtifactData;
  currentAction: PalmkitActionData;
  actionId: number;
}

function cleanoutMarkdownSyntax(content: string) {
  const codeBlockRegex = /^\s*```\w*\n([\s\S]*?)\n\s*```\s*$/;
  const match = content.match(codeBlockRegex);

  // console.log('matching', !!match, content);

  if (match) {
    return match[1]; // Remove common leading 4-space indent
  } else {
    return content;
  }
}

function cleanEscapedTags(content: string) {
  return content.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
export class StreamingMessageParser {
  #messages = new Map<string, MessageState>();
  #artifactCounter = 0;

  constructor(private _options: StreamingMessageParserOptions = {}) {}

  parse(messageId: string, input: string) {
    let state = this.#messages.get(messageId);

    if (!state) {
      state = {
        position: 0,
        insideAction: false,
        insideArtifact: false,
        artifactCounter: 0,
        currentAction: { content: '' },
        actionId: 0,
      };

      this.#messages.set(messageId, state);
    }

    let output = '';
    let i = state.position;
    let earlyBreak = false;

    while (i < input.length) {
      if (input.startsWith(PALMKIT_QUICK_ACTIONS_OPEN, i)) {
        const actionsBlockEnd = input.indexOf(PALMKIT_QUICK_ACTIONS_CLOSE, i);

        if (actionsBlockEnd !== -1) {
          const actionsBlockContent = input.slice(i + PALMKIT_QUICK_ACTIONS_OPEN.length, actionsBlockEnd);

          // Find all <palmkit-quick-action ...>label</palmkit-quick-action> inside
          const quickActionRegex = /<palmkit-quick-action([^>]*)>([\s\S]*?)<\/palmkit-quick-action>/g;
          let match;
          const buttons = [];

          while ((match = quickActionRegex.exec(actionsBlockContent)) !== null) {
            const tagAttrs = match[1];
            const label = match[2];
            const type = this.#extractAttribute(tagAttrs, 'type');
            const message = this.#extractAttribute(tagAttrs, 'message');
            const path = this.#extractAttribute(tagAttrs, 'path');
            const href = this.#extractAttribute(tagAttrs, 'href');
            buttons.push(
              createQuickActionElement(
                { type: type || '', message: message || '', path: path || '', href: href || '' },
                label,
              ),
            );
          }
          output += createQuickActionGroup(buttons);
          i = actionsBlockEnd + PALMKIT_QUICK_ACTIONS_CLOSE.length;
          continue;
        }
      }

      if (input.startsWith(PALMKIT_QUESTIONS_OPEN, i)) {
        const end = input.indexOf(PALMKIT_QUESTIONS_CLOSE, i);

        /*
         * Nothing is emitted until the block is closed. A half-streamed
         * question would render as a card with one option and then rerender
         * with three, which reads as the model changing its mind.
         */
        if (end === -1) {
          earlyBreak = true;
          break;
        }

        const questions = parseQuestions(input.slice(i + PALMKIT_QUESTIONS_OPEN.length, end));

        if (questions.length > 0) {
          output += createQuestionsElement(questions);
        }

        i = end + PALMKIT_QUESTIONS_CLOSE.length;

        continue;
      }

      if (state.insideArtifact) {
        const currentArtifact = state.currentArtifact;

        if (currentArtifact === undefined) {
          unreachable('Artifact not initialized');
        }

        if (state.insideAction) {
          const closeIndex = input.indexOf(ARTIFACT_ACTION_TAG_CLOSE, i);

          const currentAction = state.currentAction;

          if (closeIndex !== -1) {
            currentAction.content += input.slice(i, closeIndex);

            let content = currentAction.content.trim();

            if ('type' in currentAction && currentAction.type === 'file') {
              // Remove markdown code block syntax if present and file is not markdown
              if (!currentAction.filePath?.endsWith('.md')) {
                content = cleanoutMarkdownSyntax(content);
                content = cleanEscapedTags(content);
              }

              content += '\n';
            }

            currentAction.content = content;

            this._options.callbacks?.onActionClose?.({
              artifactId: currentArtifact.id,
              messageId,

              /**
               * We decrement the id because it's been incremented already
               * when `onActionOpen` was emitted to make sure the ids are
               * the same.
               */
              actionId: String(state.actionId - 1),

              action: currentAction as PalmkitAction,
            });

            state.insideAction = false;
            state.currentAction = { content: '' };

            i = closeIndex + ARTIFACT_ACTION_TAG_CLOSE.length;
          } else {
            if ('type' in currentAction && currentAction.type === 'file') {
              let content = input.slice(i);

              if (!currentAction.filePath?.endsWith('.md')) {
                content = cleanoutMarkdownSyntax(content);
                content = cleanEscapedTags(content);
              }

              this._options.callbacks?.onActionStream?.({
                artifactId: currentArtifact.id,
                messageId,
                actionId: String(state.actionId - 1),
                action: {
                  ...(currentAction as FileAction),
                  content,
                  filePath: currentAction.filePath,
                },
              });
            }

            break;
          }
        } else {
          const actionOpenIndex = input.indexOf(ARTIFACT_ACTION_TAG_OPEN, i);
          const artifactCloseIndex = input.indexOf(ARTIFACT_TAG_CLOSE, i);

          if (actionOpenIndex !== -1 && (artifactCloseIndex === -1 || actionOpenIndex < artifactCloseIndex)) {
            const actionEndIndex = input.indexOf('>', actionOpenIndex);

            if (actionEndIndex !== -1) {
              state.insideAction = true;

              state.currentAction = this.#parseActionTag(input, actionOpenIndex, actionEndIndex);

              this._options.callbacks?.onActionOpen?.({
                artifactId: currentArtifact.id,
                messageId,
                actionId: String(state.actionId++),
                action: state.currentAction as PalmkitAction,
              });

              i = actionEndIndex + 1;
            } else {
              break;
            }
          } else if (artifactCloseIndex !== -1) {
            this._options.callbacks?.onArtifactClose?.({
              messageId,
              artifactId: currentArtifact.id,
              ...currentArtifact,
            });

            state.insideArtifact = false;
            state.currentArtifact = undefined;

            i = artifactCloseIndex + ARTIFACT_TAG_CLOSE.length;
          } else {
            break;
          }
        }
      } else if (input[i] === '<' && input[i + 1] !== '/') {
        let j = i;
        let potentialTag = '';

        while (j < input.length && potentialTag.length < ARTIFACT_TAG_OPEN.length) {
          potentialTag += input[j];

          if (potentialTag === ARTIFACT_TAG_OPEN) {
            const nextChar = input[j + 1];

            if (nextChar && nextChar !== '>' && nextChar !== ' ') {
              output += input.slice(i, j + 1);
              i = j + 1;
              break;
            }

            const openTagEnd = input.indexOf('>', j);

            if (openTagEnd !== -1) {
              const artifactTag = input.slice(i, openTagEnd + 1);

              const artifactTitle = this.#extractAttribute(artifactTag, 'title') as string;
              const type = this.#extractAttribute(artifactTag, 'type') as string;

              const extractedId = this.#extractAttribute(artifactTag, 'id') as string;
              const artifactId = extractedId || `${messageId}-${state.artifactCounter}`;
              state.artifactCounter++;

              if (!artifactTitle) {
                logger.warn('Artifact title missing');
              }

              if (!artifactId) {
                logger.warn('Artifact id missing');
              }

              state.insideArtifact = true;

              const currentArtifact = {
                id: artifactId,
                title: artifactTitle,
                type,
              } satisfies PalmkitArtifactData;

              state.currentArtifact = currentArtifact;

              this._options.callbacks?.onArtifactOpen?.({
                messageId,
                artifactId: currentArtifact.id,
                ...currentArtifact,
              });

              const artifactFactory = this._options.artifactElement ?? createArtifactElement;

              output += artifactFactory({ messageId, artifactId });

              i = openTagEnd + 1;
            } else {
              earlyBreak = true;
            }

            break;
          } else if (!ARTIFACT_TAG_OPEN.startsWith(potentialTag)) {
            output += input.slice(i, j + 1);
            i = j + 1;
            break;
          }

          j++;
        }

        if (j === input.length && ARTIFACT_TAG_OPEN.startsWith(potentialTag)) {
          break;
        }
      } else {
        /*
         * Note: Auto-file-creation from code blocks is now handled by EnhancedMessageParser
         * to avoid duplicate processing and provide better shell command detection
         */
        output += input[i];
        i++;
      }

      if (earlyBreak) {
        break;
      }
    }

    state.position = i;

    return output;
  }

  reset() {
    this.#messages.clear();
  }

  /**
   * Force-finalize any open action or artifact across all tracked messages.
   *
   * When the stream ends (onFinish / onError) the parser may be in the middle
   * of an unclosed `<palmkitAction>` — the LLM hit its token limit or the
   * connection dropped.  Without this flush the file content is displayed in
   * the editor but **never actually written** to the WebContainer / workbench.
   *
   * Call this from the chat `onFinish` and `onError` handlers.
   */
  finalize() {
    for (const [messageId, state] of this.#messages) {
      if (state.insideAction && state.currentArtifact) {
        const currentAction = state.currentAction;

        let content = currentAction.content?.trim() || '';

        if ('type' in currentAction && currentAction.type === 'file') {
          if (!currentAction.filePath?.endsWith('.md')) {
            content = cleanoutMarkdownSyntax(content);
            content = cleanEscapedTags(content);
          }

          content += '\n';
        }

        currentAction.content = content;

        logger.info(`[finalize] flushing open action ${state.actionId - 1} for message ${messageId}`);

        this._options.callbacks?.onActionClose?.({
          artifactId: state.currentArtifact.id,
          messageId,
          actionId: String(state.actionId - 1),
          action: currentAction as PalmkitAction,
        });

        state.insideAction = false;
        state.currentAction = { content: '' };
      }

      if (state.insideArtifact && state.currentArtifact) {
        logger.info(`[finalize] closing open artifact ${state.currentArtifact.id} for message ${messageId}`);

        this._options.callbacks?.onArtifactClose?.({
          messageId,
          artifactId: state.currentArtifact.id,
          ...state.currentArtifact,
        });

        state.insideArtifact = false;
        state.currentArtifact = undefined;
      }
    }
  }

  #parseActionTag(input: string, actionOpenIndex: number, actionEndIndex: number) {
    const actionTag = input.slice(actionOpenIndex, actionEndIndex + 1);

    const actionType = this.#extractAttribute(actionTag, 'type') as ActionType;

    const actionAttributes = {
      type: actionType,
      content: '',
    };

    if (actionType === 'supabase') {
      const operation = this.#extractAttribute(actionTag, 'operation');

      if (!operation || !['migration', 'query'].includes(operation)) {
        logger.warn(`Invalid or missing operation for Supabase action: ${operation}`);
        throw new Error(`Invalid Supabase operation: ${operation}`);
      }

      (actionAttributes as SupabaseAction).operation = operation as 'migration' | 'query';

      if (operation === 'migration') {
        const filePath = this.#extractAttribute(actionTag, 'filePath');

        if (!filePath) {
          logger.warn('Migration requires a filePath');
          throw new Error('Migration requires a filePath');
        }

        (actionAttributes as SupabaseAction).filePath = filePath;
      }
    } else if (actionType === 'file') {
      let filePath = this.#extractAttribute(actionTag, 'filePath') as string;

      if (!filePath) {
        /*
         * Some models emit a file action without a filePath attribute. Rather
         * than letting `undefined.endsWith(...)` crash the whole parser (and
         * blank the app), fall back to a generic, valid filename so the content
         * is still surfaced as a file the user can rename/export.
         */
        filePath = `untitled-${Date.now()}.txt`;
        logger.warn(`File action missing filePath; falling back to ${filePath}`);
      }

      (actionAttributes as FileAction).filePath = filePath;
    } else if (actionType === 'asset') {
      /*
       * An asset carries a link rather than its content: the bytes are a JPEG
       * or an MP4, which cannot travel in the stream as text and must not go
       * back into the model's context. Both attributes are required — without
       * a path there is nowhere to put it, and without a src there is nothing
       * to put there.
       */
      const filePath = this.#extractAttribute(actionTag, 'filePath');
      const src = this.#extractAttribute(actionTag, 'src');

      if (!filePath || !src) {
        logger.warn(`Asset action needs filePath and src (got ${filePath ?? 'none'} / ${src ? 'a src' : 'no src'})`);
        throw new Error('Asset action requires filePath and src');
      }

      (actionAttributes as AssetAction).filePath = filePath;
      (actionAttributes as AssetAction).src = src;
    } else if (actionType === 'edit') {
      /*
       * An edit names the file it changes and carries only the changed part,
       * so a path is not optional the way it is for a file action — there is
       * no content here to fall back on showing.
       */
      const filePath = this.#extractAttribute(actionTag, 'filePath');

      if (!filePath) {
        logger.warn('Edit action missing filePath');
        throw new Error('Edit action requires filePath');
      }

      (actionAttributes as EditAction).filePath = filePath;
    } else if (!['shell', 'start'].includes(actionType)) {
      logger.warn(`Unknown action type '${actionType}'`);
    }

    return actionAttributes as FileAction | ShellAction | AssetAction | EditAction;
  }

  #extractAttribute(tag: string, attributeName: string): string | undefined {
    const match = tag.match(new RegExp(`${attributeName}="([^"]*)"`, 'i'));
    return match ? match[1] : undefined;
  }
}

const createArtifactElement: ElementFactory = (props) => {
  const elementProps = [
    'class="__palmkitArtifact__"',
    ...Object.entries(props).map(([key, value]) => {
      return `data-${camelToDashCase(key)}=${JSON.stringify(value)}`;
    }),
  ];

  return `<div ${elementProps.join(' ')}></div>`;
};

function camelToDashCase(input: string) {
  return input.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function createQuickActionElement(props: Record<string, string>, label: string) {
  const elementProps = [
    'class="__palmkitQuickAction__"',
    'data-palmkit-quick-action="true"',
    ...Object.entries(props).map(([key, value]) => `data-${camelToDashCase(key)}=${JSON.stringify(value)}`),
  ];

  return `<button ${elementProps.join(' ')}>${label}</button>`;
}

function createQuickActionGroup(buttons: string[]) {
  return `<div class=\"__palmkitQuickAction__\" data-palmkit-quick-action=\"true\">${buttons.join('')}</div>`;
}

/*
 * The negative lookahead matters: without it `<palmkit-question` also matches
 * the first sixteen characters of the `<palmkit-questions>` wrapper, and the
 * whole block is swallowed as one malformed question.
 */
const QUESTION_RE = /<palmkit-question(?![-a-z])([^>]*?)(?:\/>|>([\s\S]*?)<\/palmkit-question>)/g;
const OPTION_RE = /<palmkit-option(?![-a-z])([^>]*)>([\s\S]*?)<\/palmkit-option>/g;

function attributeOf(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1];
}

/**
 * The questions in a block, ignoring anything malformed.
 *
 * A question with neither text nor a usable key is dropped rather than
 * rendered empty: a card asking nothing is worse than no card.
 */
export function parseQuestions(block: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  let match: RegExpExecArray | null;

  QUESTION_RE.lastIndex = 0;

  while ((match = QUESTION_RE.exec(block)) !== null) {
    const [, attrs, body = ''] = match;
    const ask = (attributeOf(attrs, 'ask') ?? '').trim();

    if (!ask) {
      continue;
    }

    const options: ParsedQuestionOption[] = [];
    let option: RegExpExecArray | null;

    OPTION_RE.lastIndex = 0;

    while ((option = OPTION_RE.exec(body)) !== null) {
      const label = option[2].trim();

      if (!label) {
        continue;
      }

      const hint = attributeOf(option[1], 'hint')?.trim();
      options.push(hint ? { label, hint } : { label });
    }

    questions.push({
      key: (attributeOf(attrs, 'key') ?? `q${questions.length + 1}`).trim(),
      ask,
      multiple: attributeOf(attrs, 'multiple') === 'true',
      options,
    });
  }

  return questions;
}

/**
 * The questions ride in a data attribute rather than as nested markup so the
 * card owns its own layout and the sanitizer has one attribute to allow.
 *
 * The JSON has to be HTML-escaped, not JS-escaped. `JSON.stringify` of the
 * string produces `data-questions="[{\"key\"…}]"`, and a backslash means
 * nothing to an HTML parser — the attribute ended at the first inner quote
 * and the whole element was dropped as malformed.
 */
/**
 * Turn every complete questions block in a piece of text into its element.
 *
 * The streaming parser above does this too, but its output is not always what
 * reaches the screen. When a message carries an AI SDK `parts` array — which
 * every streamed message does — the chat renders `part.text`, the raw model
 * output, and only the non-streaming `content` path gets the parsed version.
 * So the block arrived at the markdown pipeline untouched, was not in the
 * allowed-element list, and the sanitizer dropped it without a word: the
 * model asked its question and the user saw an empty reply.
 *
 * Running it here as a plain string rewrite makes the rendering independent
 * of which path the text came down. It is idempotent — a block the streaming
 * parser already converted is a div by then, and matches nothing.
 */
export function renderQuestionBlocks(text: string): string {
  if (!text.includes(PALMKIT_QUESTIONS_OPEN)) {
    return text;
  }

  return text.replace(/<palmkit-questions>([\s\S]*?)<\/palmkit-questions>/g, (whole, body: string) => {
    const questions = parseQuestions(body);
    return questions.length > 0 ? createQuestionsElement(questions) : '';
  });
}

function createQuestionsElement(questions: ParsedQuestion[]): string {
  const json = JSON.stringify(questions)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<div class="__palmkitQuestions__" data-questions="${json}"></div>`;
}
