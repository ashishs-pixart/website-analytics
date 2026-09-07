export type InlineToken = { type: 'text' | 'strong' | 'code' | 'link'; text: string; href?: string };
export type MarkdownBlock =
  | { type: 'heading'; level: number; inline: InlineToken[] }
  | { type: 'paragraph' | 'quote'; inline: InlineToken[] }
  | { type: 'code'; language: string; text: string }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'table'; headers: InlineToken[][]; rows: InlineToken[][][] }
  | { type: 'rule' };

export function stripTerminalControlCodes(value: string) {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/\r(?!\n)/g, '\n');
}

export function parseInlineMarkdown(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index || 0;
    if (index > cursor) tokens.push({ type: 'text', text: value.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith('**')) tokens.push({ type: 'strong', text: token.slice(2, -2) });
    else if (token.startsWith('`')) tokens.push({ type: 'code', text: token.slice(1, -1) });
    else {
      const parts = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (parts) tokens.push({ type: 'link', text: parts[1], href: parts[2] });
      else tokens.push({ type: 'text', text: token });
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) tokens.push({ type: 'text', text: value.slice(cursor) });
  return tokens;
}

function tableCells(line: string) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function startsBlock(lines: string[], index: number) {
  const line = lines[index] || '';
  return !line.trim() || /^```/.test(line) || /^#{1,6}\s+/.test(line) || /^>\s?/.test(line)
    || /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
    || (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || ''));
}

export function parseMarkdown(value: string): MarkdownBlock[] {
  const lines = stripTerminalControlCodes(value).split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^```\s*([\w.+-]*)/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence[1] || '', text: body.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInlineMarkdown(heading[2]) });
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: 'rule' }); index += 1; continue;
    }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || '')) {
      const headers = tableCells(line).map(parseInlineMarkdown);
      index += 2;
      const rows: InlineToken[][][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(tableCells(lines[index++]).map(parseInlineMarkdown));
      blocks.push({ type: 'table', headers, rows });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', inline: parseInlineMarkdown(quote.join('\n')) });
      continue;
    }
    const list = line.match(/^\s*([-*+]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items: InlineToken[][] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-*+]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(parseInlineMarkdown(item[2])); index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
    blocks.push({ type: 'paragraph', inline: parseInlineMarkdown(paragraph.join('\n')) });
  }
  return blocks;
}
