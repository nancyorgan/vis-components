/** A minimal Chrome DevTools Protocol client over `--remote-debugging-pipe`:
 *  the browser reads commands from its fd 3 and writes replies and events
 *  to its fd 4, each message one JSON text ended by a NUL byte. No port is
 *  opened, so nothing else on the machine can drive the browser. Only what
 *  the renderer needs: commands (optionally on a flattened target session),
 *  event listeners, and a `close` that fails every pending command. */

import type { Readable, Writable } from "node:stream"

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; method: string }

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string }

export type Cdp = {
	send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>
	/** Every event; returns the unsubscribe. */
	onEvent(listener: (event: CdpEvent) => void): () => void
	/** Fail every pending and later command with `reason`. */
	close(reason: string): void
	readonly closed: boolean
}

export class CdpError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "CdpError"
	}
}

export const createCdp = (toBrowser: Writable, fromBrowser: Readable): Cdp => {
	let nextId = 1
	const pending = new Map<number, Pending>()
	const listeners = new Set<(event: CdpEvent) => void>()
	let closedReason: string | null = null

	// Incoming bytes, kept as chunks so a large message (a base64 export can
	// run to tens of MB) is never re-concatenated per chunk.
	let chunks: Buffer[] = []

	const dispatch = (text: string): void => {
		let message: {
			id?: number
			result?: unknown
			error?: { message?: string }
			method?: string
			params?: Record<string, unknown>
			sessionId?: string
		}
		try {
			message = JSON.parse(text) as typeof message
		} catch {
			return
		}
		if (typeof message.id === "number") {
			const entry = pending.get(message.id)
			if (!entry) return
			pending.delete(message.id)
			if (message.error) entry.reject(new CdpError(`${entry.method}: ${message.error.message ?? "failed"}`))
			else entry.resolve(message.result ?? {})
			return
		}
		if (typeof message.method === "string") {
			const event: CdpEvent = { method: message.method, params: message.params ?? {}, sessionId: message.sessionId }
			for (const listener of listeners) {
				try {
					listener(event)
				} catch {
					// A listener's failure never breaks the reader.
				}
			}
		}
	}

	fromBrowser.on("data", (data: Buffer | string) => {
		let chunk = typeof data === "string" ? Buffer.from(data) : data
		let end = chunk.indexOf(0)
		while (end !== -1) {
			chunks.push(chunk.subarray(0, end))
			const whole = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
			chunks = []
			dispatch(whole.toString("utf8"))
			chunk = chunk.subarray(end + 1)
			end = chunk.indexOf(0)
		}
		if (chunk.length > 0) chunks.push(chunk)
	})

	const failAll = (reason: string): void => {
		if (closedReason === null) closedReason = reason
		for (const [id, entry] of pending) {
			pending.delete(id)
			entry.reject(new CdpError(closedReason))
		}
	}
	fromBrowser.on("end", () => failAll("The browser closed its connection."))
	fromBrowser.on("error", () => failAll("The browser connection failed."))
	toBrowser.on("error", () => failAll("The browser connection failed."))

	return {
		send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
			if (closedReason !== null) return Promise.reject(new CdpError(closedReason))
			const id = nextId++
			const body: Record<string, unknown> = { id, method, params }
			if (sessionId) body.sessionId = sessionId
			return new Promise<T>((resolve, reject) => {
				pending.set(id, { resolve: resolve as (value: unknown) => void, reject, method })
				try {
					toBrowser.write(`${JSON.stringify(body)}\0`)
				} catch {
					pending.delete(id)
					reject(new CdpError("The browser connection failed."))
				}
			})
		},
		onEvent(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		close(reason) {
			failAll(reason)
			listeners.clear()
		},
		get closed() {
			return closedReason !== null
		},
	}
}
