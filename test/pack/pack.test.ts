// The packed tarball, installed and started in the real OpenCode 2.4.1 host.
//
// `opencode plugin add` refuses a local path ("Plugin target must be an npm registry package or Git package specifier"),
// so the test installs the tarball with npm into an isolated project and names the installed package in the project's
// `opencode.json` `plugins` — the same package the release publishes and the same entry a consumer pins by tag. It then
// starts `opencode serve` in an isolated home and offline environment, waits for the plugin to load, and calls the
// status RPC.
//
// The host binary: OPENCODE_BIN when set, otherwise the `opencode` on PATH when it is 2.4.1, otherwise the release
// installed into a temp folder with scripts disabled.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, test } from "node:test"

const root = fileURLToPath(new URL("../..", import.meta.url))
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "wisprflow-pack-")))
const VERSION = "2.4.1"

after(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_FREE_MODELS: "true",
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

/** A home, its XDG folders and a temp folder, all inside `base`. */
function isolated(base: string) {
  const home = join(base, "home")
  const env = {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: join(base, "tmp"),
  }
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
  return env
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as { port: number }
  await new Promise((done) => server.close(done))
  return port
}

/** The OpenCode 2.4.1 binary: the one the environment names, the one on PATH, or the release installed here. */
function opencodeBinary(): string {
  const given = process.env.OPENCODE_BIN
  if (given) {
    assert.equal(run(given, ["--version"], work).trim(), `opencode v${VERSION}`, "OPENCODE_BIN must be the 2.4.1 release")
    return given
  }
  const onPath = spawnSync("opencode", ["--version"], { encoding: "utf8" })
  if (onPath.status === 0 && onPath.stdout.trim() === `opencode v${VERSION}`) return "opencode"
  const dir = join(work, "opencode")
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "opencode-pack-host", private: true, type: "module" }))
  const binary = `@opencode/cli-${platform()}-${arch()}`
  run("npm", ["install", `@opencode/cli@${VERSION}`, `${binary}@${VERSION}`, "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"], dir)
  return join(dir, "node_modules", binary, "bin", "opencode")
}

interface Response {
  readonly status: number
  readonly ok: boolean
  readonly body: Record<string, unknown>
}

test("the packed tarball installs and starts in OpenCode 2.4.1", { timeout: 300_000 }, async () => {
  // A fresh bundle: the package has no prepare or lifecycle hook, and a stale dist/ must never be packed.
  run(process.execPath, [join(root, "scripts", "bundle.mjs")], root)
  const packed = run("npm", ["pack", "--ignore-scripts", "--pack-destination", work], root).trim().split("\n").at(-1)
  assert.ok(packed?.endsWith(".tgz"), `npm pack answered ${String(packed)}`)
  if (packed === undefined) throw new Error("npm pack answered no tarball name")

  const project = join(work, "project")
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "wisprflow-pack-probe", private: true, type: "module" }))
  run("npm", ["install", join(work, packed), "@opencode/plugin@2.4.1", "--ignore-scripts", "--no-audit", "--no-fund"], project)
  const installed = join(project, "node_modules", "@we-the-rebel-alliance", "wisprflow-plugin")
  assert.deepEqual(
    run("node", ["-e", `import("@we-the-rebel-alliance/wisprflow-plugin/server").then((m) => console.log(m.default.id, typeof m.default.setup))`], project).trim(),
    "wisprflow function",
  )

  writeFileSync(
    join(project, "opencode.json"),
    JSON.stringify({
      plugins: [installed],
      providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    }),
  )

  const binary = opencodeBinary()
  const base = join(work, "host")
  mkdirSync(base)
  const password = randomUUID()
  const env = { ...isolated(base), ...OFFLINE, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "en_US.UTF-8", OPENCODE_PASSWORD: password }
  // Every global path OpenCode resolves is inside the isolated home.
  const paths = run(binary, ["debug", "paths"], project, env)
  assert.ok(paths.includes(base), paths)

  const port = await freePort()
  let log = ""
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => {
    log += String(chunk)
  })
  server.stderr.on("data", (chunk) => {
    log += String(chunk)
  })
  const exited = new Promise((done) => server.once("exit", done))
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const request = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    url.searchParams.set("location[directory]", project)
    const headers = { "content-type": "application/json", authorization }
    const init: RequestInit = body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) }
    const response = await fetch(url, init)
    const text = await response.text()
    let parsed: unknown = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { text }
    }
    return { status: response.status, ok: response.ok, body: parsed as Record<string, unknown> }
  }
  const until = async <T>(what: string, read: () => Promise<T | undefined>, ms = 180_000): Promise<T> => {
    for (const deadline = Date.now() + ms; ;) {
      const value = await read().catch((error: unknown) => {
        if (Date.now() > deadline) throw error
        return undefined
      })
      if (value) return value
      if (server.exitCode !== null) throw new Error(`opencode exited before ${what}\n${log.slice(-3000)}`)
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}\n${log.slice(-3000)}`)
      await new Promise((done) => setTimeout(done, 500))
    }
  }

  try {
    const plugin = await until("wisprflow is active", async () => {
      const { body } = await request("GET", "/api/plugin")
      const data = (body.data ?? []) as { id: string; state?: { status?: string } }[]
      const found = data.find((item) => item.id === "wisprflow")
      return found?.state?.status === "active" ? found : undefined
    })
    assert.equal(plugin.id, "wisprflow")

    const server_ = await until("the wisprflow MCP server is registered", async () => {
      const { body } = await request("GET", "/api/mcp")
      const data = (body.data ?? []) as { name: string; status?: { status?: string } }[]
      return data.find((item) => item.name === "wisprflow")
    })
    assert.equal(server_.name, "wisprflow")

    const created = await request("POST", "/api/session", { agent: "build" })
    const sessionID = (created.body.id ?? (created.body.data as Record<string, unknown> | undefined)?.id) as string | undefined
    assert.ok(typeof sessionID === "string" && sessionID.length > 0, JSON.stringify(created.body))

    // The transport wraps the RPC method's input in `{ input }`; the method's own input carries the session and its input.
    const status = await request("POST", "/api/rpc/wisprflow/status", { input: { sessionID, input: {} } })
    assert.equal(status.ok, true, JSON.stringify(status.body))
    const output = status.body.output as Record<string, unknown>
    assert.equal(output.name, "wisprflow")
    assert.equal(output.version, "0.0.0")
    assert.deepEqual(output.host, { version: VERSION, range: ">=2.4.1 <2.5.0", tested: [VERSION] })
    assert.deepEqual((output.accounts as { alias: string }[]).map((account) => account.alias), ["default"])
    assert.ok(["needs_sign_in", "error"].includes(String(output.state)))
    assert.ok(Array.isArray(output.unguardedAgents))
  } finally {
    if (server.exitCode === null) {
      server.kill("SIGTERM")
      const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
      await exited
      clearTimeout(timer)
    }
  }
})
