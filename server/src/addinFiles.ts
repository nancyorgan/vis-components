/** The PowerPoint add-in, published beside the embeds.
 *
 *  `pnpm build` copies the add-in's task pane into `dist/addin/` with its
 *  manifest as a template (scripts/build-addin.mjs). At startup the server
 *  installs those files into `$VIS_PUBLISH_DIR/addin/` — the dumb static
 *  server then makes them public at `$VIS_PUBLISH_BASE_URL/addin/` — and
 *  writes `manifest.xml` there with this deployment's URLs filled in: the
 *  file an administrator deploys (or a tester sideloads) to get the Zafiro
 *  button in PowerPoint. The task pane fetches `../embeds/<id>/image.*`, so
 *  living on the publish host keeps every picture same-origin (no CORS).
 *
 *  Never fatal: a build without `dist/addin/` (build:static, older builds)
 *  skips the install. Office only loads add-ins over HTTPS; an http publish
 *  base still installs the files (the local embed:dev loop), the caller just
 *  says the manifest won't load. Files a previous build installed and this
 *  one doesn't ship are removed, so the folder always matches the build. */

import { promises as fs } from "node:fs"
import { join } from "node:path"

import { writeAndVerify } from "./embedFiles.js"

export const ADDIN_DIR = "addin"
export const MANIFEST_TEMPLATE = "manifest.template.xml"
export const MANIFEST_FILE = "manifest.xml"

/** The placeholders scripts/build-addin.mjs leaves in the template. */
const BASE_URL = "{{ADDIN_BASE_URL}}"
const ORIGIN = "{{ADDIN_ORIGIN}}"

/** Escape for an XML attribute or element body (a URL may carry `&`). */
const xmlText = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")

/** The deployable manifest: the template with the add-in's public folder
 *  (`<publishBaseUrl>/addin`) and the publish host's origin (its one
 *  AppDomain) filled in. `publishBaseUrl` comes from config, trailing
 *  slashes already stripped. */
export const renderAddinManifest = (template: string, publishBaseUrl: string): string =>
	template
		.replaceAll(BASE_URL, xmlText(`${publishBaseUrl}/${ADDIN_DIR}`))
		.replaceAll(ORIGIN, xmlText(new URL(publishBaseUrl).origin))

export type AddinInstall =
	| { installed: false; reason: string }
	| { installed: true; files: number; manifestUrl: string; https: boolean }

const isMissing = (error: unknown): boolean =>
	(error as NodeJS.ErrnoException).code === "ENOENT"

/** Install `distDir/addin/` into `publishDir/addin/` (see the file header). */
export const installAddin = async (
	distDir: string,
	publishDir: string,
	publishBaseUrl: string
): Promise<AddinInstall> => {
	const source = join(distDir, ADDIN_DIR)
	let names: string[]
	try {
		names = (await fs.readdir(source, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && !entry.name.startsWith("."))
			.map((entry) => entry.name)
	} catch (error) {
		if (isMissing(error)) return { installed: false, reason: "this build has no dist/addin/" }
		throw error
	}
	if (!names.includes(MANIFEST_TEMPLATE)) {
		return { installed: false, reason: `dist/addin/ has no ${MANIFEST_TEMPLATE}` }
	}

	const target = join(publishDir, ADDIN_DIR)
	await fs.mkdir(target, { recursive: true })
	const installed = new Set<string>()
	for (const name of names) {
		if (name === MANIFEST_TEMPLATE) continue
		await writeAndVerify(target, name, await fs.readFile(join(source, name)))
		installed.add(name)
	}
	const template = await fs.readFile(join(source, MANIFEST_TEMPLATE), "utf-8")
	await writeAndVerify(target, MANIFEST_FILE, renderAddinManifest(template, publishBaseUrl))
	installed.add(MANIFEST_FILE)

	for (const entry of await fs.readdir(target, { withFileTypes: true })) {
		if (entry.isFile() && !entry.name.startsWith(".") && !installed.has(entry.name)) {
			await fs.unlink(join(target, entry.name))
		}
	}
	return {
		installed: true,
		files: installed.size,
		manifestUrl: `${publishBaseUrl}/${ADDIN_DIR}/${MANIFEST_FILE}`,
		https: new URL(publishBaseUrl).protocol === "https:",
	}
}
