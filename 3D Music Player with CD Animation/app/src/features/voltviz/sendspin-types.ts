/**
 * The visuals in this folder were written against VoltViz's own audio and
 * Sendspin layers. The player has neither — its tracks come from the deck,
 * not from a Sendspin server — so the few type references those visuals make
 * are answered here instead of pulling a whole transport in.
 */

export interface ServerStateMetadata {
  title?: string
  artist?: string
  album?: string
  artwork_url?: string
  [key: string]: unknown
}
