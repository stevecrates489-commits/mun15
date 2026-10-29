interface VisualizerEntry {
  readonly id: string;
  readonly name: string;
  readonly module: string;
}

// Single source of truth for all visualizers: the id union, the module map and
// the picker labels/order are all derived from this list (newest first).
export const visualizers = [
  { id: 'butterchurn', name: 'Butterchurn', module: 'Butterchurn' },
  { id: 'bargraph', name: 'Bar Graph', module: 'BarGraph' },
  { id: 'kaleidoscope', name: 'Kaleidoscope', module: 'Kaleidoscope' },
  { id: 'lasershow', name: 'Laser Show', module: 'LaserShow' },
  { id: 'halftonepulse', name: 'Halftone Pulse', module: 'HalftonePulse' },
  { id: 'holoblinds', name: 'Holo Blinds', module: 'HoloBlinds' },
  { id: 'shambhala', name: 'Shambhala', module: 'Shambhala' },
  { id: 'anunakisphere', name: 'Anunaki Sphere', module: 'AnunakiSphere' },
  { id: 'mossball', name: 'Moss Ball', module: 'MossBall' },
  { id: 'milkdropwarp', name: 'MilkDrop Warp', module: 'MilkDropWarp' },
  { id: 'aurorawaves', name: 'Aurora Waves', module: 'AuroraWaves' },
  { id: 'flame', name: 'Flame', module: 'Flame' },
  { id: 'defqonmainstage', name: 'Defqon Mainstage', module: 'DefqonMainstage' },
  { id: 'crtterminal', name: 'CRT Terminal', module: 'CRTTerminal' },
  { id: 'dutchgridwebgl', name: 'Dutch Grid (WebGL)', module: 'DutchGridWebGL' },
] as const satisfies readonly VisualizerEntry[];

export type VisualizerType = (typeof visualizers)[number]['id'];

export const visualizerIds = visualizers.map(v => v.id) as readonly VisualizerType[];

export const visualizerNames = Object.fromEntries(
  visualizers.map(v => [v.id, v.name])
) as Record<VisualizerType, string>;

export function isVisualizerType(value: string | null | undefined): value is VisualizerType {
  return !!value && (visualizerIds as readonly string[]).includes(value);
}

