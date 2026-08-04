/**
 * Which HTML elements a model's markdown may keep.
 *
 * Split out of markdown.ts so it can be read without it. That module pulls in
 * unified, rehype and remark to build a sanitiser, and the system prompt needs
 * nothing from any of them — it only names these tags so the model knows what
 * survives rendering. Importing the list used to mean importing the whole
 * markdown pipeline, which is why the prompt could not be shared with the
 * worker that now runs it.
 */
export const allowedHTMLElements = [
  'a',
  'b',
  'button',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'ins',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'source',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'var',
  'think',
  'header',
];
