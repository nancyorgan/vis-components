import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { stringifyJsonDangerous } from "../lib/json"
import { TestProvider } from "../testSupport/TestProvider"
import { currentVisualIdAtom } from "../contexts/chartBuilder/store/atoms"
import {
	isSignInLapsed,
	resetSignInLapsedForTests,
} from "../contexts/chartBuilder/lib/storage/signInLapsed"

let pathname = "/editor/v1"
vi.mock("@tanstack/react-router", () => ({
	useRouterState: ({
		select,
	}: {
		select: (s: { location: { pathname: string } }) => unknown
	}) => select({ location: { pathname } }),
}))

const NANCY = { id: "nancy", name: "Nancy Organ" }
const JANE = { id: "jane", name: "Jane Doe" }
let user: typeof NANCY | null = NANCY
vi.mock("../lib/currentUser", async (importOriginal) => ({
	...(await importOriginal<typeof import("../lib/currentUser")>()),
	getCurrentUser: () => user,
}))

const { EditorPresence } = await import("./EditorPresence")

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.useRealTimers()
	resetSignInLapsedForTests()
	pathname = "/editor/v1"
	user = NANCY
})

const stubPresence = (editors: { id: string; name: string }[], status = 200) => {
	const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
		init?.method === "DELETE"
			? new Response(null, { status: 204 })
			: new Response(stringifyJsonDangerous({ editors }), {
					status,
					headers: { "content-type": "application/json" },
				})
	)
	vi.stubGlobal("fetch", fetchMock)
	return fetchMock
}

/** A presence server whose answer the test changes mid-run. */
const stubPresenceServer = () => {
	let respond = (): Response => new Response(stringifyJsonDangerous({ editors: [] }), { status: 200 })
	const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
		init?.method === "DELETE" ? new Response(null, { status: 204 }) : respond()
	)
	vi.stubGlobal("fetch", fetchMock)
	return {
		fetchMock,
		answer: (editors: { id: string; name: string }[]) => {
			respond = () =>
				new Response(stringifyJsonDangerous({ editors }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
		},
		fail: (status: number) => {
			respond = () => new Response(null, { status })
		},
	}
}

const titles = () => screen.getAllByRole("listitem").map((li) => li.getAttribute("title"))
const tick = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms).then(() => {}))

const renderIn = (visualId: string | null) =>
	render(
		<TestProvider initializeState={(s) => s.set(currentVisualIdAtom, visualId)}>
			<EditorPresence />
		</TestProvider>
	)

describe("EditorPresence", () => {
	it("shows an initials circle for each person in this visual's editor, you last", async () => {
		const fetchMock = stubPresence([JANE, NANCY])
		renderIn("v1")
		await act(async () => {})
		const circles = screen.getAllByRole("listitem")
		expect(circles.map((li) => li.getAttribute("title"))).toEqual([
			"Jane Doe",
			"Nancy Organ (you)",
		])
		expect(circles.map((li) => li.querySelector("[aria-hidden]")?.textContent)).toEqual([
			"JD",
			"NO",
		])
		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toMatch(/^\/api\/presence\/tab-/)
		expect(init?.method).toBe("PUT")
		expect(init?.body).toBe(stringifyJsonDangerous({ visualId: "v1" }))
	})

	it("shows just you on an unsaved draft, without asking the server", () => {
		const fetchMock = stubPresence([JANE])
		renderIn(null)
		expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("title"))).toEqual([
			"Nancy Organ (you)",
		])
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("renders nothing without a signed-in user, or off the editor", () => {
		const fetchMock = stubPresence([JANE])
		user = null
		const { container } = renderIn("v1")
		expect(container.innerHTML).toBe("")
		cleanup()
		user = NANCY
		pathname = "/"
		expect(renderIn("v1").container.innerHTML).toBe("")
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("says goodbye to the server when the editor closes", async () => {
		const fetchMock = stubPresence([NANCY])
		const { unmount } = renderIn("v1")
		await act(async () => {})
		unmount()
		expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE")
	})

	it("fades the others once heartbeats have failed past the server's TTL, and drops them after two minutes", async () => {
		vi.useFakeTimers()
		const server = stubPresenceServer()
		server.answer([JANE, NANCY])
		renderIn("v1")
		await tick(0)
		expect(titles()).toEqual(["Jane Doe", "Nancy Organ (you)"])

		server.fail(500)
		await tick(30_000)
		expect(titles()).toEqual(["Jane Doe", "Nancy Organ (you)"])
		const jane = () => screen.getAllByRole("listitem")[0]
		expect(jane().className).not.toContain("opacity-50")

		await tick(15_000)
		expect(titles()).toEqual(["Jane Doe (may have left)", "Nancy Organ (you)"])
		expect(jane().className).toContain("opacity-50")

		// A heartbeat that gets through un-fades them…
		server.answer([JANE, NANCY])
		await tick(15_000)
		expect(titles()).toEqual(["Jane Doe", "Nancy Organ (you)"])

		// …and a long outage drops them.
		server.fail(500)
		await tick(120_000)
		expect(titles()).toEqual(["Nancy Organ (you)"])
		expect(isSignInLapsed()).toBe(false)
	})

	it("on a 401 drops the others at once, raises the sign-in banner, and stops for good", async () => {
		vi.useFakeTimers()
		const server = stubPresenceServer()
		server.answer([JANE, NANCY])
		renderIn("v1")
		await tick(0)
		expect(titles()).toEqual(["Jane Doe", "Nancy Organ (you)"])

		server.fail(401)
		await tick(15_000)
		expect(titles()).toEqual(["Nancy Organ (you)"])
		expect(isSignInLapsed()).toBe(true)

		// No more heartbeats: not on the timer, and not when the tab comes
		// back to the front either. Only a reload signs back in.
		const calls = server.fetchMock.mock.calls.length
		await tick(60_000)
		document.dispatchEvent(new Event("visibilitychange"))
		await tick(0)
		expect(server.fetchMock.mock.calls.length).toBe(calls)
	})

	it("folds a crowd into +N", async () => {
		stubPresence(
			["Ann A", "Bo B", "Cy C", "Di D", "Ed E"].map((name) => ({ id: name, name })).concat(NANCY)
		)
		renderIn("v1")
		await act(async () => {})
		const circles = screen.getAllByRole("listitem")
		expect(circles).toHaveLength(4)
		expect(circles[0].querySelector("[aria-hidden]")?.textContent).toBe("+3")
		expect(circles[0].getAttribute("title")).toBe("Ann A, Bo B, Cy C")
	})
})
