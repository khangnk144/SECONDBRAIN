import { Node } from '@tiptap/core';

export interface WikilinkAttributes {
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
}

/**
 * `[[target#heading|alias]]` or `![[…]]` (SPEC §4.4) as one inline atom. The attributes are the
 * parts the server reads from the raw text, so the node serialises back to the same link.
 * Behaviour (rendering, click handling, autocomplete) is added by the editor UI via `.extend()`.
 */
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: '' },
      heading: { default: null },
      alias: { default: null },
      embed: { default: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
        getAttrs: (element) => ({
          target: element.getAttribute('data-target') ?? '',
          heading: element.getAttribute('data-heading'),
          alias: element.getAttribute('data-alias'),
          embed: element.getAttribute('data-embed') === 'true',
        }),
      },
    ];
  },

  renderHTML({ node }) {
    const attrs = node.attrs as WikilinkAttributes;
    const label = attrs.alias ?? (attrs.target || attrs.heading || '');
    return [
      'span',
      {
        'data-wikilink': '',
        'data-target': attrs.target,
        ...(attrs.heading === null ? {} : { 'data-heading': attrs.heading }),
        ...(attrs.alias === null ? {} : { 'data-alias': attrs.alias }),
        'data-embed': attrs.embed ? 'true' : 'false',
      },
      label,
    ];
  },
});
