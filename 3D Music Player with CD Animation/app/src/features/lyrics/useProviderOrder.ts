import { useCallback, useMemo, useState } from 'react'
import {
  providerOrderIsCustom,
  readProviderOrder,
  resetProviderOrder,
  writeProviderOrder,
} from './order.ts'
import { PROVIDER_IDS } from './registry.ts'

/**
 * The order the providers are asked in.
 *
 * It is the same for every track — it is a preference about how the player
 * behaves, not a piece of a song — so it is read once and kept in
 * localStorage.
 */
export function useProviderOrder() {
  const [order, setOrderState] = useState<string[]>(() => readProviderOrder(PROVIDER_IDS))

  const setOrder = useCallback((next: string[]) => {
    setOrderState(next)
    writeProviderOrder(next)
  }, [])

  const reset = useCallback(() => {
    setOrderState(resetProviderOrder())
  }, [])

  const isCustom = useMemo(
    () => providerOrderIsCustom(order, PROVIDER_IDS),
    [order],
  )

  return { order, setOrder, reset, isCustom }
}
