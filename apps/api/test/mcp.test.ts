import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, setupTestDb, TOKEN, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const { app } = testClient(db);

async function connect(token = TOKEN) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (url, init) => app.request(String(url), init as RequestInit),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

beforeAll(() => resetDb(db));
afterAll(() => close());

describe("MCP-Server", () => {
  it("bietet jede API-Operation als Tool an", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["createContact", "listCases", "createFundingCase", "deadlineDigest"]),
    );
    const create = tools.find((t) => t.name === "createFundingCase");
    expect(create?.inputSchema.required).toEqual(["id", "body"]);
    // $ref-Verweise sind aufgelöst
    expect(JSON.stringify(tools)).not.toContain("#/components/schemas");
    await mcp.close();
  });

  it("führt Tools über die API aus", async () => {
    const mcp = await connect();
    const created = await mcp.callTool({
      name: "createContact",
      arguments: { body: { kind: "organisation", organisationName: "Gemeinde Beispielhausen" } },
    });
    expect(created.isError).toBe(false);
    const contact = JSON.parse((created.content as { text: string }[])[0]!.text);
    const found = await mcp.callTool({ name: "listContacts", arguments: { q: "beispiel" } });
    expect((found.content as { text: string }[])[0]!.text).toContain(contact.id);

    const bad = await mcp.callTool({ name: "getContact", arguments: { id: "keine-uuid" } });
    expect(bad.isError).toBe(true);
    await mcp.close();
  });

  it("verlangt ein gültiges Token", async () => {
    await expect(connect("falsch")).rejects.toThrow();
  });
});
