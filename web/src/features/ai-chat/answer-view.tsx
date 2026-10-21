import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { buildLinkCatalog } from '../../lib/link-resolution';
import { groupCitations, type CitedGroup, type CitedInline } from './answer-citations';
import {
  answerLinkHandlers,
  answerLinkHref,
  openAnswerTarget,
  resolveAnswerLink,
} from './answer-links';
import { parseAnswer, type Inline } from './answer-markdown';

interface LinkContext {
  resolve: (target: string) => VaultPath | null;
  /** "tr. 3" after a cited PDF page. */
  pageText: (page: number) => string;
}

function AnswerLink({
  path,
  page,
  label,
}: {
  path: VaultPath;
  page: number | null;
  label: string;
}) {
  return (
    <a
      className="ai-answer__link"
      href={answerLinkHref(path)}
      {...answerLinkHandlers((newTab) => openAnswerTarget(path, page, newTab))}
    >
      {label}
    </a>
  );
}

/** "(Xác suất thống kê; bài báo.pdf, tr. 3)": a source, clearly apart from the sentence. */
function Citation({ group, context }: { group: CitedGroup; context: LinkContext }) {
  return (
    <span className="ai-answer__cite">
      (
      {group.links.map((link, index) => {
        const path = context.resolve(link.target);
        return (
          <Fragment key={index}>
            {index > 0 ? '; ' : null}
            {path ? <AnswerLink path={path} page={link.page} label={link.label} /> : link.label}
            {link.page !== null ? `, ${context.pageText(link.page)}` : null}
          </Fragment>
        );
      })}
      )
    </span>
  );
}

function renderInline(nodes: readonly (Inline | CitedInline)[], context: LinkContext): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'break':
        return <br key={index} />;
      case 'code':
        return <code key={index}>{node.text}</code>;
      case 'bold':
        return <strong key={index}>{renderInline(node.children, context)}</strong>;
      case 'italic':
        return <em key={index}>{renderInline(node.children, context)}</em>;
      case 'cite':
        return <Citation key={index} group={node} context={context} />;
      case 'link': {
        const path = context.resolve(node.target);
        // A link that leads nowhere is shown as its text, never as a dead link.
        if (!path) return <Fragment key={index}>{node.label}</Fragment>;
        return <AnswerLink key={index} path={path} page={node.page} label={node.label} />;
      }
    }
  });
}

/**
 * A finished answer, rendered from its small Markdown. `known` are the paths the answer may link
 * to (its sources and citations); `fromPath` is where links resolve from (the note, else the root).
 * With `citations` (text answers) its links are the sources it cites, shown in parentheses; the
 * rows of a deadline list keep their own links.
 */
export function AnswerView({
  markdown,
  known,
  fromPath,
  citations = false,
}: {
  markdown: string;
  known: readonly VaultPath[];
  fromPath: VaultPath;
  citations?: boolean;
}) {
  const { t } = useTranslation();
  const blocks = useMemo(() => parseAnswer(markdown), [markdown]);
  const context = useMemo<LinkContext>(() => {
    const catalog = buildLinkCatalog(known);
    return {
      resolve: (target) => resolveAnswerLink(target, catalog, fromPath),
      pageText: (page) => t('ai-chat.sources.page', { page }),
    };
  }, [known, fromPath, t]);
  const inline = (nodes: Inline[]) =>
    renderInline(citations ? groupCitations(nodes) : nodes, context);
  return (
    <div className="ai-answer">
      {blocks.map((block, index) => {
        if (block.kind === 'paragraph') return <p key={index}>{inline(block.children)}</p>;
        const List = block.ordered ? 'ol' : 'ul';
        return (
          <List key={index}>
            {block.items.map((item, at) => (
              <li key={at}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
