import { forwardRef, type ReactNode } from 'react';
import { parseMarkdown, type InlineToken } from '../utils/markdown';

function inlineContent(tokens: InlineToken[]) {
  return tokens.map((token, index): ReactNode => {
    const key = `${token.type}-${index}`;
    if (token.type === 'strong') return <strong key={key}>{token.text}</strong>;
    if (token.type === 'code') return <code key={key}>{token.text}</code>;
    if (token.type === 'link') return <a key={key} href={token.href} target="_blank" rel="noreferrer">{token.text}</a>;
    return <span key={key}>{token.text}</span>;
  });
}

export const MarkdownOutput = forwardRef<HTMLDivElement, { output: string }>(function MarkdownOutput({ output }, ref) {
  const blocks = parseMarkdown(output);
  if (!blocks.length) return <div className="copilot-markdown-output copilot-output-empty" ref={ref}>Copilot output will appear here.</div>;
  return (
    <div className="copilot-markdown-output" ref={ref} aria-live="polite">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === 'heading') {
          const Heading = `h${Math.min(block.level + 2, 6)}` as keyof JSX.IntrinsicElements;
          return <Heading key={key}>{inlineContent(block.inline)}</Heading>;
        }
        if (block.type === 'paragraph') return <p key={key}>{inlineContent(block.inline)}</p>;
        if (block.type === 'quote') return <blockquote key={key}>{inlineContent(block.inline)}</blockquote>;
        if (block.type === 'code') return <div className="copilot-code-block" key={key}>{block.language && <span>{block.language}</span>}<pre><code>{block.text}</code></pre></div>;
        if (block.type === 'rule') return <hr key={key} />;
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return <List key={key}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineContent(item)}</li>)}</List>;
        }
        return <div className="copilot-table-wrap" key={key}><table><thead><tr>{block.headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineContent(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineContent(cell)}</td>)}</tr>)}</tbody></table></div>;
      })}
    </div>
  );
});
