/**
 * Erzeugt MCP-Tools direkt aus der OpenAPI-Spezifikation. Dadurch können Tool-Definitionen
 * und API nie auseinanderlaufen: jede Route mit operationId ist automatisch ein Tool.
 */

type JsonSchema = Record<string, unknown>;

interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

interface OpenApiOperation {
  operationId?: string;
  /** false = nicht als MCP-Tool anbieten (z. B. Datei-Up-/Downloads) */
  "x-mcp"?: boolean;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
}

export interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, JsonSchema>; required: string[] };
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  hasBody: boolean;
}

const METHODS = ["get", "post", "put", "patch", "delete"];

/** Löst lokale $ref-Verweise auf, damit jedes Tool-Schema in sich geschlossen ist. */
export function deref(schema: unknown, doc: OpenApiDocument, depth = 0): unknown {
  if (depth > 20 || schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((s) => deref(s, doc, depth + 1));
  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref === "string" && obj.$ref.startsWith("#/components/schemas/")) {
    const target = doc.components?.schemas?.[obj.$ref.slice("#/components/schemas/".length)];
    const { $ref: _ignored, ...rest } = obj;
    return { ...(deref(target, doc, depth + 1) as object), ...rest };
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deref(v, doc, depth + 1)]));
}

export function buildTools(doc: OpenApiDocument): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op?.operationId || op["x-mcp"] === false) continue;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      const pathParams: string[] = [];
      const queryParams: string[] = [];
      for (const p of op.parameters ?? []) {
        if (p.in !== "path" && p.in !== "query") continue;
        properties[p.name] = {
          ...(deref(p.schema ?? {}, doc) as JsonSchema),
          ...(p.description ? { description: p.description } : {}),
        };
        if (p.required || p.in === "path") required.push(p.name);
        (p.in === "path" ? pathParams : queryParams).push(p.name);
      }
      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        properties.body = deref(bodySchema, doc) as JsonSchema;
        if (op.requestBody?.required) required.push("body");
      }
      tools.push({
        name: op.operationId,
        description: [op.summary, op.description].filter(Boolean).join("\n\n") || op.operationId,
        inputSchema: { type: "object", properties, required },
        method: method.toUpperCase(),
        path,
        pathParams,
        queryParams,
        hasBody: Boolean(bodySchema),
      });
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

/** Baut aus Tool-Argumenten den HTTP-Aufruf. */
export function toRequest(tool: ToolDefinition, args: Record<string, unknown>) {
  let url = tool.path;
  for (const name of tool.pathParams) {
    const value = args[name];
    if (value === undefined || value === null) throw new Error(`Parameter "${name}" fehlt`);
    url = url.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  const query = new URLSearchParams();
  for (const name of tool.queryParams) {
    const value = args[name];
    if (value !== undefined && value !== null) query.set(name, String(value));
  }
  const qs = query.toString();
  return {
    url: qs ? `${url}?${qs}` : url,
    method: tool.method,
    body: tool.hasBody && args.body !== undefined ? JSON.stringify(args.body) : undefined,
  };
}
