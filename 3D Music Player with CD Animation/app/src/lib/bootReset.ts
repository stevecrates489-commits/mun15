import { store as wallStore } from './wallpaperPipeline'

/* Factory reset (Ctrl+Shift+R): the keydown handler in Home sets
   md-hard-reset, the browser reloads, and this module — evaluated before
   React renders — wipes everything in time for every settings initializer
   and restore effect, whoever awaits it first. Module scope = once per
   page load, never re-run by Fast Refresh. */
export const bootReset: Promise<void> = (async () => {
  if (localStorage.getItem('md-hard-reset') !== '1') return
  localStorage.removeItem('md-hard-reset')
  Object.keys(localStorage)
    .filter((k) => k.startsWith('md-'))
    .forEach((k) => localStorage.removeItem(k))
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase('md-walkman')
    req.onsuccess = () => res()
    req.onerror = () => res()
    req.onblocked = () => res()
  })
  /* also wipe the converted-wallpaper store */
  await wallStore
    .list()
    .then((recs) => Promise.all(recs.map((r) => wallStore.remove(r.id))))
    .catch(() => {})
})()
