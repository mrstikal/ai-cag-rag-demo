export interface Chunk {
  index: number;
  text: string;
}

/**
 * Deliberately simple structural chunker for step 1.
 *
 * - splits on Markdown headings (#, ##, ###)
 * - then splits any section longer than 2000 characters on paragraph
 *   boundaries
 *
 * Intentionally NOT token-based, NO overlap, and NO contextual headers.
 * These are added in later steps so their effect on retrieval is visible.
 */
const MAX_SECTION_CHARS = 2000;

/** Hard character split for a single paragraph longer than the section cap. */
function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const pieces: string[] = [];
  let start = 0;
  while (start < paragraph.length) {
    let end = Math.min(start + maxChars, paragraph.length);
    if (end < paragraph.length) {
      const slice = paragraph.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
      if (lastBreak > maxChars * 0.5) end = start + lastBreak;
    }
    pieces.push(paragraph.slice(start, end).trim());
    start = end;
  }
  return pieces.filter(Boolean);
}

export function chunkMarkdown(text: string): Chunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();

  const sections = normalized
    .split(/\n(?=#{1,3}\s)/)
    .map((section) => section.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];

  for (const section of sections) {
    if (section.length <= MAX_SECTION_CHARS) {
      chunks.push({ index: chunks.length, text: section });
      continue;
    }

    const paragraphs = section
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .flatMap((paragraph) => splitOversizedParagraph(paragraph, MAX_SECTION_CHARS));

    let current = "";

    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length > MAX_SECTION_CHARS) {
        chunks.push({ index: chunks.length, text: current.trim() });
        current = "";
      }

      current += (current ? "\n\n" : "") + paragraph;
    }

    if (current) {
      chunks.push({ index: chunks.length, text: current.trim() });
    }
  }

  return chunks;
}
