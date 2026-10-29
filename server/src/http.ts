/** Minimal HTTP plumbing over node:http — just enough request/response
 *  helpers that routes.ts stays readable. No framework by design: the API is
 *  a dozen routes, and this is the security-relevant part of the repo. */

import type { IncomingMessage, ServerResponse } from "node:http"

export class HttpError extends Error {
	readonly status: number
	constructor(status: number, message: string) {
		super(message)
		this.status = status
	}
}

/** Buffer a request body, rejecting with 413 past `maxBytes`. The connection
 *  is destroyed on overflow so a client can't keep streaming into the void. */
export const readBody = (
	req: IncomingMessage,
	maxBytes: number
): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let total = 0
		req.on("data", (chunk: Buffer) => {
			total += chunk.length
			if (total > maxBytes) {
				req.destroy()
				reject(new HttpError(413, `Body exceeds the ${maxBytes}-byte limit`))
				return
			}
			chunks.push(chunk)
		})
		req.on("end", () => resolve(Buffer.concat(chunks)))
		req.on("error", (error) => reject(error))
	})

export const sendJson = (
	res: ServerResponse,
	status: number,
	body: string
): void => {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	})
	res.end(body)
}

/** Refuse a JSON write another site's page could send: a body that isn't
 *  `application/json` (a browser sends text/plain cross-site without
 *  asking first) answers 415, and an Origin that isn't the app's own
 *  answers 403. A request with no Origin, from a script or a server,
 *  passes. */
export const assertJsonWrite = (req: IncomingMessage, ownOrigin: string): void => {
	const type = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase()
	if (type !== "application/json") {
		throw new HttpError(415, "Send the body as content-type: application/json")
	}
	const origin = req.headers.origin
	if (origin !== undefined && origin !== ownOrigin) {
		throw new HttpError(403, "Cross-origin writes are not accepted")
	}
}

export const sendEmpty = (res: ServerResponse, status: number): void => {
	res.writeHead(status)
	res.end()
}

export const sendError = (
	res: ServerResponse,
	status: number,
	message: string
): void => {
	sendJson(res, status, JSON.stringify({ error: message }))
}
