/**
 * "Gợi ý liên kết" (SPEC F33, R1): candidates come from retrieval (in scope, not the note itself,
 * not already linked from it or from the selection); the model picks at most 5 by id and every
 * pick is checked against the candidates. A proposal only: nothing is written.
 */
import { isNotePath } from '../../markdown/content-classes.js';
import { resolveLink } from '../../markdown/resolve-link.js';
import { scanWikilinks } from '../../markdown/wikilink-scan.js';
import type { VaultPath } from '../../vault/vault-types.js';
import { extractJsonObject } from '../intent/intent-validate.js';
import { suggestLinksSystem } from '../prompts/action-prompts.js';
import { detectLanguage } from '../prompts/answer-language.js';
import { dataBlock, sourceBlock } from '../prompts/data-blocks.js';
import { retrieveChunks } from '../retrieval/retrieve-chunks.js';
import type { RetrievedChunk } from '../retrieval/retrieval-types.js';
import {
  cleanReason,
  PROMPT_TEXT_CHARS,
  QUERY_CHARS,
  unusableReply,
  type ActionDeps,
  type LinkSuggestion,
} from './action-types.js';

const MAX_CANDIDATES = 15;
const MAX_LINKS = 5;
const EXCERPT_CHARS = 400;

/** The note itself, the notes it links to, and the notes the selection already links to. */
function alreadyLinked(text: string, path: VaultPath | null, deps: ActionDeps): Set<VaultPath> {
  const out = new Set<VaultPath>();
  if (path) {
    out.add(path);
    for (const link of deps.index.outlinks(path)) if (link.toPath) out.add(link.toPath);
  }
  const catalog = deps.index.linkCatalog();
  scanWikilinks(text, 0, text.length, (hit) => {
    if (hit.target === '') return;
    const resolution = resolveLink(catalog, { kind: 'wikilink', target: hit.target }, path ?? '');
    if (resolution.status === 'resolved') out.add(resolution.path);
  });
  return out;
}

interface Candidate {
  id: string;
  chunk: RetrievedChunk;
}

export async function suggestLinks(
  text: string,
  path: VaultPath | null,
  deps: ActionDeps,
): Promise<{ links: LinkSuggestion[] }> {
  const retrieval = await retrieveChunks(text.slice(0, QUERY_CHARS), {
    index: deps.index,
    vault: deps.vault,
    sources: deps.sources,
    runtime: deps.runtime,
    exclude: alreadyLinked(text, path, deps),
    signal: deps.signal,
    chunkLimit: 40,
    charLimit: Number.POSITIVE_INFINITY,
  });
  const candidates: Candidate[] = [];
  for (const chunk of retrieval.chunks) {
    if (!isNotePath(chunk.path) || candidates.some((c) => c.chunk.path === chunk.path)) continue;
    candidates.push({ id: `C${candidates.length + 1}`, chunk });
    if (candidates.length === MAX_CANDIDATES) break;
  }
  if (candidates.length === 0) return { links: [] };

  const language = detectLanguage(text, deps.uiLanguage);
  const blocks = candidates.map(({ id, chunk }) =>
    sourceBlock({ id, path: chunk.path, title: chunk.title }, chunk.text.slice(0, EXCERPT_CHARS)),
  );
  const reply = await deps.runtime.complete({
    purpose: 'action',
    json: true,
    maxTokens: 600,
    temperature: 0,
    system: suggestLinksSystem(language),
    messages: [
      {
        role: 'user',
        content: `${dataBlock('text', text.slice(0, PROMPT_TEXT_CHARS))}\n\n<candidates>\n${blocks.join('\n')}\n</candidates>`,
      },
    ],
    signal: deps.signal,
  });
  const parsed = extractJsonObject(reply.text) as { links?: unknown } | undefined;
  if (!parsed || !Array.isArray(parsed.links)) throw unusableReply('malformed');
  const links: LinkSuggestion[] = [];
  for (const entry of parsed.links as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, path: named, reason } = entry as Record<string, unknown>;
    // An id the server offered, or (leniently) the exact path of an offered candidate.
    const match = candidates.find(
      (c) => (typeof id === 'string' && c.id === id.trim().toUpperCase()) || c.chunk.path === named,
    );
    if (!match || links.some((link) => link.path === match.chunk.path)) continue;
    links.push({ path: match.chunk.path, title: match.chunk.title, reason: cleanReason(reason) });
    if (links.length === MAX_LINKS) break;
  }
  return { links };
}
