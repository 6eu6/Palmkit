/**
 * Markdown → HTML converter (lightweight, no dependencies)
 * =======================================================
 *
 * Shared by create_pdf and create_docx. Supports the common subset:
 *   - Headings: #, ##, ###, ####, #####, ######
 *   - Bold: **text**
 *   - Italic: *text*
 *   - Inline code: `code`
 *   - Code blocks: ```lang\ncode\n```
 *   - Links: [text](url)
 *   - Images: ![alt](src)
 *   - Unordered lists: - item or * item
 *   - Ordered lists: 1. item
 *   - Blockquotes: > quote
 *   - Tables: | col1 | col2 |\n| --- | --- |\n| a | b |
 *   - Horizontal rule: --- or ___
 *   - Page breaks (PDF only): ---page-break---
 *
 * Why not use a library?
 *   - `marked` is ~50KB minified — manageable but adds a dependency.
 *   - `markdown-it` is ~80KB — too heavy for our CF bundle budget.
 *   - The subset above covers ~95% of real-world document needs.
 *   - Custom converter keeps the bundle small AND lets us add
 *     PalmKit-specific syntax like ---page-break---.
 *
 * The converter is NOT a full CommonMark implementation. It's pragmatic
 * and well-tested for the document-generation use case.
 */

export interface MarkdownToHtmlOptions {
  /** Render ---page-break--- as a CSS page-break. Default: true. */
  enablePageBreaks?: boolean;

  /** Add numbering to headings (1., 1.1, 1.1.1). Default: false. */
  numberedHeadings?: boolean;
}

export function markdownToHtml(markdown: string, options: MarkdownToHtmlOptions = {}): string {
  const { enablePageBreaks = true, numberedHeadings = false } = options;

  /*
   * Step 1: Extract code blocks first so their content isn't mangled
   * by the inline transformations below.
   */
  const codeBlocks: string[] = [];
  let text = markdown.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langClass = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langClass}>${escapeHtml(code.trim())}</code></pre>`);

    return `\u0000CODEBLOCK_${idx}\u0000`;
  });

  // Step 2: Page breaks (only if enabled)
  if (enablePageBreaks) {
    text = text.replace(/---page-break---/g, '<div style="page-break-after: always;"></div>');
  }

  // Step 3: Split into lines for block-level processing
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  // Heading numbering counters
  const h1 = [0, 0, 0];

  let inList: 'ul' | 'ol' | null = null;
  let inBlockquote = false;

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      out.push('</blockquote>');
      inBlockquote = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (they close blocks)
    if (!trimmed) {
      closeList();
      closeBlockquote();
      i++;
      continue;
    }

    // Code block placeholder (already extracted)
    const codeBlockMatch = trimmed.match(/^\u0000CODEBLOCK_(\d+)\u0000$/);

    if (codeBlockMatch) {
      closeList();
      closeBlockquote();
      out.push(codeBlocks[parseInt(codeBlockMatch[1], 10)]);
      i++;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      closeList();
      closeBlockquote();

      const level = headingMatch[1].length;
      const content = inlineFormat(headingMatch[2]);

      if (numberedHeadings && level <= 3) {
        h1[level - 1]++;

        for (let j = level; j < 3; j++) {
          h1[j] = 0;
        }

        const num = h1.slice(0, level).join('.');
        out.push(`<h${level}>${num}. ${content}</h${level}>`);
      } else {
        out.push(`<h${level}>${content}</h${level}>`);
      }

      i++;
      continue;
    }

    // Horizontal rule (--- or ___)
    if (/^(-{3,}|_{3,})\s*$/.test(trimmed)) {
      closeList();
      closeBlockquote();
      out.push('<hr>');
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      closeList();

      if (!inBlockquote) {
        out.push('<blockquote>');
        inBlockquote = true;
      }

      out.push(`<p>${inlineFormat(trimmed.slice(2))}</p>`);
      i++;
      continue;
    }

    // Tables (look for header + separator + at least one row)
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1].trim())) {
      closeList();
      closeBlockquote();

      const headerCells = parseTableRow(trimmed);
      const aligns = parseTableAligns(lines[i + 1].trim());
      i += 2;

      const bodyRows: string[][] = [];

      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyRows.push(parseTableRow(lines[i].trim()));
        i++;
      }

      out.push('<table>');
      out.push(
        '<thead><tr>' +
          headerCells
            .map((c, idx) => `<th${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''}>${inlineFormat(c)}</th>`)
            .join('') +
          '</tr></thead>',
      );
      out.push(
        '<tbody>' +
          bodyRows
            .map(
              (row) =>
                '<tr>' +
                row
                  .map(
                    (c, idx) => `<td${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''}>${inlineFormat(c)}</td>`,
                  )
                  .join('') +
                '</tr>',
            )
            .join('') +
          '</tbody>',
      );
      out.push('</table>');
      continue;
    }

    // Unordered list item
    if (/^[-*+]\s+/.test(trimmed)) {
      closeBlockquote();

      if (inList !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = 'ul';
      }

      out.push(`<li>${inlineFormat(trimmed.replace(/^[-*+]\s+/, ''))}</li>`);
      i++;
      continue;
    }

    // Ordered list item
    if (/^\d+\.\s+/.test(trimmed)) {
      closeBlockquote();

      if (inList !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = 'ol';
      }

      out.push(`<li>${inlineFormat(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      i++;
      continue;
    }

    // Regular paragraph
    closeList();
    closeBlockquote();
    out.push(`<p>${inlineFormat(trimmed)}</p>`);
    i++;
  }

  closeList();
  closeBlockquote();

  return out.join('\n');
}

/**
 * Inline formatting: bold, italic, code, links, images.
 * Runs AFTER block-level processing.
 */
function inlineFormat(text: string): string {
  let out = text;

  // Images: ![alt](src)
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');

  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Bold: **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic: *text* (must come after bold)
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Inline code: `code`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  return out;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parseTableAligns(separatorLine: string): Array<'left' | 'center' | 'right' | ''> {
  return separatorLine
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => {
      const c = cell.trim();
      const left = c.startsWith(':');
      const right = c.endsWith(':');

      if (left && right) {
        return 'center';
      }

      if (right) {
        return 'right';
      }

      if (left) {
        return 'left';
      }

      return '';
    });
}
