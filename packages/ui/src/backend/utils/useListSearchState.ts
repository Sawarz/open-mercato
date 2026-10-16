'use client'
import * as React from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Hydrates a list page's search-box state from a query param on first render, so a directly
 * opened or refreshed `?search=...` URL shows the populated search box and the filtered first
 * data load, instead of the box (and the first request) starting empty while the address bar
 * already shows a filter.
 *
 * `#5524` fixed this on the Customers People/Companies/Deals pages by changing their
 * `React.useState('')` to `React.useState(() => searchParams?.get('search')?.trim() ?? '')`.
 * `#5525`/`#5527` generalize that one-line fix, repeated ~50 times across the backend, into
 * this hook so the next list page gets it by construction.
 *
 * Deliberately READ-ONLY and read-once (at mount): every call site already owns its own
 * write-back effect — typing updates `search` state, which a `router.replace` effect mirrors
 * into `?search=` as the user edits it. Re-reading `searchParams` on every URL change here
 * would fight that effect (the two would each try to own `search` state) and is not what the
 * bug being fixed needs: the bug is that the INITIAL value never reflected the URL, not that
 * later external navigation needs to live-resync the box.
 */
export function useListSearchState(
  paramName = 'search',
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const searchParams = useSearchParams()
  return React.useState(() => searchParams?.get(paramName)?.trim() ?? '')
}
