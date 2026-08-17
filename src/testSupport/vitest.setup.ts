// Global vitest setup — wired via `test.setupFiles` in vite.config.ts.
//
// Runs once per test FILE (vitest gives each file its own environment and
// re-executes the setup module against it), before the test file's own
// module body.

import { installInMemoryLocalStorage } from "./localStorageShim"

// Put every test file on an isolated in-memory localStorage from the start.
// Deliberately module-scope rather than `beforeEach`: many suites seed the
// persisted keys from a mount helper (and a few at module scope), so a
// per-test reinstall would wipe state those tests set up. Tests that want a
// guaranteed-fresh store — or the backing Map, to seed keys — call
// `installInMemoryLocalStorage()` themselves.
if (typeof window !== "undefined") installInMemoryLocalStorage()
