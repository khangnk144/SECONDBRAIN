import { z } from 'zod';
import { defineTool, type ToolHost } from './define-tool.js';
import { ingestBegin, ingestComplete, ingestFail } from './ingest-service.js';
import type { McpDeps } from './mcp-deps.js';
import { wikiLint } from './wiki-lint.js';

const runIdArg = z.string().min(1).max(200);

/** The ingest manifest tools and the wiki health report. */
export function registerIngestTools(host: ToolHost, deps: McpDeps): void {
  defineTool(
    host,
    {
      name: 'ingest_begin',
      description:
        'Start ingesting a source (sourceId from list_sources); returns runId. Refused when ' +
        'this content is already ingested (force: true ingests it again) or another run is ' +
        'in progress.',
      input: { sourceId: z.string().min(1).max(100), force: z.boolean().optional() },
      readOnly: false,
    },
    ({ sourceId, force }) => ingestBegin(deps, sourceId, force === true),
  );

  defineTool(
    host,
    {
      name: 'ingest_complete',
      description:
        'Finish an ingest run, listing every wiki page you wrote (1 to 50, all must exist). ' +
        'The server appends the log line. Refused (NEEDS_REVIEW) for a source without ' +
        'readable text, and when the source changed during the run.',
      input: { runId: runIdArg, outputs: z.array(z.string().min(1).max(4096)).min(1).max(50) },
      readOnly: false,
    },
    ({ runId, outputs }) => ingestComplete(deps, runId, outputs),
  );

  defineTool(
    host,
    {
      name: 'ingest_fail',
      description: 'End an ingest run as failed, with a short reason (up to 300 characters).',
      input: { runId: runIdArg, reason: z.string().min(1).max(300) },
      readOnly: false,
    },
    ({ runId, reason }) => ingestFail(deps, runId, reason),
  );

  defineTool(
    host,
    {
      name: 'wiki_lint',
      description:
        'Structural report of wiki/: orphan pages, broken links, concepts linked 3+ times ' +
        'without a page, sources not ingested, pages whose source changed, pages not updated ' +
        'for 90 days. Candidates to review, not errors. Each list holds at most 100 entries; ' +
        'counts has the full totals. Read-only.',
      input: {},
      readOnly: true,
    },
    async () => ({ ...(await wikiLint(deps)) }),
  );
}
