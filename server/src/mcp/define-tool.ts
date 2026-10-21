import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { toolFailure, toolFailureOf, toolSuccess } from './mcp-tool-result.js';

export type ToolShape = Record<string, z.ZodType>;
export type ToolArgs<S extends ToolShape> = z.infer<z.ZodObject<S>>;

export interface ToolSpec<S extends ToolShape> {
  name: string;
  /** Short, English, says what the tool may do. */
  description: string;
  input: S;
  /** Read-only tools are marked so clients may run them without asking each time. */
  readOnly: boolean;
}

export interface ToolHost {
  server: McpServer;
  logger: AppLogger;
}

/**
 * Registers one tool whose handler returns plain data: success becomes JSON text plus
 * `structuredContent`, any thrown error becomes `isError: true` with `{ code, message, details }`.
 * Arguments are checked by the SDK against the zod shape before the handler runs.
 */
export function defineTool<S extends ToolShape>(
  host: ToolHost,
  spec: ToolSpec<S>,
  run: (args: ToolArgs<S>) => Promise<Record<string, unknown>>,
): void {
  const callback = async (args: unknown) => {
    try {
      return toolSuccess(await run(args as ToolArgs<S>));
    } catch (error) {
      const failure = toolFailureOf(error);
      // Code or name only: messages of unexpected errors can hold paths (SPEC §5 Logs).
      if (failure.code === 'INTERNAL') {
        host.logger.error(`MCP tool ${spec.name} failed (${errorCodeOf(error)}).`);
      }
      return toolFailure(failure);
    }
  };
  host.server.registerTool(
    spec.name,
    {
      description: spec.description,
      inputSchema: spec.input,
      annotations: { readOnlyHint: spec.readOnly },
    },
    callback as Parameters<McpServer['registerTool']>[2],
  );
}
