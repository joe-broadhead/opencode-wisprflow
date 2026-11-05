// A loopback Streamable-HTTP MCP server. By default it lists one known read, one known write (when Wispr Flow has
// any) and one tool the plugin has never seen. With `catalog: "wisprflow"` it lists every known tool, and
// the new tool. It answers JSON-RPC POSTs with plain JSON (no SSE stream) and records every tool call, its path and
// every request header. A `tools/call` answers with the tool's name, the path and its arguments as structured content;
// for a `query` that starts with "text", with text alone; or, for a `query` that starts with "fail", with an upstream
// error (`isError`) whose first line holds a signed URL. Every name and answer is made up; none is Wispr Flow content.
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import { ASK_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"

const schema = { type: "object", properties: { query: { type: "string" } } }
/** A tool the plugin has never seen. */
export const NEW_TOOL = { name: "shiny_new_tool", description: "A tool added upstream after the tool lists were written", annotations: {} }
/** The one known read and the one known write the host suite uses; the write is absent when Wispr Flow lists none. */
export const READ = READ_TOOLS.includes("search_meetings") ? "search_meetings" : READ_TOOLS[0]!
export const WRITE: string | undefined = WRITE_TOOLS[0]
const TOOLS = [
  { name: READ, description: "A known read", annotations: { readOnlyHint: true } },
  ...(WRITE ? [{ name: WRITE, description: "A known write", annotations: { readOnlyHint: false, destructiveHint: false } }] : []),
  NEW_TOOL,
].map((tool) => ({ ...tool, inputSchema: { type: "object", properties: {} } }))
const knownTool = (name: string, readOnlyHint: boolean) => ({ name, description: `Wispr Flow ${name}`, annotations: { readOnlyHint }, inputSchema: schema })
const CATALOG = [...READ_TOOLS.map((name) => knownTool(name, true)), ...ASK_TOOLS.map((name) => knownTool(name, true)), ...WRITE_TOOLS.map((name) => knownTool(name, false)), { ...NEW_TOOL, inputSchema: schema }]

/** The upstream error a "fail" query gets: two lines, the first with a signed URL. */
export const UPSTREAM_FAILURE = "Wispr Flow refused https://files.wisprflow.example/a.png?signature=fake-signature-123 for this input\nTraceback: second line"

export interface FakeMcpOptions {
  /** `wisprflow` lists every tool the plugin knows, as an account with all of Wispr Flow's features would. */
  readonly catalog?: "wisprflow"
  /** Answer every request with 401 and a bearer challenge, as Wispr Flow's server does before a sign-in. */
  readonly challenge?: true
}

export interface FakeMcp {
  readonly url: string
  /** Tool names called, in order. */
  readonly calls: string[]
  /** Each tool call with the path it was sent to, in order. */
  readonly called: { readonly tool: string; readonly path: string }[]
  /** Each tool call's arguments, in order. */
  readonly inputs: { readonly tool: string; readonly arguments: unknown }[]
  /** The `x-wisprflow-test` header of every request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: { query?: unknown } } }

export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const calls: string[] = []
  const called: { tool: string; path: string }[] = []
  const inputs: { tool: string; arguments: unknown }[] = []
  const markers: (string | undefined)[] = []
  const answer = (message: Message, path: string) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-wisprflow", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: options.catalog === "wisprflow" ? CATALOG : TOOLS })
      case "tools/call": {
        const tool = message.params?.name ?? ""
        calls.push(tool)
        called.push({ tool, path })
        const args = message.params?.arguments ?? {}
        inputs.push({ tool, arguments: args })
        if (String(args.query ?? "").startsWith("fail")) return reply({ content: [{ type: "text", text: UPSTREAM_FAILURE }], isError: true })
        if (String(args.query ?? "").startsWith("text")) return reply({ content: [{ type: "text", text: `text from ${tool}` }] })
        return reply({ content: [{ type: "text", text: `called ${tool}` }], structuredContent: { tool, path, arguments: args } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const server = createServer(async (request, response) => {
    markers.push(header(request, "x-wisprflow-test"))
    if (options.challenge) {
      const { port } = server.address() as AddressInfo
      const metadata = `http://127.0.0.1:${port}/.well-known/oauth-protected-resource`
      return void response
        .writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}", scope="openid offline_access"` })
        .end(JSON.stringify({ error: "invalid_token" }))
    }
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map((message) => answer(message, path))
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    called,
    inputs,
    markers,
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  }
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
