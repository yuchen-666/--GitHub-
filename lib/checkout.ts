import { memberGameNames, type Member } from './members';

export type CheckoutCount = {
  memberId: string;
  gameId: string;
  count: number;
};

export type CheckoutResult = {
  counts: CheckoutCount[];
  recognizedNames: { name: string; count: number }[];
  recognizedText: string;
};

export type OcrWord = {
  text: string;
  bbox: { x0: number; x1: number; y0: number; y1: number };
};

export type OcrBlock = {
  paragraphs?: { lines?: { words?: OcrWord[] }[] }[];
};

export type OcrNameCell = {
  name: string;
  bbox: OcrWord['bbox'];
};

function normalizeName(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s_\-‐‑–—・·.]/g, '');
}

function countNameInText(text: string, rawName: string) {
  const name = normalizeName(rawName);
  if (!name) return 0;

  // A one-character alias must be a complete OCR token, rather than a
  // character in another player's name. Tesseract sometimes joins a score
  // directly to the name (for example “哥219”), so digits are boundaries.
  if (name.length === 1) {
    const escaped = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (text.match(new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'gu')) ?? []).length;
  }

  const countIn = (value: string) => {
    let count = 0;
    let from = 0;
    while (true) {
      const index = value.indexOf(name, from);
      if (index === -1) break;
      count += 1;
      from = index + name.length;
    }
    return count;
  };
  const lineCount = text.split(/\r?\n/).reduce((sum, line) => sum + countIn(normalizeName(line)), 0);
  // Tesseract occasionally inserts a line break inside a name.
  return Math.max(lineCount, countIn(normalizeName(text)));
}

export function countMemberAppearances(text: string, members: Member[]) {
  return members.map((member) => ({
    memberId: member.id,
    gameId: member.gameId,
    count: memberGameNames(member).reduce((sum, name) => sum + countNameInText(text, name), 0),
  }));
}

export function extractTableNameCells(blocks: OcrBlock[]): OcrNameCell[] {
  const lines = blocks.flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? []).map((line) =>
        (line.words ?? [])
          .filter((word) => word.text.trim())
          .sort((a, b) => a.bbox.x0 - b.bbox.x0),
      ),
    ),
  );
  const heights = lines.flat().map((word) => word.bbox.y1 - word.bbox.y0);
  const averageHeight = heights.length
    ? heights.reduce((sum, height) => sum + height, 0) / heights.length
    : 16;
  const tolerance = Math.max(12, averageHeight * 1.5);

  const numberPositions = lines
    .flatMap((words) => words.filter((word, index) => {
      if (!/^-?\d{1,4}$/.test(word.text.trim())) return false;
      const previous = words[index - 1];
      // Digits within a nickname (such as 晚风11) sit immediately next to
      // letters and must not be mistaken for a score column.
      return !previous || word.bbox.x0 - previous.bbox.x1 > tolerance || /^-?\d{1,4}$/.test(previous.text.trim());
    }))
    .map((word) => (word.bbox.x0 + word.bbox.x1) / 2)
    .sort((a, b) => a - b);
  const clusters: { x: number; count: number }[] = [];

  for (const x of numberPositions) {
    const previous = clusters.at(-1);
    if (previous && Math.abs(x - previous.x) <= tolerance) {
      previous.x = (previous.x * previous.count + x) / (previous.count + 1);
      previous.count += 1;
    } else {
      clusters.push({ x, count: 1 });
    }
  }

  const scoreColumns = clusters
    .filter((cluster) => cluster.count >= Math.max(1, lines.length / 3))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .sort((a, b) => a.x - b.x)
    .map((cluster) => cluster.x);

  // rmj.club often shows three score columns followed by a fourth name
  // without a score. Accept either three or four detected score columns.
  if (scoreColumns.length < 3) return [];

  const cells: OcrNameCell[] = [];

  for (const words of lines) {
    for (let column = 0; column <= scoreColumns.length; column += 1) {
      const left =
        column === 0 ? -Infinity : scoreColumns[column - 1] + tolerance;
      const right = column === scoreColumns.length ? Infinity : scoreColumns[column] - tolerance;
      const candidateWords = words
        .filter((word) => {
          const center = (word.bbox.x0 + word.bbox.x1) / 2;
          return center > left && center < right;
        });
      const groups: OcrWord[][] = [];
      for (const word of candidateWords) {
        const group = groups.at(-1);
        if (!group || word.bbox.x0 - group.at(-1)!.bbox.x1 > tolerance) groups.push([word]);
        else group.push(word);
      }
      for (const group of groups) {
        const name = group.map((word) => word.text.trim()).join('');
        const key = normalizeName(name);
        if (!key || /^-?\d+(?:\.\d+)?$/.test(key) || /^(一|二|三|四)位$/.test(key)) continue;
        cells.push({
          name,
          bbox: {
            x0: Math.min(...group.map((word) => word.bbox.x0)),
            x1: Math.max(...group.map((word) => word.bbox.x1)),
            y0: Math.min(...group.map((word) => word.bbox.y0)),
            y1: Math.max(...group.map((word) => word.bbox.y1)),
          },
        });
      }
    }
  }

  return cells;
}

export function countNamesInTable(blocks: OcrBlock[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const { name } of extractTableNameCells(blocks)) {
    const key = normalizeName(name);
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { name, count: 1 });
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
}

// A cell is one hand, even when Tesseract splits a nickname into several
// words. Prefer exact matches; only permit a single substituted CJK character
// in a longer nickname when exactly one registered card could match it.
export function matchOcrName(name: string, members: Member[]): string | null {
  const candidate = normalizeName(name).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!candidate) return null;

  const exact = new Set<string>();
  for (const member of members) {
    if (memberGameNames(member).some((alias) => normalizeName(alias) === candidate)) exact.add(member.id);
  }
  if (exact.size === 1) return [...exact][0];
  if (exact.size > 1 || candidate.length < 4 || !/\p{Script=Han}/u.test(candidate)) return null;

  const near = new Set<string>();
  for (const member of members) {
    for (const alias of memberGameNames(member)) {
      const key = normalizeName(alias);
      if (key.length !== candidate.length || !/\p{Script=Han}/u.test(key)) continue;
      let differences = 0;
      for (let index = 0; index < key.length; index += 1) {
        if (key[index] !== candidate[index]) differences += 1;
      }
      if (differences === 1) near.add(member.id);
    }
  }
  return near.size === 1 ? [...near][0] : null;
}

export function analyzeCheckoutText(
  text: string,
  blocks: OcrBlock[],
  members: Member[],
  correctedCells?: OcrNameCell[],
): CheckoutResult {
  const cells = correctedCells ?? extractTableNameCells(blocks);
  const recognizedNames = (() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const { name } of cells) {
      const key = normalizeName(name);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { name, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  })();
  const tableCounts = new Map<string, number>();
  for (const cell of cells) {
    const memberId = matchOcrName(cell.name, members);
    if (memberId) tableCounts.set(memberId, (tableCounts.get(memberId) ?? 0) + 1);
  }
  const counts = members.map((member) => {
    const tableCount = tableCounts.get(member.id) ?? 0;
    const textCount = memberGameNames(member).reduce((sum, name) => sum + countNameInText(text, name), 0);
    // Plain text is a fallback for screenshots where table geometry could not
    // be recovered. It must not add duplicate hits to parsed cells.
    const count = cells.length ? Math.max(tableCount, textCount) : textCount;
    return {
      memberId: member.id,
      gameId: member.gameId,
      count,
    };
  });

  return { counts, recognizedNames, recognizedText: text };
}
