// The provider client against a synthetic host: one server and one sign-in per alias, the vendor tool each alias reads
// through, and the contract error the host's states map to.
import assert from "node:assert/strict"
import { test } from "node:test"
import { SourceError, probeResultProblems } from "@we-the-rebel-alliance/plugin-contract/events"
import { createProvider, type Host } from "../../src/provider/client.ts"
import { fakeHost, runtimeFor } from "../support/handlers.ts"
import { NOW, PERSONAL } from "../support/fake.ts"

const providerFor = (host = fakeHost()) => ({ host: host.host, provider: createProvider({ plugin: "wisprflow", packageName: "@we-the-rebel-alliance/wisprflow-plugin", host: host.host }), calls: host.calls })

const code = async (action: () => Promise<unknown>) => {
  try {
    await action()
    return undefined
  } catch (error) {
    return error instanceof SourceError ? error.code : String(error)
  }
}

test("the owner is OpenCode's sign-in for the alias's server, and is never verified", async () => {
  const { provider } = providerFor()
  assert.deepEqual(await provider.owner({ account: "work" }), { id: "wisprflow:credential:cred-work", label: "Wispr Flow (work)", verified: false })
  assert.deepEqual(await provider.owner({ account: "personal" }), { id: "wisprflow:credential:cred-personal", label: "Wispr Flow (personal)", verified: false })
})

test("probe names the source, the account and the owner, and reads no content", async () => {
  const { provider } = providerFor()
  const answer = await provider.probe({ account: "personal" })
  assert.deepEqual(answer, {
    source: "wisprflow",
    account: "personal",
    owner: { id: "wisprflow:credential:cred-personal", label: "Wispr Flow (personal)", verified: false },
    trust: "untrusted",
  })
  assert.deepEqual(probeResultProblems(answer, { source: "wisprflow", account: "personal" }), [])
})

test("a page reads through the account's own server and tool, and only that account's meetings", async () => {
  const { provider, calls } = providerFor()
  const page = await provider.page({ account: "personal", input: { since: "2026-11-01", limit: 500 }, now: NOW, call: call() })
  assert.deepEqual(page.events.map((event) => event.external_id), PERSONAL.map((meeting) => meeting.id))
  assert.ok(calls.length > 0)
  assert.ok(calls.every((call) => call.alias === "personal"))
  const work = await provider.page({ account: "work", input: { since: "2026-11-01", limit: 2 }, now: NOW, call: call() })
  assert.equal(work.events.length, 2)
  assert.ok(calls.every((entry) => entry.alias === "personal" || entry.alias === "work"))
  assert.ok(calls.some((entry) => entry.alias === "work"))
})

test("a server that needs a sign-in is NEEDS_SIGN_IN, and its account is needs_sign_in in status", async () => {
  const { provider } = providerFor(fakeHost({ status: { work: { status: "needs_auth" } }, signedIn: ["work", "personal"] }))
  assert.equal(await code(() => provider.owner({ account: "work" })), "NEEDS_SIGN_IN")
  assert.equal(await code(() => provider.probe({ account: "work" })), "NEEDS_SIGN_IN")
  assert.deepEqual(await provider.signal({ account: "work" }), { state: "needs_sign_in" })
  assert.equal((await provider.signal({ account: "personal" })).state, "ready")
})

test("a failed server is UNAVAILABLE with a redacted reason, and status says error", async () => {
  const { provider } = providerFor(fakeHost({ status: { work: { status: "failed", error: "the sign-in was refused at https://api.wisprflow.ai/callback?token=secret-value" } } }))
  const message = await provider
    .owner({ account: "work" })
    .then(() => "")
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
  assert.match(message, /^UNAVAILABLE: /)
  assert.ok(!message.includes("secret-value"))
  const signal = await provider.signal({ account: "work" })
  assert.equal(signal.state, "error")
  assert.ok(!String(signal.reason).includes("secret-value"))
})

test("a server that is missing or disabled is UNAVAILABLE, and status reports it", async () => {
  const missing: Host = {
    tools: async () => [],
    servers: async () => [],
    activeConnection: async () => undefined,
  }
  const provider = createProvider({ plugin: "wisprflow", packageName: "@we-the-rebel-alliance/wisprflow-plugin", host: missing })
  assert.equal(await code(() => provider.owner({ account: "work" })), "UNAVAILABLE")
  assert.equal((await provider.signal({ account: "work" })).state, "error")
  const disabled = providerFor(fakeHost({ status: { work: { status: "disabled" } } })).provider
  assert.equal(await code(() => disabled.owner({ account: "work" })), "UNAVAILABLE")
})

test("a connected server with no search_meetings is UNAVAILABLE", async () => {
  const host: Host = {
    tools: async () => [],
    servers: async () => [{ name: "wisprflow-work", status: { status: "connected" }, integrationID: "int-wisprflow-work" }],
    activeConnection: async () => ({ type: "credential", id: "cred-work", label: "Wispr Flow (work)" }),
  }
  const provider = createProvider({ plugin: "wisprflow", packageName: "@we-the-rebel-alliance/wisprflow-plugin", host })
  assert.equal(await code(() => provider.page({ account: "work", input: {}, now: NOW, call: call() })), "UNAVAILABLE")
})

test("a tool failure is UNAVAILABLE, with its first line redacted and no second line", async () => {
  const { provider } = providerFor(fakeHost({ fail: { work: "the tool failed at https://files.wisprflow.example/a.png?signature=fake-signature-123\nsecond line" } }))
  const message = await provider
    .page({ account: "work", input: { since: "2026-11-01" }, now: NOW, call: call() })
    .then(() => "")
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
  assert.match(message, /^UNAVAILABLE: /)
  assert.ok(message.includes("https://files.wisprflow.example/a.png?signature=\u2026"))
  assert.ok(!message.includes("fake-signature-123"))
  assert.ok(!message.includes("second line"))
})

test("status never throws, even when the host cannot list its servers", async () => {
  const host: Host = {
    tools: async () => [],
    servers: async () => {
      throw new Error("the host is restarting")
    },
    activeConnection: async () => undefined,
  }
  const provider = createProvider({ plugin: "wisprflow", packageName: "@we-the-rebel-alliance/wisprflow-plugin", host })
  const signal = await provider.signal({ account: "work" })
  assert.equal(signal.state, "error")
  assert.ok(String(signal.reason).includes("the host is restarting"))
})

test("the runtime the handlers use answers status with both aliases' owners", async () => {
  const runtime = runtimeFor()
  const answer = (await runtime.provider.signal({ account: "work" })) as { state: string; owner?: { id: string } }
  assert.equal(answer.state, "ready")
  assert.equal(answer.owner?.id, "wisprflow:credential:cred-work")
})

/** The call context the provider passes to the vendor tool; the fake ignores all but the signal. */
function call() {
  return { sessionID: "ses_test", agent: "build", messageID: "msg_test", id: "call_test", signal: new AbortController().signal, progress: async () => undefined }
}
