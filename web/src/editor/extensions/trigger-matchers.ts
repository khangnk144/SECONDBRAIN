import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';

/** The four popups that open while typing (F3, F4.1, F6.1). */
export type TriggerKind = 'slash' | 'wikilink' | 'tag' | 'date';

export interface TriggerMatch {
  kind: TriggerKind;
  /** Start of the trigger characters (`/`, `[[` or `![[`, `#`, `@` or `📅`). */
  from: number;
  /** The caret. */
  to: number;
  /** What was typed after the trigger characters. */
  query: string;
  /** `![[`: the link will be an embed. */
  embed: boolean;
}

const OBJECT = '￼';
const leafText = (leaf: ProseMirrorNode) => (leaf.type.name === 'hardBreak' ? '\n' : OBJECT);

const SLASH = /^\/((?!\s)[^/\n￼]{0,32})?$/u;
const TAG = /(^|[\s(])#([\p{L}\p{N}\p{M}_/-]*)$/u;
const AT_DATE = /(^|\s)@([^\s@￼]{0,24})$/u;
const EMOJI_DATE = /\u{1F4C5}️? ?([\d-]{0,10})$/u;
const MAX_LINK_QUERY = 160;

/** The popup of `kind` that the text before the caret asks for, if any. */
export function matchTrigger(kind: TriggerKind, $pos: ResolvedPos): TriggerMatch | null {
  const parent = $pos.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  if ($pos.marks().some((mark) => mark.type.name === 'code')) return null;
  const before = parent.textBetween(0, $pos.parentOffset, undefined, leafText);
  const start = $pos.start();
  const at = (offset: number, query: string, embed = false): TriggerMatch => ({
    kind,
    from: start + offset,
    to: $pos.pos,
    query,
    embed,
  });

  switch (kind) {
    case 'slash': {
      // Only on an otherwise empty line: the paragraph holds nothing but `/query`.
      if (parent.type.name !== 'paragraph' || $pos.parentOffset !== parent.content.size)
        return null;
      if (/^table(Cell|Header)$/.test($pos.node(-1).type.name)) return null;
      const match = SLASH.exec(before);
      return match ? at(0, match[1] ?? '') : null;
    }
    case 'wikilink': {
      const open = before.lastIndexOf('[[');
      if (open === -1 || before.charAt(open - 1) === '\\') return null;
      const query = before.slice(open + 2);
      if (query.length > MAX_LINK_QUERY || /\]\]|[\n￼]/u.test(query)) return null;
      const embed = before.charAt(open - 1) === '!';
      return at(embed ? open - 1 : open, query, embed);
    }
    case 'tag': {
      const match = TAG.exec(before);
      if (!match) return null;
      const hash = (match.index ?? 0) + (match[1] ?? '').length;
      if (match[1] === '(' && before.charAt(hash - 2) === ']') return null;
      return at(hash, match[2] ?? '');
    }
    case 'date': {
      const emoji = EMOJI_DATE.exec(before);
      if (emoji) return at(emoji.index ?? 0, emoji[1] ?? '');
      const match = AT_DATE.exec(before);
      if (!match) return null;
      return at((match.index ?? 0) + (match[1] ?? '').length, match[2] ?? '');
    }
  }
}

/** Kinds in the order they are tried when a trigger is typed. */
export const TRIGGER_KINDS: readonly TriggerKind[] = ['slash', 'wikilink', 'date', 'tag'];
