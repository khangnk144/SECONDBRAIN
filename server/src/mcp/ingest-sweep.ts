import {
  failStaleRuns,
  manifestFile,
  manifestIds,
  readManifest,
  writeManifest,
} from './ingest-manifest.js';
import type { McpDeps } from './mcp-deps.js';

/** Runs abandoned for more than an hour are marked failed (`stale`) in every manifest. */
export async function sweepStaleRuns(deps: McpDeps): Promise<void> {
  const dir = deps.context.vault.paths.ingestDir;
  for (const sourceId of await manifestIds(dir)) {
    await deps.locks.run(manifestFile(dir, sourceId), async () => {
      const manifest = await readManifest(dir, sourceId);
      if (manifest && failStaleRuns(manifest, deps.context.now()))
        await writeManifest(dir, manifest);
    });
  }
}
