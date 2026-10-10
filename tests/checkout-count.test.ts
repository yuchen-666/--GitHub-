import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeCheckoutText, countMemberAppearances, countNamesInTable, type OcrBlock, type OcrWord } from '../lib/checkout';
import type { Member } from '../lib/members';
const initialMembers: Member[] = [
  { id: 'test-card', wechatId: '测试主卡', gameId: 'demo', aliases: ['甲', '测试别名'], discount: '五折', balance: 0 },
];

const rows = [
  ['测试别名', '访客11', '测试乙', '甲'],
  ['测试别名', '访客11', '甲', 'guest'],
  ['visitor', '测试乙', 'guest', '访客11'],
  ['测试别名', '甲', '测试丙', 'demo'],
];

function word(text: string, x: number, y: number): OcrWord {
  return { text, bbox: { x0: x, x1: x + 45, y0: y, y1: y + 18 } };
}

function nameWords(text: string, x: number, y: number) {
  return text === '访客11'
    ? [word('访客', x, y), word('11', x + 46, y)]
    : [word(text, x, y)];
}

const blocks: OcrBlock[] = [{
  paragraphs: [{
    lines: rows.map((row, index) => ({
      words: [
        word(row[0], 20, index * 30), word('568', 150, index * 30),
        ...nameWords(row[1], 260, index * 30), word('324', 390, index * 30),
        word(row[2], 500, index * 30), word('108', 630, index * 30),
        word(row[3], 740, index * 30),
      ],
    })),
  }],
}];

test('three score columns still expose the fourth player-name column', () => {
  const names = countNamesInTable(blocks);
  assert.equal(names.find((item) => item.name === '甲')?.count, 3);
  assert.equal(names.find((item) => item.name === 'demo')?.count, 1);
});

test('shared card combines the best count for each alias, not the best total', () => {
  // Simulate OCR text missing the short alias even though its word boxes are
  // present; the three long aliases and one primary name remain in text.
  const text = '测试别名\n测试别名\n测试别名\ndemo';
  const result = analyzeCheckoutText(text, blocks, initialMembers);
  assert.equal(result.counts.find((item) => item.memberId === 'test-card')?.count, 7);
});

test('single-character alias accepts adjoining score digits but not longer names', () => {
  const card = initialMembers.find((member) => member.id === 'test-card')!;
  assert.equal(countMemberAppearances('甲219 甲291 甲108 demo 甲甲', [card])[0].count, 4);
});
