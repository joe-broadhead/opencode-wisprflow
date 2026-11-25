// The host gate: a tested release starts, an untested one is refused with the contract's code and a next step, and
// allowUntestedHost is the one exception.
import assert from "node:assert/strict"
import { test } from "node:test"
import { assertHost } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest } from "../../src/manifest.ts"

const context = (version: string, options: Readonly<Record<string, unknown>> = {}) => ({ app: { version }, options })

test("a tested release starts", () => {
  assert.doesNotThrow(() => assertHost(context("2.4.1"), manifest))
  assert.doesNotThrow(() => assertHost(context("2.4.9"), manifest))
})

test("an untested release is refused with HOST_UNTESTED and a next step", () => {
  for (const version of ["2.4.0", "2.5.0", "3.0.0"]) {
    assert.throws(
      () => assertHost(context(version), manifest),
      (error: unknown) => error instanceof Error && error.message.startsWith("HOST_UNTESTED: ") && error.message.includes("Next step: "),
      version,
    )
  }
})

test("allowUntestedHost starts the plugin anyway", () => {
  assert.doesNotThrow(() => assertHost(context("2.5.0", { allowUntestedHost: true }), manifest))
  assert.throws(() => assertHost(context("2.5.0", { allowUntestedHost: false }), manifest), /HOST_UNTESTED/)
})
