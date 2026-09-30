import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildTools, type OpenApiDocument, type ToolDefinition, toRequest } from "./tools.js";

export interface McpOptions {
  /** Liefert die aktuelle OpenAPI-Spezifikation. */
  getDocument: () => OpenApiDocument;
  /** Führt einen API-Aufruf in-process aus (inkl. Authentifizierung). */
  call: (req: { url: string; method: string; body?: string }) => Promise<Response>;
}

/**
 * Beantwortet eine MCP-Anfrage (Streamable HTTP, zustandslos). Pro Anfrage wird ein frischer
 * Server erzeugt; Tools werden einmalig aus der OpenAPI-Spezifikation abgeleitet.
 */
export function createMcpHandler(opts: McpOptions) {
  let tools: ToolDefinition[] | undefined;
  const getTools = () => {
    tools ??= buildTools(opts.getDocument());
    return tools;
  };

  return async (request: Request): Promise<Response> => {
    const server = new Server(
      { name: "objektakte", version: "0.1.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "Fallakte für Energieberatung. Objekte (Gebäude) sind der Anker: Kontakte hängen mit Rollen am Objekt, Vorgänge (Beratung, Förderantrag, Nachweis) am Objekt und Kunden. Förderfälle erzeugen Fristen automatisch. Beträge sind immer in Cent.",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const tool = getTools().find((t) => t.name === req.params.name);
      if (!tool) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unbekanntes Tool ${req.params.name}` }],
        };
      }
      try {
        const res = await opts.call(
          toRequest(tool, (req.params.arguments ?? {}) as Record<string, unknown>),
        );
        const text = res.status === 204 ? "OK" : await res.text();
        return { isError: res.status >= 400, content: [{ type: "text", text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        };
      }
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}
