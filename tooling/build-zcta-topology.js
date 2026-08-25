// Generates the optional ZCTA (ZIP Code Tabulation Area) boundary asset at
// public/geo/zcta-500k.json from its authoritative source. Run with
// `pnpm zcta` (add --keep-work to leave the downloaded shapefile in place for
// a faster rerun).
//
// The asset is a BUILD INPUT, not source: it's gitignored, and this script
// reproduces it byte-for-byte, so builds that want ZIP maps run `pnpm zcta`
// first and builds that don't ship without them. Living under public/ means
// Vite copies it into dist/ as a SIDECAR file that the app fetches on first
// ZCTA use — it is never inlined into the single-file index.html, so the
// shareable build doesn't pay 8.6MB (or a boot-time JSON.parse) for a level
// most charts never touch. See lib/geo/zctaTopology.ts for the load seam.
//
// SOURCE — US Census Bureau 2020 cartographic boundary file, 1:500,000 scale:
//   https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip
//   (~64MB zip → ~93MB .shp, 33,791 ZCTA polygons, NAD83 lon/lat, public
//   domain. It is the smallest official form of these boundaries: Census
//   publishes no GeoJSON/KML for the 2020 ZCTA layer, and the TIGER/Line
//   edition is far larger and less generalized.)
//
// CONVERSION — one mapshaper pass (run through `npx`; mapshaper is deliberately
// NOT a package.json dependency — see the dependency policy in CLAUDE.md. This
// is a one-time offline conversion, not part of any build):
//
//   npx mapshaper -i shp/cb_2020_us_zcta520_500k.shp \
//     -filter-fields ZCTA5CE20 \
//     -simplify percentage=10% keep-shapes \
//     -rename-layers zctas \
//     -o format=topojson id-field=ZCTA5CE20 drop-table quantization=1e6 \
//        zcta-500k.json
//
// Why each flag:
//   -filter-fields ZCTA5CE20  drop AFFGEOID20/GEOID20/LSAD20/NAME20/ALAND20/
//                             AWATER20 — the 5-digit code is the ONLY column
//                             the app joins on (saves ~1.2MB).
//   -simplify 10% keep-shapes retains 10% of vertices (Visvalingam, mapshaper's
//                             default weighting) and never collapses a polygon
//                             away, so all 33,791 regions survive. See the
//                             fidelity note below.
//   -rename-layers zctas      the topology contract in zctaTopology.ts wants
//                             the features in `objects.zctas`.
//   id-field + drop-table     the code becomes the TopoJSON feature `id` and
//                             the attribute table is dropped entirely, so no
//                             `properties` object ships per feature.
//   quantization=1e6          us-atlas quantizes at 1e5; ZCTAs are ~10x smaller
//                             than counties, so 1e6 (a ~27m grid over the
//                             322°-wide national bbox vs ~270m) keeps dense
//                             urban ZIPs from staircasing, for ~1MB (7.6MB at
//                             1e5 vs 8.6MB at 1e6, same 10% retention) —
//                             vertex retention is what really drives size.
//
// SIZE / FIDELITY — measured while choosing the settings above (final JSON,
// attribute table dropped, quantization=1e6):
//   3% → 6.6MB   5% → 7.2MB   10% → 8.6MB   15% → 9.9MB   30% → 13.9MB
//   100% (no simplification) → 30.5MB
// At national and state zoom, 10% is visually indistinguishable from the
// unsimplified source. At deep metro zoom (a ~50km-wide view) polygons read as
// noticeably faceted, and higher retention buys little there without a big
// size jump — the chosen tradeoff for a file the browser downloads in one go
// the first time a visual uses the level. Lower the percentage if that
// download needs to shrink; discovery is file presence, so no code changes
// either way.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL =
	'https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip'
const SHP_BASENAME = 'cb_2020_us_zcta520_500k'
// Retention and quantization: see the SIZE / FIDELITY note above.
const SIMPLIFY_PERCENTAGE = '10%'
const QUANTIZATION = '1e6'
// Sanity floor/ceiling on the converted feature count (2020 vintage: 33,791).
const MIN_FEATURES = 33_000
const MAX_FEATURES = 34_500

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(repoRoot, 'public/geo/zcta-500k.json')
const workDir = path.join(os.tmpdir(), 'vis-components-zcta-build')
const zipFile = path.join(workDir, `${SHP_BASENAME}.zip`)
const shpFile = path.join(workDir, 'shp', `${SHP_BASENAME}.shp`)
const keepWork = process.argv.includes('--keep-work')

const log = (...args) => process.stdout.write(`${args.join(' ')}\n`)

function run(command, args) {
	const result = spawnSync(command, args, { stdio: 'inherit' })
	if (result.error) throw result.error
	if (result.status !== 0) {
		throw new Error(`${command} exited with status ${result.status}`)
	}
}

async function download(url, dest) {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`GET ${url} → ${response.status} ${response.statusText}`)
	}
	const bytes = new Uint8Array(await response.arrayBuffer())
	fs.writeFileSync(dest, bytes)
	log(`downloaded ${(bytes.byteLength / 1e6).toFixed(1)}MB → ${dest}`)
}

async function main() {
	fs.mkdirSync(workDir, { recursive: true })

	if (fs.existsSync(zipFile)) {
		log(`reusing cached download ${zipFile}`)
	} else {
		log(`fetching ${SOURCE_URL}`)
		await download(SOURCE_URL, zipFile)
	}

	if (fs.existsSync(shpFile)) {
		log(`reusing extracted shapefile ${shpFile}`)
	} else {
		run('unzip', ['-o', '-q', zipFile, '-d', path.join(workDir, 'shp')])
	}

	fs.mkdirSync(path.dirname(outFile), { recursive: true })
	log(`converting (simplify ${SIMPLIFY_PERCENTAGE}, quantization ${QUANTIZATION})`)
	run('npx', [
		'--yes',
		'mapshaper',
		'-i',
		shpFile,
		'-filter-fields',
		'ZCTA5CE20',
		'-simplify',
		`percentage=${SIMPLIFY_PERCENTAGE}`,
		'keep-shapes',
		'-rename-layers',
		'zctas',
		'-o',
		'format=topojson',
		'id-field=ZCTA5CE20',
		'drop-table',
		`quantization=${QUANTIZATION}`,
		'force',
		outFile,
	])

	// Verify the topology contract (zctaTopology.ts) before declaring success:
	// features under `objects.zctas`, every one carrying a 5-digit string id,
	// no leftover attribute table, and a plausible national feature count.
	const topology = JSON.parse(fs.readFileSync(outFile, 'utf8'))
	const geometries = topology.objects?.zctas?.geometries
	if (!Array.isArray(geometries)) {
		throw new Error('converted file has no objects.zctas geometry collection')
	}
	if (geometries.length < MIN_FEATURES || geometries.length > MAX_FEATURES) {
		throw new Error(
			`unexpected feature count ${geometries.length} (expected ` +
				`${MIN_FEATURES}–${MAX_FEATURES})`
		)
	}
	const badId = geometries.find((g) => !/^\d{5}$/.test(String(g.id)))
	if (badId) throw new Error(`feature without a 5-digit id: ${badId.id}`)
	const withProps = geometries.find((g) => g.properties !== undefined)
	if (withProps) throw new Error('attribute table was not dropped')

	const megabytes = fs.statSync(outFile).size / 1e6
	log(
		`wrote ${outFile} — ${geometries.length.toLocaleString('en-US')} ZCTAs, ` +
			`${megabytes.toFixed(1)}MB`
	)
	log(
		'NOTE: `vite build` now copies this into dist/geo/ as a sidecar file and ' +
			'enables the ZIP/ZCTA level; dist/index.html itself stays unchanged. ' +
			'Delete the file to build without ZIP maps.'
	)

	if (!keepWork) fs.rmSync(workDir, { recursive: true, force: true })
}

main().catch((error) => {
	process.stderr.write(`${error.message}\n`)
	process.exitCode = 1
})
