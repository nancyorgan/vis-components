import { createStore, Provider } from "jotai"
import { useState, type ReactNode } from "react"

export type TestStore = ReturnType<typeof createStore>

/** Test root that replaces Recoil's `<RecoilRoot initializeState={...}>`:
 * creates a fresh Jotai store per mount (isolating each test, like a
 * RecoilRoot did) and hands it to `initializeState` before the first render.
 * `store.set(atom, value)` has the same shape `MutableSnapshot.set` had.
 *
 * Note one deliberate semantic difference from Recoil: values set here WIN
 * over the persisted atoms' localStorage bootstrap (in Recoil the persist
 * effects clobbered `initializeState`, which is why older tests seed
 * localStorage instead — both seeding styles now work). */
export const TestProvider = ({
	initializeState,
	children,
}: {
	initializeState?: (store: TestStore) => void
	children: ReactNode
}) => {
	const [store] = useState(() => {
		const s = createStore()
		initializeState?.(s)
		return s
	})
	return <Provider store={store}>{children}</Provider>
}
