import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdown, stripTerminalControlCodes } from '../apps/desktop/src/renderer/src/utils/markdown.ts';

test('Copilot markdown parser recognizes common readable blocks', () => {
  const blocks = parseMarkdown('# Result\n\n- first\n- **second**\n\n```js\nconst ok = true;\n```\n\n| Name | State |\n| --- | --- |\n| Build | Pass |');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'list', 'code', 'table']);
  assert.equal(blocks[1].type === 'list' && blocks[1].items[1][0].type, 'strong');
  assert.equal(blocks[2].type === 'code' && blocks[2].language, 'js');
});

test('Copilot markdown parser removes terminal control sequences', () => {
  assert.equal(stripTerminalControlCodes('\u001b[32mPassed\u001b[0m'), 'Passed');
});

test('Copilot markdown links accept web URLs but not executable schemes', () => {
  const blocks = parseMarkdown('[Docs](https://example.test) [unsafe](javascript:alert(1))');
  assert.equal(blocks[0].type === 'paragraph' && blocks[0].inline[0].type, 'link');
  assert.equal(blocks[0].type === 'paragraph' && blocks[0].inline.some(token => token.type === 'link' && token.href?.startsWith('javascript:')), false);
});
