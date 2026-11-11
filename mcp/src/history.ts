/** The MCP's memory on this computer: the charts it returned to a model
 *  (their bodies, by revision, so an edit is judged against what the model
 *  saw) and the undo steps, in ONE small JSON file in the person's state
 *  folder. Every copy of the MCP on the computer (Claude Desktop runs two)
 *  shares it, and it survives restarts.
 *
 *  - Folder: VIS_STATE_DIR, else per platform (`resolveStateDir`).
 *  - Written whole and atomically (a temp file, then a rename).
 *  - Keyed by Zafiro server address, then by data format version: another
 *    server, or a build on another format, sees none of it.
 *  - A lock file (exclusive create, holding pid + a nonce, its mtime kept
 *    fresh while held) makes one operation at a time across copies. It is
 *    held only DURING an operation, never between calls. A waiting call
 *    gives up after LOCK_WAIT_MS; a lock whose holder is gone (its pid no
 *    longer alive, or not kept fresh for LOCK_STALE_MS) is taken over.
 *  - Everything older than KEEP_MS (30 days) is trimmed on start and on
 *    each write.
 *
 *  Bodies are stored once by content hash (gzipped, base64), shared by
 *  the revisions and steps that name them. Uses Node built-ins only. */

import { createHash, randomUUID } from "node:crypto"
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
	writeSync,
} from "node:fs"
import { homedir } from "node:os"
import { join, posix, win32 } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"

import type { Visual } from "../../src/contexts/chartBuilder/lib/types"

export const HISTORY_FILE = "history.json"
export const LOCK_FILE = "history.lock"
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000
/** How long a trimmed chart is still known as once seen. */
const TOMBSTONE_MS = 365 * 24 * 60 * 60 * 1000
export const STEPS_KEPT = 20
const PAUSES_KEPT = 20
export const LOCK_WAIT_MS = 10_000
export const LOCK_STALE_MS = 8_000
const HEARTBEAT_MS = 1_000
const POLL_MS = 20

/** The state folder: VIS_STATE_DIR when set (a leading `~` is the home
 *  folder; a relative value is ignored), else macOS Application Support,
 *  Windows local app data, Linux XDG state. */
export const resolveStateDir = (
	env: Record<string, string | undefined>,
	platform: string = process.platform,
	home: string = homedir()
): string => {
	const path = platform === "win32" ? win32 : posix
	const raw = env.VIS_STATE_DIR?.trim()
	if (raw) {
		const expanded = raw === "~" ? home : /^~[\\/]/.test(raw) ? path.join(home, raw.slice(2)) : raw
		if (path.isAbsolute(expanded)) return path.normalize(expanded)
	}
	if (platform === "darwin") return path.join(home, "Library", "Application Support", "Zafiro MCP")
	if (platform === "win32") {
		const local = env.LOCALAPPDATA?.trim()
		return path.join(local && path.isAbsolute(local) ? local : path.join(home, "AppData", "Local"), "Zafiro MCP")
	}
	const xdg = env.XDG_STATE_HOME?.trim()
	return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".local", "state"), "zafiro-mcp")
}

/** A server address as one key: scheme, host (lowercase, no default port)
 *  and path, no trailing slash. */
export const serverKey = (apiUrl: string): string => {
	try {
		const url = new URL(apiUrl)
		return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`
	} catch {
		return apiUrl.trim().replace(/\/+$/, "")
	}
}

/** One undo step: the chart before the edit, what the edit wrote, and the
 *  tags of both. `before` and `written` are body hashes. */
export type Step = {
	id: string
	at: number
	before: string
	beforeTag: string | null
	written: string
	tag: string | null
}

/** A paused undo's question: the step it was about and the revision it
 *  gave; `spent` once a yes used it. */
export type Pause = { step: string; revision: string; at: number; spent?: boolean }

/** A body the MCP returned (or named in a refusal), by revision. */
export type Revision = { tag: string | null; body: string; at: number }

export type ChartState = {
	/** The copy the MCP last returned to a model; what an edit with no
	 *  revision is judged against. */
	baseline?: Revision
	/** Every revision returned or named for this chart, newest last. */
	revisions: Revision[]
	steps: Step[]
	pauses: Pause[]
	/** When a baseline this chart had was trimmed: it was seen. */
	lostAt?: number
}

type Scope = { charts: Record<string, ChartState> }

type StateFile = {
	format: 1
	/** When an unreadable history was replaced: charts seen before it
	 *  can't be told from charts never seen. */
	corruptAt?: number
	/** Chart bodies by hash, gzipped JSON in base64. */
	bodies: Record<string, string>
	servers: Record<string, Record<string, Scope>>
}

const emptyFile = (): StateFile => ({ format: 1, bodies: {}, servers: {} })

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** The history is busy (another copy held it too long) or can't be used. */
export class HistoryBusyError extends Error {
	constructor() {
		super("another copy of the Zafiro MCP on this computer held its history too long")
		this.name = "HistoryBusyError"
	}
}

const pidAlive = (pid: number): boolean => {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type HistoryOptions = {
	dir: string
	/** VIS_API_URL; normalized with serverKey. */
	server: string
	/** The data format version (CONTENT_MIGRATIONS.visuals.currentVersion). */
	version: number
	now?: () => number
	lockWaitMs?: number
	lockStaleMs?: number
}

/** One operation's view of this server and format's charts. Changes are
 *  written when the operation's callback returns (`save` writes sooner). */
export type Session = {
	chart: (id: string) => ChartState | undefined
	/** The chart's state, made when absent. */
	ensure: (id: string) => ChartState
	body: (hash: string) => Visual | undefined
	/** Store a body; answers its hash. */
	put: (visual: Visual) => string
	/** When an unreadable history was replaced, or null. */
	corruptAt: number | null
	/** Write now; throws when the file can't be written. */
	save: () => void
	now: () => number
	/** Whether this operation holds the lock (false when the folder can't
	 *  be written: the history is read but never saved). */
	locked: boolean
}

export const createHistory = (options: HistoryOptions) => {
	const { dir } = options
	const now = options.now ?? Date.now
	const file = join(dir, HISTORY_FILE)
	const lockPath = join(dir, LOCK_FILE)
	const waitMs = options.lockWaitMs ?? LOCK_WAIT_MS
	const staleMs = options.lockStaleMs ?? LOCK_STALE_MS
	const server = serverKey(options.server)
	const version = String(options.version)

	/** Take the lock; answers its release, or null when the folder can't
	 *  hold a lock at all (read-only, missing and uncreatable). Throws
	 *  HistoryBusyError after waiting `waitMs`. */
	const lock = async (): Promise<(() => void) | null> => {
		try {
			mkdirSync(dir, { recursive: true, mode: 0o700 })
		} catch {
			return null
		}
		const nonce = randomUUID()
		const started = Date.now()
		for (;;) {
			try {
				const fd = openSync(lockPath, "wx", 0o600)
				try {
					writeSync(fd, JSON.stringify({ pid: process.pid, nonce }))
				} finally {
					closeSync(fd)
				}
				const beat = setInterval(() => {
					try {
						const t = new Date()
						utimesSync(lockPath, t, t)
					} catch {
						// The lock went (taken over as stale): nothing to keep fresh.
					}
				}, HEARTBEAT_MS)
				beat.unref?.()
				return () => {
					clearInterval(beat)
					try {
						if (readFileSync(lockPath, "utf8").includes(nonce)) unlinkSync(lockPath)
					} catch {
						// Already gone.
					}
				}
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code
				if (code !== "EEXIST") return null
			}
			// Held: take it over when its holder is gone, else wait.
			try {
				const held = readFileSync(lockPath, "utf8")
				const age = Date.now() - statSync(lockPath).mtimeMs
				let pid = NaN
				try {
					pid = Number((JSON.parse(held) as { pid?: unknown }).pid)
				} catch {
					// Half-written: judged by age alone.
				}
				const gone = age > staleMs || (Number.isFinite(pid) && !pidAlive(pid))
				// Re-read right before removing, so a lock another copy just
				// took over is never removed in its place.
				if (gone && readFileSync(lockPath, "utf8") === held) {
					unlinkSync(lockPath)
					continue
				}
			} catch {
				// Gone between the open and the read: try again at once.
				continue
			}
			if (Date.now() - started >= waitMs) throw new HistoryBusyError()
			await sleep(POLL_MS)
		}
	}

	const load = (): StateFile => {
		let text: string
		try {
			text = readFileSync(file, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile()
			return { ...emptyFile(), corruptAt: now() }
		}
		try {
			const parsed = JSON.parse(text) as unknown
			if (isObj(parsed) && parsed.format === 1 && isObj(parsed.bodies) && isObj(parsed.servers))
				return parsed as unknown as StateFile
		} catch {
			// Fall through: unreadable.
		}
		return { ...emptyFile(), corruptAt: now() }
	}

	/** Drop what is older than KEEP_MS, steps past STEPS_KEPT, and bodies
	 *  nothing names. A trimmed baseline leaves a tombstone. */
	const trim = (state: StateFile): void => {
		const cutoff = now() - KEEP_MS
		if (state.corruptAt !== undefined && state.corruptAt < cutoff) delete state.corruptAt
		const used = new Set<string>()
		for (const [serverName, versions] of Object.entries(state.servers)) {
			for (const [v, scope] of Object.entries(versions)) {
				for (const [id, chart] of Object.entries(scope.charts)) {
					if (chart.baseline && chart.baseline.at < cutoff) {
						delete chart.baseline
						chart.lostAt = now()
					}
					chart.revisions = (chart.revisions ?? []).filter((r) => r.at >= cutoff)
					chart.steps = (chart.steps ?? []).filter((s) => s.at >= cutoff).slice(-STEPS_KEPT)
					chart.pauses = (chart.pauses ?? []).filter((p) => p.at >= cutoff).slice(-PAUSES_KEPT)
					if (chart.lostAt !== undefined && chart.lostAt < now() - TOMBSTONE_MS) delete chart.lostAt
					if (!chart.baseline && chart.lostAt === undefined && chart.revisions.length === 0 && chart.steps.length === 0)
						delete scope.charts[id]
					else {
						if (chart.baseline) used.add(chart.baseline.body)
						for (const r of chart.revisions) used.add(r.body)
						for (const s of chart.steps) {
							used.add(s.before)
							used.add(s.written)
						}
					}
				}
				if (Object.keys(scope.charts).length === 0) delete versions[v]
			}
			if (Object.keys(versions).length === 0) delete state.servers[serverName]
		}
		for (const hash of Object.keys(state.bodies)) if (!used.has(hash)) delete state.bodies[hash]
	}

	const write = (state: StateFile): void => {
		trim(state)
		const temp = join(dir, `.${HISTORY_FILE}.${process.pid}.${randomUUID()}.tmp`)
		try {
			writeFileSync(temp, JSON.stringify(state), { mode: 0o600 })
			renameSync(temp, file)
		} catch (error) {
			try {
				unlinkSync(temp)
			} catch {
				// Never made.
			}
			throw error
		}
	}

	/** Run `fn` holding the lock over this server and format's history;
	 *  what it changed is written when it returns (best effort: a failed
	 *  write after `fn` is reported through `onWriteError`, never thrown).
	 *  Throws HistoryBusyError when the lock can't be had in time. */
	const run = async <T>(
		fn: (session: Session) => Promise<T>,
		onWriteError?: (error: unknown) => void
	): Promise<T> => {
		const release = await lock()
		try {
			const state = load()
			// Nothing past its age is ever offered, written yet or not.
			trim(state)
			const versions = (state.servers[server] ??= {})
			const scope = (versions[version] ??= { charts: {} })
			let dirty = false
			const session: Session = {
				chart: (id) => scope.charts[id],
				ensure: (id) => {
					dirty = true
					return (scope.charts[id] ??= { revisions: [], steps: [], pauses: [] })
				},
				body: (hash) => {
					const packed = state.bodies[hash]
					if (typeof packed !== "string") return undefined
					try {
						return JSON.parse(gunzipSync(Buffer.from(packed, "base64")).toString("utf8")) as Visual
					} catch {
						return undefined
					}
				},
				put: (visual) => {
					const { thumbnail: _thumbnail, ...rest } = visual
					const text = JSON.stringify(rest)
					const hash = createHash("sha256").update(text).digest("hex")
					state.bodies[hash] ??= gzipSync(text).toString("base64")
					dirty = true
					return hash
				},
				corruptAt: state.corruptAt ?? null,
				save: () => {
					if (!release) throw new Error(`the history folder ${dir} can't be written`)
					write(state)
					dirty = false
				},
				now,
				locked: release !== null,
			}
			const result = await fn(session)
			if (dirty || state.corruptAt !== undefined) {
				try {
					session.save()
				} catch (error) {
					onWriteError?.(error)
				}
			}
			return result
		} finally {
			release?.()
		}
	}

	return {
		dir,
		file,
		run,
		/** Trim the file now (on start); quiet on any failure. */
		trim: async (): Promise<void> => {
			try {
				const release = await lock()
				if (!release) return
				try {
					try {
						statSync(file)
					} catch {
						return
					}
					write(load())
				} finally {
					release()
				}
			} catch {
				// Busy or unwritable: the next write trims.
			}
		},
	}
}

export type History = ReturnType<typeof createHistory>

/** Remember `visual` at `tag` as returned to a model: its baseline moves
 *  to it and the revision is known. */
export const recordReturned = (session: Session, visual: Visual, tag: string | null): void => {
	const chart = session.ensure(visual.id)
	const entry: Revision = { tag, body: session.put(visual), at: session.now() }
	chart.baseline = entry
	delete chart.lostAt
	if (tag !== null) {
		chart.revisions = chart.revisions.filter((r) => r.tag !== tag)
		chart.revisions.push(entry)
	}
}

/** Remember `visual` at `tag` as named in a refusal: the revision is known
 *  (an edit or undo at it can be judged), the baseline does not move. */
export const recordNamed = (session: Session, visual: Visual, tag: string | null): void => {
	if (tag === null) return
	const chart = session.ensure(visual.id)
	chart.revisions = chart.revisions.filter((r) => r.tag !== tag)
	chart.revisions.push({ tag, body: session.put(visual), at: session.now() })
}
