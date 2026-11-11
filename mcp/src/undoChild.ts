/** A child process for the crash test (history.test.ts, TST-15): it starts
 *  undo_chart_edit on a chart with a client whose visual PUT never leaves
 *  (it hangs), says "put" on stdout when the undo reaches its save, and
 *  waits to be killed there, holding the history's lock.
 *
 *  Run: jiti mcp/src/undoChild.ts <server base> <state dir> <chart id> */

import { createApi } from "./api"
import { createHandlers } from "./tools"

const [base, stateDir, id] = process.argv.slice(2)

const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
	if (init?.method === "PUT" && String(input).includes("/api/visuals/")) {
		process.stdout.write("put\n")
		return new Promise<Response>(() => {})
	}
	return fetch(input, init)
}) as typeof fetch

const tools = createHandlers(createApi(base, fetchImpl), {
	renderer: {
		picture: async () => ({ ok: false, reason: "no browser in the child" }),
		exportChart: async () => ({ ok: false, reason: "no browser in the child" }),
		close: async () => {},
	},
	stateDir,
})

void tools.undo_chart_edit({ id })
