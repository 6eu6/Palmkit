/**
 * Smart title generation from user's first message.
 *
 * Extracted from useChatHistory.ts during P4 decomposition.
 *
 * Strips model/provider tags, artifact XML, code blocks, URLs, and
 * conversational prefixes (English + Arabic), then detects action patterns
 * (build/create/fix/update/add/setup) to produce a concise human-readable
 * title capped at 50 chars.
 */

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function generateSmartTitle(content: string): string {
  // Strip model/provider tags like [Model: xxx] [Provider: xxx]
  let cleaned = content
    .replace(/\[Model:.*?\]/g, '')
    .replace(/\[Provider:.*?\]/g, '')
    .trim();

  // Strip artifact XML tags that may be in the message
  cleaned = cleaned.replace(/<palmkitArtifact[\s\S]*?<\/palmkitArtifact>/g, '').trim();
  cleaned = cleaned.replace(/<palmkitAction[\s\S]*?<\/palmkitAction>/g, '').trim();

  // Also handle legacy bolt tags
  cleaned = cleaned.replace(/<boltArtifact[\s\S]*?<\/boltArtifact>/g, '').trim();
  cleaned = cleaned.replace(/<boltAction[\s\S]*?<\/boltAction>/g, '').trim();

  // Strip file modification tags
  cleaned = cleaned.replace(/<palmkit_file_modifications[\s\S]*?<\/palmkit_file_modifications>/g, '').trim();
  cleaned = cleaned.replace(/<bolt_file_modifications[\s\S]*?<\/bolt_file_modifications>/g, '').trim();

  // Strip code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '').trim();

  // Strip URLs (they make bad titles)
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '').trim();

  // Strip common conversational prefixes in multiple languages
  cleaned = cleaned.replace(
    /^(please\s+)?(can\s+you\s+|could\s+you\s+|i\s+want\s+|i\s+need\s+|i'd\s+like\s+|build\s+me\s+|create\s+me\s+|make\s+me\s+|help\s+me\s+|سوي\s+|ابنِ\s+|اعمل\s+|ساعدني\s+|اريد\s+|ابغى\s+|خليني\s+)/i,
    '',
  );

  // Take first meaningful line only
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const firstLine = lines[0] || '';

  // Detect the type of request and generate appropriate title format
  const actionPatterns: Array<{ pattern: RegExp; extract: (match: RegExpMatchArray) => string }> = [
    // Build/create patterns
    {
      pattern: /^(build|create|make|design|develop|write|generate|scaffold)\s+(?:a\s+|an\s+)?(.+)/i,
      extract: (m) => `${capitalize(m[1])} ${m[2]}`,
    },

    // Fix/debug patterns
    {
      pattern: /^(fix|debug|repair|solve|troubleshoot|resolve)\s+(?:the\s+|a\s+)?(.+)/i,
      extract: (m) => `Fix: ${m[2]}`,
    },

    // Update/modify patterns
    {
      pattern: /^(update|modify|change|improve|refactor|enhance|upgrade|optimize)\s+(?:the\s+|a\s+)?(.+)/i,
      extract: (m) => `Update: ${m[2]}`,
    },

    // Add patterns
    {
      pattern: /^(add|insert|implement|include|integrate)\s+(?:a\s+|an\s+|the\s+)?(.+)/i,
      extract: (m) => `Add: ${m[2]}`,
    },

    // Setup/configure patterns
    {
      pattern: /^(set\s?up|setup|configure|install|initialize)\s+(?:a\s+|the\s+)?(.+)/i,
      extract: (m) => `Setup: ${m[2]}`,
    },

    // Arabic patterns
    {
      pattern: /^(ابن|سوي|اعمل|اصنع|صمم|برمج|طور)\s+(.*)/i,
      extract: (m) => m[2],
    },
  ];

  for (const { pattern, extract } of actionPatterns) {
    const match = firstLine.match(pattern);

    if (match) {
      let title = extract(match).trim();

      if (title.length > 50) {
        title = title.slice(0, 47) + '...';
      }

      return title || 'New Chat';
    }
  }

  // Fallback: use the first line as-is, cleaned up
  let title = firstLine;

  // Remove trailing punctuation
  title = title.replace(/[.!?;:,]+$/, '').trim();

  if (title.length === 0) {
    // Try the second line if first was empty after cleanup
    const secondLine = lines[1] || '';
    title = secondLine.replace(/[.!?;:,]+$/, '').trim();
  }

  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }

  return title || 'New Chat';
}
