import { z } from 'zod';
import { buildGraph, localGraph } from '../graph/vault-graph.js';
import { addDays } from '../lib/local-date.js';
import { guardVaultPath } from '../security/path-guard.js';
import { notFound } from '../vault/vault-errors.js';
import { defineTool, type ToolHost } from './define-tool.js';
import { todayOf, type McpDeps } from './mcp-deps.js';

const pathArg = z.string().min(1).max(4096).describe('Vault-relative path, e.g. "wiki/index.md".');

/** Deadlines, Today and the local graph, from the same services as the screens. Read-only. */
export function registerViewTools(host: ToolHost, deps: McpDeps): void {
  const { context } = deps;

  defineTool(
    host,
    {
      name: 'get_upcoming_deadlines',
      description:
        'Open deadlines (note deadlines and dated tasks) from today to today + days, plus ' +
        'overdue ones, in the order the Today screen uses. Read-only.',
      input: { days: z.number().int().min(1).max(365).optional() },
      readOnly: true,
    },
    async ({ days = 14 }) => {
      await context.settled();
      const today = todayOf(deps);
      const items = context.deadlines
        .items({ to: addDays(today, days) })
        .filter((item) => !item.done);
      return { today, days, items };
    },
  );

  defineTool(
    host,
    {
      name: 'get_today',
      description:
        "The Today screen: summary, days that have deadlines, today's tasks, projects in progress. Read-only.",
      input: {},
      readOnly: true,
    },
    async () => {
      await context.settled();
      const view = context.deadlines.today();
      const days = view.strip.days.filter((day) => day.items.length > 0);
      return { ...view, strip: { ...view.strip, days } };
    },
  );

  defineTool(
    host,
    {
      name: 'graph_neighbors',
      description: 'Notes linked to a note, up to depth 1 or 2 (the local brain graph). Read-only.',
      input: { path: pathArg, depth: z.union([z.literal(1), z.literal(2)]).optional() },
      readOnly: true,
    },
    async ({ path: input, depth = 1 }) => {
      const path = guardVaultPath(input);
      await context.settled();
      const graph = buildGraph(context.index.graphRows());
      const drawn = graph.nodes.some((node) => node.id === path);
      if (!drawn && context.index.getNote(path) === null) throw notFound(path);
      const local = localGraph(graph, path, depth);
      return { path, depth, nodes: local.nodes, edges: local.edges };
    },
  );
}
