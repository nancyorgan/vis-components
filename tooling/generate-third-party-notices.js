// Regenerates THIRD_PARTY_NOTICES.md from the installed production
// dependency tree. Run via `pnpm notices` after dependency changes.
//
// Node built-ins only (dependency policy). The walk starts from the root
// package.json `dependencies` (the server bundles nothing: server/src uses
// node:* built-ins exclusively) and follows each package's `dependencies` +
// `optionalDependencies` through node_modules, resolving pnpm's symlinked
// layout with realpath. Output is deterministic: stable sorts throughout,
// so reruns produce no diff when nothing changed.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md')

// ---------------------------------------------------------------------------
// Dependency tree enumeration
// ---------------------------------------------------------------------------

function readPackageJson(dir) {
	return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
}

// Node-style resolution: look for name in node_modules of fromDir, then walk
// up parent directories. Returns the package's real directory (pnpm installs
// are symlinks into node_modules/.pnpm) or null.
function resolveDep(fromDir, name) {
	let dir = fromDir
	for (;;) {
		const candidate = path.join(dir, 'node_modules', ...name.split('/'))
		if (fs.existsSync(path.join(candidate, 'package.json'))) {
			return fs.realpathSync(candidate)
		}
		const parent = path.dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
}

// Breadth-first walk of the production closure. Yields one entry per
// distinct real package directory (so distinct versions of the same package
// each appear once).
function collectProductionPackages() {
	const rootPkg = readPackageJson(repoRoot)
	const queue = []
	for (const name of Object.keys(rootPkg.dependencies ?? {})) {
		queue.push({ fromDir: repoRoot, name, optional: false })
	}
	const seenDirs = new Set()
	const packages = []
	while (queue.length > 0) {
		const { fromDir, name, optional } = queue.shift()
		const dir = resolveDep(fromDir, name)
		if (dir == null) {
			if (optional) continue
			throw new Error(`cannot resolve dependency "${name}" from ${fromDir}`)
		}
		if (seenDirs.has(dir)) continue
		seenDirs.add(dir)
		const pkg = readPackageJson(dir)
		packages.push({ name: pkg.name, version: pkg.version, dir, pkg })
		for (const dep of Object.keys(pkg.dependencies ?? {})) {
			queue.push({ fromDir: dir, name: dep, optional: false })
		}
		for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
			queue.push({ fromDir: dir, name: dep, optional: true })
		}
	}
	return packages
}

// ---------------------------------------------------------------------------
// License text extraction
// ---------------------------------------------------------------------------

function licenseId(pkg) {
	const l = pkg.license ?? pkg.licenses
	if (typeof l === 'string') return l
	if (Array.isArray(l) && l.length > 0) return l.map((e) => e.type ?? e).join(' OR ')
	if (l && typeof l === 'object' && l.type) return l.type
	return 'UNKNOWN'
}

// Preferred license file basenames, best first; anything else matching the
// pattern sorts after these, alphabetically.
const LICENSE_FILE_RANK = [
	'license',
	'license.md',
	'license.txt',
	'licence',
	'licence.md',
	'licence.txt',
	'copying',
	'copying.md',
	'copying.txt',
]

function findLicenseFile(dir) {
	let names
	try {
		names = fs.readdirSync(dir)
	} catch {
		return null
	}
	const matches = names
		.filter((n) => /^(license|licence|copying)(\.|$|-)/i.test(n))
		.filter((n) => fs.statSync(path.join(dir, n)).isFile())
	if (matches.length === 0) return null
	matches.sort((a, b) => {
		const ra = LICENSE_FILE_RANK.indexOf(a.toLowerCase())
		const rb = LICENSE_FILE_RANK.indexOf(b.toLowerCase())
		const ka = ra === -1 ? LICENSE_FILE_RANK.length : ra
		const kb = rb === -1 ? LICENSE_FILE_RANK.length : rb
		if (ka !== kb) return ka - kb
		return a < b ? -1 : a > b ? 1 : 0
	})
	return path.join(dir, matches[0])
}

// A copyright line starts (after indentation) with a literal "Copyright".
// Case-sensitive on purpose: license prose like "copyright notice that is
// included…" (Apache §1) must stay in the body.
const COPYRIGHT_LINE = /^\s*Copyright\b/

// Unfilled boilerplate (the Apache appendix template) is stripped from the
// body but is nobody's notice.
function isTemplateCopyright(line) {
	return line.includes('[yyyy]') || line.includes('[name of copyright owner]')
}

// Split a license file into the copyright notices it contains and the
// remaining license body (copyright lines removed, blank runs collapsed,
// trimmed). Multiple notices in one file join with "; ".
function extractLicense(text) {
	const notices = []
	const bodyLines = []
	for (const rawLine of text.split(/\r\n|\r|\n/)) {
		if (COPYRIGHT_LINE.test(rawLine)) {
			if (!isTemplateCopyright(rawLine)) notices.push(rawLine.trim())
			continue
		}
		bodyLines.push(rawLine.replace(/\s+$/, ''))
	}
	const body = bodyLines
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
	return { notice: notices.join('; '), body }
}

// ---------------------------------------------------------------------------
// Grouping and rendering
// ---------------------------------------------------------------------------

// Texts count as "identical license terms" ignoring whitespace differences
// and a leading title line ("MIT License" vs "The MIT License (MIT)"): only
// the terms themselves distinguish variants.
function normalizeForGrouping(body) {
	const lines = body.split('\n')
	if (lines.length > 0 && lines[0].trim().length <= 60 && /licen[cs]e/i.test(lines[0])) {
		lines.shift()
	}
	return lines.join('\n').replace(/\s+/g, ' ').trim()
}

function compareStrings(a, b) {
	return a < b ? -1 : a > b ? 1 : 0
}

function compareVersions(a, b) {
	const pa = a.split(/[.+-]/)
	const pb = b.split(/[.+-]/)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = Number(pa[i] ?? '0')
		const nb = Number(pb[i] ?? '0')
		if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
		const c = compareStrings(pa[i] ?? '', pb[i] ?? '')
		if (c !== 0) return c
	}
	return 0
}

function buildNotices() {
	const packages = collectProductionPackages()
	const entries = packages.map(({ name, version, dir, pkg }) => {
		const id = licenseId(pkg)
		const file = findLicenseFile(dir)
		if (file != null) {
			const { notice, body } = extractLicense(fs.readFileSync(file, 'utf8'))
			return { name, version, license: id, notice, body }
		}
		// No license file shipped: fall back to the declared license id.
		return {
			name,
			version,
			license: id,
			notice: '',
			body:
				`This package ships no license text file; its package.json declares ` +
				`the "${id}" license.`,
		}
	})
	entries.sort(
		(a, b) => compareStrings(a.name, b.name) || compareVersions(a.version, b.version),
	)

	// Group by (declared license id, whitespace-normalized body). The first
	// entry of each group (already in name order) supplies the verbatim text.
	const groups = new Map()
	for (const entry of entries) {
		const key = `${entry.license}\0${normalizeForGrouping(entry.body)}`
		let group = groups.get(key)
		if (group == null) {
			group = { license: entry.license, body: entry.body, entries: [] }
			groups.set(key, group)
		}
		group.entries.push(entry)
	}

	// Sections: biggest groups first, then license id, then first package.
	const sections = [...groups.values()]
	for (const section of sections) {
		section.names = [...new Set(section.entries.map((e) => e.name))]
	}
	sections.sort(
		(a, b) =>
			b.names.length - a.names.length ||
			compareStrings(a.license, b.license) ||
			compareStrings(a.entries[0].name, b.entries[0].name),
	)

	// Number variants per license id, in section order.
	const perLicense = new Map()
	for (const section of sections) {
		const list = perLicense.get(section.license) ?? []
		list.push(section)
		perLicense.set(section.license, list)
	}
	for (const section of sections) {
		const list = perLicense.get(section.license)
		section.heading =
			list.length > 1
				? `${section.license} (variant ${list.indexOf(section) + 1})`
				: section.license
	}

	const out = []
	out.push('# Third-Party Notices')
	out.push('')
	out.push('This project incorporates components from the open-source packages listed')
	out.push('below. The original copyright notices and license terms under which each')
	out.push('component is distributed are reproduced here, as required by those licenses.')
	out.push('')
	out.push('This file covers the packages bundled into the distributed application')
	out.push('(the production dependency tree). Build-time and test-only tooling is not')
	out.push('distributed with the application and is therefore not listed.')
	out.push('')
	out.push('Packages sharing identical license terms are grouped: the group lists each')
	out.push('package with its copyright notice, followed by a single reproduction of the')
	out.push('shared license text.')
	out.push('')
	out.push('| Package | Version | License |')
	out.push('| --- | --- | --- |')
	for (const entry of entries) {
		out.push(`| ${entry.name} | ${entry.version} | ${entry.license} |`)
	}

	for (const section of sections) {
		out.push('')
		out.push('---')
		out.push('')
		out.push(`## ${section.heading}`)
		out.push('')
		out.push(
			'The packages named below are distributed under the license terms ' +
				'reproduced at the end of this section. Each distinct copyright notice ' +
				'is listed once, followed by the packages it applies to.',
		)
		out.push('')
		// One bullet per distinct copyright notice, listing the packages it
		// covers; bullets ordered by their first package name.
		const byNotice = new Map()
		for (const entry of section.entries) {
			const names = byNotice.get(entry.notice) ?? []
			if (!names.includes(entry.name)) names.push(entry.name)
			byNotice.set(entry.notice, names)
		}
		const noticeRows = [...byNotice.entries()]
			.map(([notice, names]) => ({ notice, names: names.sort(compareStrings) }))
			.sort((a, b) => compareStrings(a.names[0], b.names[0]))
		for (const row of noticeRows) {
			const label = row.notice === '' ? '(no copyright notice in license file)' : row.notice
			out.push(`- ${label} (${row.names.join(', ')})`)
		}
		out.push('')
		out.push('```')
		out.push(section.body)
		out.push('```')
	}
	out.push('')
	return out.join('\n')
}

fs.writeFileSync(outFile, buildNotices())
process.stdout.write(`wrote ${path.relative(repoRoot, outFile)}\n`)
