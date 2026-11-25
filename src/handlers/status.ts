/**
 * `status`: what a person and an app read before anything else. It carries no content and no credential.
 *
 * The version, host range, accounts and generated rules come from the manifest, the options and the call. `statusAnswer`
 * assembles the contract's shape, including a failed agent list as a problem with an empty list, so this handler keeps no
 * state and nothing is filled after `register` returns.
 */
import { accountStatuses, redactReason, STATUS_SCHEMA, statusAnswer, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { EMPTY } from "./shared.ts"
import type { HandlerRuntime } from "./index.ts"

/** `status`: name, version, host, state, one entry per alias, unguarded agents and a next step. */
export function statusHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the plugin's version, OpenCode host, account sign-ins and any next step.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const signals: Record<string, AccountSignal> = {}
      const perAlias = await Promise.all(runtime.accounts.map(async (account) => [account.alias, await runtime.provider.signal({ account: account.alias })] as const))
      for (const [alias, signal] of perAlias) signals[alias] = signal
      const problems = [...runtime.accountProblems]
      // An account in error makes the plugin not ready, not only that alias; a sign-in need does not.
      const failure = perAlias.find(([, signal]) => signal.state === "error")
      if (failure !== undefined) {
        const reason = failure[1].reason === undefined ? "no reason given" : redactReason(failure[1].reason)
        problems.push(`the ${failure[0]} account is in error: ${reason}`)
      }
      return statusAnswer({
        manifest: runtime.manifest,
        version: runtime.version,
        hostVersion: runtime.hostVersion,
        accounts: accountStatuses(runtime.accounts, signals),
        problems,
        unguardedAgents: await call.unguardedAgents(),
      })
    },
  }
}
