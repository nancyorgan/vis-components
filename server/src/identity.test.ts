// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
	identifyFromForwardedHeaders,
	requestUser,
	sanitizeUser,
	stampSaver,
} from "./identity.js"
import type { IncomingMessage } from "node:http"

const JANE = { id: "jane", name: "Jane Doe" }
const NANCY = { id: "nancy", name: "Nancy Organ" }
const req = {} as IncomingMessage

describe("sanitizeUser", () => {
	it("trims, falls back to the id for a blank name, and needs an id", () => {
		expect(sanitizeUser({ id: " jane ", name: " Jane Doe " })).toEqual(JANE)
		expect(sanitizeUser({ id: "jane", name: "  " })).toEqual({ id: "jane", name: "jane" })
		expect(sanitizeUser({ id: "", name: "Jane" })).toBeNull()
		expect(sanitizeUser(null)).toBeNull()
		expect(sanitizeUser("jane")).toBeNull()
	})

	it("caps runaway lengths", () => {
		const user = sanitizeUser({ id: "x".repeat(1000), name: "y".repeat(1000) })
		expect(user?.id.length).toBe(256)
		expect(user?.name.length).toBe(120)
	})
})

describe("requestUser", () => {
	it("is null without a hook, and when the hook throws", () => {
		expect(requestUser(undefined, req)).toBeNull()
		expect(
			requestUser(() => {
				throw new Error("down")
			}, req)
		).toBeNull()
		expect(requestUser(() => JANE, req)).toEqual(JANE)
	})
})

describe("stampSaver", () => {
	const saved = (updatedBy?: unknown) => (updatedBy === undefined ? {} : { updatedBy })

	it("passes through a body that leaves updatedBy as stored", () => {
		expect(stampSaver({ id: "v", updatedBy: JANE }, saved(JANE), NANCY)).toBeNull()
		expect(stampSaver({ id: "v" }, saved(), NANCY)).toBeNull()
	})

	it("credits a changed updatedBy to the requester", () => {
		expect(stampSaver({ id: "v", updatedBy: JANE }, saved(NANCY), NANCY)).toEqual({
			id: "v",
			updatedBy: NANCY,
		})
		expect(stampSaver({ id: "v", updatedBy: JANE }, saved(), NANCY)).toEqual({
			id: "v",
			updatedBy: NANCY,
		})
	})

	it("an anonymous change keeps the stored saver, or none", () => {
		expect(stampSaver({ id: "v", updatedBy: NANCY }, saved(JANE), null)).toEqual({
			id: "v",
			updatedBy: JANE,
		})
		expect(stampSaver({ id: "v", updatedBy: NANCY }, saved(), null)).toEqual({ id: "v" })
	})

	it("a create is stamped with the requester even when the body names nobody", () => {
		expect(stampSaver({ id: "v" }, null, NANCY)).toEqual({ id: "v", updatedBy: NANCY })
		expect(stampSaver({ id: "v", updatedBy: JANE }, null, NANCY)).toEqual({
			id: "v",
			updatedBy: NANCY,
		})
		// Anonymous create: nobody to credit, and the client can't invent one.
		expect(stampSaver({ id: "v", updatedBy: JANE }, null, null)).toEqual({ id: "v" })
		expect(stampSaver({ id: "v" }, null, null)).toEqual({ id: "v" })
	})
})

describe("identifyFromForwardedHeaders (VIS_AUTH_MODE=header)", () => {
	const withHeaders = (headers: Record<string, string | string[]>) =>
		({ headers }) as unknown as IncomingMessage
	const GUID = "3f2a9c1e-8d4b-4e6f-9a0b-1c2d3e4f5a6b"

	it("reads the id from X-Forwarded-User and the name from X-Forwarded-Email", () => {
		expect(
			identifyFromForwardedHeaders(
				withHeaders({ "x-forwarded-user": GUID, "x-forwarded-email": "jane.doe@example.com" })
			)
		).toEqual({ id: GUID, name: "jane.doe@example.com" })
	})

	it("is nobody without a non-empty X-Forwarded-User, whatever else is sent", () => {
		expect(identifyFromForwardedHeaders(withHeaders({}))).toBeNull()
		expect(
			identifyFromForwardedHeaders(
				withHeaders({ "x-forwarded-user": "  ", "x-forwarded-email": "jane@example.com" })
			)
		).toBeNull()
	})

	it("names by preferred username without an email, and by the id without either", () => {
		expect(
			identifyFromForwardedHeaders(
				withHeaders({
					"x-forwarded-user": GUID,
					"x-forwarded-email": " ",
					"x-forwarded-preferred-username": "jdoe",
				})
			)
		).toEqual({ id: GUID, name: "jdoe" })
		expect(identifyFromForwardedHeaders(withHeaders({ "x-forwarded-user": GUID }))).toEqual({
			id: GUID,
			name: GUID,
		})
	})

	it("takes the first of repeated headers", () => {
		expect(
			identifyFromForwardedHeaders(
				withHeaders({ "x-forwarded-user": [GUID, "other"], "x-forwarded-email": ["a@x", "b@x"] })
			)
		).toEqual({ id: GUID, name: "a@x" })
	})
})
