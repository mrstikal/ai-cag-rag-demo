export interface DocumentMetadata {
  id: string;
  title: string;
  category: string;
  locale: string;
  status: string;
  validFrom?: string;
  validTo?: string;
  tags: string[];
}

export interface Chunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  category: string;
  locale: string;
  status: string;
  validFrom?: string;
  validTo?: string;
  tags: string[];
  section: string;
  text: string;
  tokens: number;
}

export interface ChunkOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export type FrontmatterValue = string | string[];

export function parseFrontmatter(raw: string): {
  data: Record<string, FrontmatterValue>;
  content: string;
} {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(normalized);
  if (!match) return { data: {}, content: normalized };

  const block = match[1] ?? "";
  const content = normalized.slice(match[0].length);
  const data: Record<string, FrontmatterValue> = {};
  let currentKey: string | null = null;

  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      const value = stripQuotes((listItem[1] ?? "").trim());
      const existing = data[currentKey];
      if (Array.isArray(existing)) existing.push(value);
      else data[currentKey] = [value];
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (pair) {
      currentKey = pair[1] ?? null;
      const value = (pair[2] ?? "").trim();
      if (currentKey) data[currentKey] = value === "" ? [] : stripQuotes(value);
    }
  }

  return { data, content };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function firstString(data: Record<string, FrontmatterValue>, key: string): string | undefined {
  const value = data[key];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.trim() !== "" ? first.trim() : undefined;
  }
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function stringList(data: Record<string, FrontmatterValue>, key: string): string[] {
  const value = data[key];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim() !== "") return [value.trim()];
  return [];
}

/** Rough token estimate. Good enough to reason about chunk sizes. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

interface Section {
  heading: string;
  body: string;
}

export function splitIntoSections(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section = { heading: "Overview", body: "" };
  let started = false;

  for (const line of lines) {
    if (/^#\s+/.test(line)) continue; // H1 is the document title.
    const headingMatch = /^(#{2,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      if (started) sections.push(current);
      current = { heading: (headingMatch[2] ?? "").trim(), body: "" };
      started = true;
      continue;
    }
    current.body += `${line}\n`;
  }
  sections.push(current);

  return sections
    .map((section) => ({ heading: section.heading, body: section.body.trim() }))
    .filter((section) => section.body !== "" || section.heading !== "");
}

export function chunkDocument(
  content: string,
  meta: DocumentMetadata,
  options: ChunkOptions,
): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = splitIntoSections(content);

  for (const section of sections) {
    const heading = section.heading || "Overview";
    const fullText = `## ${heading}\n\n${section.body}`.trim();
    const pieces = splitBySize(fullText, options);
    for (const piece of pieces) {
      const text = piece.trim();
      if (text === "") continue;
      const chunkIndex = chunks.length;
      chunks.push({
        chunkId: `${meta.id}:${chunkIndex}`,
        documentId: meta.id,
        chunkIndex,
        title: meta.title,
        category: meta.category,
        locale: meta.locale,
        status: meta.status,
        validFrom: meta.validFrom,
        validTo: meta.validTo,
        tags: meta.tags,
        section: heading,
        text,
        tokens: estimateTokens(text),
      });
    }
  }

  return chunks;
}

function splitBySize(text: string, options: ChunkOptions): string[] {
  if (estimateTokens(text) <= options.maxTokens) return [text];

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const expanded: string[] = [];
  for (const paragraph of paragraphs) {
    expanded.push(...splitOversizedParagraph(paragraph, options));
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length > 0) chunks.push(current.join("\n\n"));
  };

  for (const paragraph of expanded) {
    const paragraphTokens = estimateTokens(paragraph);
    if (currentTokens > 0 && currentTokens + paragraphTokens > options.targetTokens) {
      flush();
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = current.length - 1; i >= 0 && overlapTokens < options.overlapTokens; i--) {
        const candidate = current[i];
        if (candidate === undefined) break;
        overlap.unshift(candidate);
        overlapTokens += estimateTokens(candidate);
      }
      current = overlap;
      currentTokens = overlapTokens;
    }
    current.push(paragraph);
    currentTokens += paragraphTokens;
  }
  flush();

  return chunks;
}

function splitOversizedParagraph(paragraph: string, options: ChunkOptions): string[] {
  if (estimateTokens(paragraph) <= options.maxTokens) return [paragraph];

  const maxChars = options.maxTokens * 4;
  const overlapChars = options.overlapTokens * 4;
  const words = paragraph.split(/\s+/);
  const pieces: string[] = [];
  let buffer = "";

  for (const word of words) {
    if (buffer !== "" && buffer.length + word.length + 1 > maxChars) {
      pieces.push(buffer);
      const tail = buffer.slice(Math.max(0, buffer.length - overlapChars));
      buffer = tail.trimStart();
    }
    buffer = buffer === "" ? word : `${buffer} ${word}`;
  }
  if (buffer !== "") pieces.push(buffer);
  return pieces;
}
