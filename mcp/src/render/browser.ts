/** The headless browser: find the Chrome or Edge already on this machine
 *  (never a bundled one), start it on a throwaway profile with the DevTools
 *  protocol on a pipe, and stop it so that nothing it started survives.
 *
 *  POSIX: the browser is spawned detached, which makes it the leader of its
 *  own process group; stopping it signals the whole group (SIGTERM, then
 *  SIGKILL after a short grace) and waits until the group is empty, so a
 *  renderer or helper that ignores SIGTERM still goes. Windows: the tree is
 *  killed with `taskkill /T /F` while the browser process still roots it. */

import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process"
import { accessSync, constants, existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import type { Readable, Writable } from "node:stream"

import { createCdp, type Cdp } from "./cdp"

/** Where Chrome / Edge live when installed the standard way. The override
 *  (`VIS_BROWSER_PATH`) wins whenever it is set; otherwise the first path
 *  that exists, Chrome before Edge; none → null. */
export const findBrowser = (
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	exists: (p: string) => boolean
): string | null => {
	const override = env.VIS_BROWSER_PATH?.trim()
	if (override) return override
	return browserCandidates(env, platform).find((p) => exists(p)) ?? null
}

export const browserCandidates = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] => {
	if (platform === "darwin") {
		const apps = [
			"Google Chrome.app/Contents/MacOS/Google Chrome",
			"Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"Chromium.app/Contents/MacOS/Chromium",
		]
		const roots = ["/Applications"]
		const home = env.HOME?.trim()
		if (home) roots.push(path.posix.join(home, "Applications"))
		const out: string[] = []
		for (const app of apps) for (const root of roots) out.push(path.posix.join(root, app))
		return out
	}
	if (platform === "win32") {
		const roots = [
			env.PROGRAMFILES?.trim() || "C:\\Program Files",
			env["PROGRAMFILES(X86)"]?.trim() || "C:\\Program Files (x86)",
			env.LOCALAPPDATA?.trim(),
		].filter((r): r is string => !!r)
		const exes = ["Google\\Chrome\\Application\\chrome.exe", "Microsoft\\Edge\\Application\\msedge.exe"]
		const out: string[] = []
		for (const exe of exes) for (const root of roots) out.push(path.win32.join(root, exe))
		return out
	}
	// Linux and the other unixes: the usual names, on PATH.
	const names = [
		"google-chrome",
		"google-chrome-stable",
		"chromium",
		"chromium-browser",
		"microsoft-edge",
		"microsoft-edge-stable",
	]
	const dirs = (env.PATH ?? "").split(path.posix.delimiter).filter((d) => d.length > 0)
	const out: string[] = []
	for (const name of names) for (const dir of dirs) out.push(path.posix.join(dir, name))
	return out
}

/** Whether `p` is a file the browser could be started from. */
export const browserExists = (p: string): boolean => {
	try {
		if (process.platform === "win32") return existsSync(p)
		accessSync(p, constants.X_OK)
		return true
	} catch {
		return false
	}
}

/** Flags for a clean, quiet headless run that touches nothing of the
 *  person's own browser. */
export const browserArgs = (profileDir: string): string[] => [
	"--headless=new",
	"--remote-debugging-pipe",
	`--user-data-dir=${profileDir}`,
	"--no-first-run",
	"--no-default-browser-check",
	"--disable-extensions",
	"--disable-component-extensions-with-background-pages",
	"--disable-default-apps",
	"--disable-sync",
	"--disable-background-networking",
	"--disable-component-update",
	"--disable-breakpad",
	"--disable-crash-reporter",
	"--disable-domain-reliability",
	"--disable-client-side-phishing-detection",
	"--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication",
	"--disable-popup-blocking",
	"--disable-prompt-on-repost",
	"--disable-dev-shm-usage",
	"--metrics-recording-only",
	"--no-service-autorun",
	"--password-store=basic",
	"--use-mock-keychain",
	"--hide-scrollbars",
	"--mute-audio",
	"--force-color-profile=srgb",
	"--window-size=1600,1200",
	"about:blank",
]

// ---------------------------------------------------------------------------
// Process bookkeeping: every browser this process started, so an exiting MCP
// server never leaves one behind.
// ---------------------------------------------------------------------------

const live = new Set<number>()
let exitHookInstalled = false

const killNowSync = (pid: number): void => {
	if (process.platform === "win32") {
		try {
			// Synchronous on exit: the event loop is gone.
			spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
		} catch {
			// Nothing more can be done while exiting.
		}
		return
	}
	try {
		process.kill(-pid, "SIGKILL")
	} catch {
		// Already gone.
	}
}

const installExitHook = (): void => {
	if (exitHookInstalled) return
	exitHookInstalled = true
	const killAll = () => {
		for (const pid of live) killNowSync(pid)
	}
	process.once("exit", killAll)
	// A signal ends Node without "exit"; where nothing else handles it, stop
	// the browsers and then let the signal do what it would have.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		if (process.listenerCount(signal) > 0) continue
		process.once(signal, () => {
			killAll()
			process.kill(process.pid, signal)
		})
	}
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const groupAlive = (pid: number): boolean => {
	try {
		process.kill(-pid, 0)
		return true
	} catch (error) {
		// EPERM: a member exists we may not signal — count it as alive.
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
	try {
		process.kill(-pid, signal)
	} catch {
		// ESRCH: the group is already empty.
	}
}

const waitGroupGone = async (pid: number, ms: number): Promise<boolean> => {
	const until = Date.now() + ms
	while (groupAlive(pid)) {
		if (Date.now() >= until) return false
		await delay(25)
	}
	return true
}

const taskkill = (pid: number): Promise<void> =>
	new Promise((resolve) => {
		execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve())
	})

// ---------------------------------------------------------------------------
// A running browser
// ---------------------------------------------------------------------------

export type Browser = {
	cdp: Cdp
	pid: number
	/** The browser exited (or failed to start); the reason, for messages. */
	exited: Promise<string>
	/** Stop it and everything it started, then delete the profile. Safe to
	 *  call more than once; never throws. */
	stop(): Promise<void>
}

export class LaunchError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "LaunchError"
	}
}

const STDERR_TAIL = 2000

export const launchBrowser = async (opts: {
	executable: string
	tmpDir: string
	platform?: NodeJS.Platform
	env?: NodeJS.ProcessEnv
}): Promise<Browser> => {
	const platform = opts.platform ?? process.platform
	let profileDir: string
	try {
		profileDir = await mkdtemp(path.join(opts.tmpDir, "zafiro-render-"))
	} catch (error) {
		throw new LaunchError(`Couldn't make a temporary folder for the browser (${(error as Error).message}).`)
	}
	const removeProfile = async (): Promise<void> => {
		try {
			await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
		} catch {
			// Best effort; the folder sits in the temp area.
		}
	}

	let child: ChildProcess
	try {
		child = spawn(opts.executable, browserArgs(profileDir), {
			// stdout is never inherited: the MCP server's stdout is its protocol.
			stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
			detached: platform !== "win32",
			windowsHide: true,
			env: opts.env ?? process.env,
		})
	} catch (error) {
		await removeProfile()
		throw new LaunchError(`Couldn't start the browser at ${opts.executable} (${(error as Error).message}).`)
	}

	let stderrTail = ""
	child.stderr?.on("data", (d: Buffer) => {
		stderrTail = (stderrTail + d.toString("utf8")).slice(-STDERR_TAIL)
	})

	const exited = new Promise<string>((resolve) => {
		child.once("error", (error) => resolve(`Couldn't start the browser at ${opts.executable} (${error.message}).`))
		child.once("exit", (code, signal) => {
			const tail = stderrTail.trim().split("\n").slice(-2).join(" ").trim()
			resolve(
				`The browser stopped (${signal ?? `exit code ${code}`})${tail ? `: ${tail.slice(0, 300)}` : "."}`
			)
		})
	})

	const pid = child.pid
	if (pid === undefined) {
		const reason = await exited
		await removeProfile()
		throw new LaunchError(reason)
	}
	live.add(pid)
	installExitHook()

	const toBrowser = child.stdio[3] as Writable
	const fromBrowser = child.stdio[4] as Readable
	const cdp = createCdp(toBrowser, fromBrowser)
	void exited.then((reason) => cdp.close(reason))

	let stopping: Promise<void> | null = null
	const stop = (): Promise<void> => {
		stopping ??= (async () => {
			const childGone = new Promise<void>((resolve) => {
				if (child.exitCode !== null || child.signalCode !== null) resolve()
				else child.once("exit", () => resolve())
			})
			if (platform === "win32") {
				// The tree is found from the browser process, so kill it while
				// that still roots it rather than asking it to close first.
				await taskkill(pid)
				await Promise.race([childGone, delay(2000)])
			} else {
				if (!cdp.closed) {
					void cdp.send("Browser.close").catch(() => undefined)
					await Promise.race([childGone, delay(700)])
				}
				// Always the whole group: helpers outlive a browser that exited.
				signalGroup(pid, "SIGTERM")
				if (!(await waitGroupGone(pid, 400))) {
					signalGroup(pid, "SIGKILL")
					await waitGroupGone(pid, 2500)
				}
				await Promise.race([childGone, delay(500)])
			}
			cdp.close("The browser was stopped.")
			for (const stream of [child.stdio[2], toBrowser, fromBrowser]) {
				try {
					stream?.destroy()
				} catch {
					// Already closed.
				}
			}
			live.delete(pid)
			await removeProfile()
		})()
		return stopping
	}

	return { cdp, pid, exited, stop }
}
