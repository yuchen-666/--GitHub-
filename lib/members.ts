export type Member = {
  id: string;
  wechatId: string;
  gameId: string;
  aliases: string[];
  discount: string;
  balance: number;
};

// GitHub source edition starts empty; never commit real member balances.
export const initialMembers: Member[] = [];

export function memberGameNames(member: Pick<Member, 'gameId' | 'aliases'>) {
  return [member.gameId, ...member.aliases];
}

export function storedGameNames(member: Pick<Member, 'gameId' | 'aliases'>) {
  return memberGameNames(member).join('\n');
}

export function parseStoredGameNames(value: string) {
  const [gameId = '', ...aliases] = value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  return { gameId, aliases };
}
