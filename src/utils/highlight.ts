export interface TextSegment {
  text: string;
  match: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits `text` into contiguous matched and non-matched segments for safe,
 * case-insensitive highlighting in React without raw HTML injection.
 */
export function splitHighlightSegments(text: string, query: string): TextSegment[] {
  if (!text) return [];
  const trimmed = query.trim();
  if (!trimmed) {
    return [{ text, match: false }];
  }

  const pattern = new RegExp(escapeRegExp(trimmed), 'gi');
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    const matchedText = m[0];
    if (!matchedText) continue;

    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), match: false });
    }
    segments.push({ text: matchedText, match: true });
    lastIndex = start + matchedText.length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }

  return segments.length > 0 ? segments : [{ text, match: false }];
}
