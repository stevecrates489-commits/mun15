/**
 * Sonic Topography's 15 color themes, ported unchanged.
 *
 * Upstream: https://github.com/CmzYa/sonic-topography — `src/lib/themes.ts`,
 * GPL-3.0 (see LICENSE beside this file). © CmzYa. The extended fork
 * (https://github.com/Netesfiu/sonic-topography-extended, GPL-3.0) ships the
 * same palettes minus the light-mode constants, so both visualizers read this
 * one file.
 */

import * as THREE from 'three186';

export interface ThemeColors {
  name: string;
  id: string;
  uBaseColor1: THREE.Color;
  uBaseColor2: THREE.Color;
  uCoolCore: THREE.Color;
  uCoolEdge: THREE.Color;
  uWarmCore: THREE.Color;
  uWarmEdge: THREE.Color;
  uRippleColor: THREE.Color;
  uPeakColor: THREE.Color;
  uGlowIntensity: number;
}

/* Theme ids, used for cycling */
export const themeIds = [
  'nocturnal',
  'ocean-deep',
  'arctic-aurora',
  'cyber-forest',
  'golden-hour',
  'ember-fire',
  'crimson-sunset',
  'coral-mirage',
  'neon-tokyo',
  'minimal-monochrome',
  'teal-depth',
  'lavender-dream',
  'cherry-blossom',
  'copper-forge',
  'mint-fresh',
] as const;

export type ThemeId = (typeof themeIds)[number];

/* Light-mode constants: pale sky, white-bodied pillars with just enough grey
   to keep the volume readable */
export const lightSkyColor = new THREE.Color(0.88, 0.9, 0.94);
export const lightBaseColor1 = new THREE.Color(1.0, 1.0, 1.0);
export const lightBaseColor2 = new THREE.Color(0.93, 0.94, 0.96);

export const themes: Record<string, ThemeColors> = {
  // === 1. Indigo Violet ===
  nocturnal: {
    name: 'Nocturnal',
    id: 'nocturnal',
    uBaseColor1: new THREE.Color(0.005, 0.008, 0.025),
    uBaseColor2: new THREE.Color(0.015, 0.025, 0.07),
    uCoolCore: new THREE.Color(0.35, 0.1, 0.9),
    uCoolEdge: new THREE.Color(0.15, 0.0, 0.45),
    uWarmCore: new THREE.Color(0.65, 0.25, 1.0),
    uWarmEdge: new THREE.Color(0.5, 0.1, 0.8),
    uRippleColor: new THREE.Color(0.5, 0.2, 1.0),
    uPeakColor: new THREE.Color(1.0, 0.55, 0.05),
    uGlowIntensity: 1.0,
  },
  // === 2. Deep Ocean Blue ===
  'ocean-deep': {
    name: 'Ocean Deep',
    id: 'ocean-deep',
    uBaseColor1: new THREE.Color(0.002, 0.008, 0.028),
    uBaseColor2: new THREE.Color(0.005, 0.018, 0.06),
    uCoolCore: new THREE.Color(0.0, 0.25, 1.0),
    uCoolEdge: new THREE.Color(0.0, 0.08, 0.35),
    uWarmCore: new THREE.Color(0.15, 0.55, 1.0),
    uWarmEdge: new THREE.Color(0.05, 0.35, 0.85),
    uRippleColor: new THREE.Color(0.1, 0.5, 1.0),
    uPeakColor: new THREE.Color(1.0, 0.75, 0.1),
    uGlowIntensity: 1.1,
  },
  // === 3. Arctic Cyan ===
  'arctic-aurora': {
    name: 'Arctic Aurora',
    id: 'arctic-aurora',
    uBaseColor1: new THREE.Color(0.003, 0.015, 0.022),
    uBaseColor2: new THREE.Color(0.01, 0.03, 0.055),
    uCoolCore: new THREE.Color(0.0, 0.75, 0.85),
    uCoolEdge: new THREE.Color(0.0, 0.3, 0.5),
    uWarmCore: new THREE.Color(0.2, 1.0, 0.85),
    uWarmEdge: new THREE.Color(0.05, 0.6, 0.6),
    uRippleColor: new THREE.Color(0.1, 0.9, 0.9),
    uPeakColor: new THREE.Color(1.0, 0.25, 0.35),
    uGlowIntensity: 1.25,
  },
  // === 4. Emerald Green ===
  'cyber-forest': {
    name: 'Cyber Forest',
    id: 'cyber-forest',
    uBaseColor1: new THREE.Color(0.003, 0.018, 0.005),
    uBaseColor2: new THREE.Color(0.01, 0.045, 0.018),
    uCoolCore: new THREE.Color(0.0, 0.85, 0.35),
    uCoolEdge: new THREE.Color(0.0, 0.35, 0.15),
    uWarmCore: new THREE.Color(0.4, 1.0, 0.3),
    uWarmEdge: new THREE.Color(0.15, 0.65, 0.2),
    uRippleColor: new THREE.Color(0.3, 1.0, 0.4),
    uPeakColor: new THREE.Color(1.0, 0.2, 0.5),
    uGlowIntensity: 1.3,
  },
  // === 5. Warm Gold ===
  'golden-hour': {
    name: 'Golden Hour',
    id: 'golden-hour',
    uBaseColor1: new THREE.Color(0.018, 0.015, 0.005),
    uBaseColor2: new THREE.Color(0.045, 0.035, 0.012),
    uCoolCore: new THREE.Color(0.85, 0.6, 0.05),
    uCoolEdge: new THREE.Color(0.5, 0.3, 0.02),
    uWarmCore: new THREE.Color(1.0, 0.92, 0.35),
    uWarmEdge: new THREE.Color(0.85, 0.7, 0.15),
    uRippleColor: new THREE.Color(1.0, 0.85, 0.25),
    uPeakColor: new THREE.Color(0.2, 0.5, 1.0),
    uGlowIntensity: 1.2,
  },
  // === 6. Amber Orange ===
  'ember-fire': {
    name: 'Ember Fire',
    id: 'ember-fire',
    uBaseColor1: new THREE.Color(0.022, 0.008, 0.002),
    uBaseColor2: new THREE.Color(0.05, 0.018, 0.005),
    uCoolCore: new THREE.Color(1.0, 0.45, 0.0),
    uCoolEdge: new THREE.Color(0.6, 0.15, 0.0),
    uWarmCore: new THREE.Color(1.0, 0.78, 0.15),
    uWarmEdge: new THREE.Color(0.9, 0.55, 0.05),
    uRippleColor: new THREE.Color(1.0, 0.65, 0.1),
    uPeakColor: new THREE.Color(0.1, 0.4, 1.0),
    uGlowIntensity: 1.5,
  },
  // === 7. Crimson Red ===
  'crimson-sunset': {
    name: 'Crimson Sunset',
    id: 'crimson-sunset',
    uBaseColor1: new THREE.Color(0.025, 0.003, 0.005),
    uBaseColor2: new THREE.Color(0.055, 0.01, 0.015),
    uCoolCore: new THREE.Color(1.0, 0.05, 0.08),
    uCoolEdge: new THREE.Color(0.65, 0.0, 0.06),
    uWarmCore: new THREE.Color(1.0, 0.35, 0.2),
    uWarmEdge: new THREE.Color(0.85, 0.12, 0.1),
    uRippleColor: new THREE.Color(1.0, 0.15, 0.1),
    uPeakColor: new THREE.Color(0.1, 0.9, 0.7),
    uGlowIntensity: 1.4,
  },
  // === 8. Coral Pink ===
  'coral-mirage': {
    name: 'Coral Mirage',
    id: 'coral-mirage',
    uBaseColor1: new THREE.Color(0.02, 0.006, 0.01),
    uBaseColor2: new THREE.Color(0.045, 0.015, 0.022),
    uCoolCore: new THREE.Color(1.0, 0.25, 0.3),
    uCoolEdge: new THREE.Color(0.7, 0.08, 0.18),
    uWarmCore: new THREE.Color(1.0, 0.55, 0.55),
    uWarmEdge: new THREE.Color(0.9, 0.3, 0.35),
    uRippleColor: new THREE.Color(1.0, 0.4, 0.4),
    uPeakColor: new THREE.Color(0.1, 0.7, 1.0),
    uGlowIntensity: 1.3,
  },
  // === 9. Neon Magenta ===
  'neon-tokyo': {
    name: 'Neon Tokyo',
    id: 'neon-tokyo',
    uBaseColor1: new THREE.Color(0.01, 0.002, 0.025),
    uBaseColor2: new THREE.Color(0.03, 0.008, 0.065),
    uCoolCore: new THREE.Color(1.0, 0.05, 0.6),
    uCoolEdge: new THREE.Color(0.55, 0.02, 0.85),
    uWarmCore: new THREE.Color(1.0, 0.25, 0.85),
    uWarmEdge: new THREE.Color(0.8, 0.1, 0.7),
    uRippleColor: new THREE.Color(1.0, 0.2, 0.75),
    uPeakColor: new THREE.Color(0.95, 1.0, 0.15),
    uGlowIntensity: 1.6,
  },
  // === 10. Greyscale ===
  'minimal-monochrome': {
    name: 'Monochrome',
    id: 'minimal-monochrome',
    uBaseColor1: new THREE.Color(0.012, 0.012, 0.012),
    uBaseColor2: new THREE.Color(0.045, 0.045, 0.045),
    uCoolCore: new THREE.Color(0.8, 0.8, 0.8),
    uCoolEdge: new THREE.Color(0.3, 0.3, 0.3),
    uWarmCore: new THREE.Color(1.0, 1.0, 1.0),
    uWarmEdge: new THREE.Color(0.6, 0.6, 0.6),
    uRippleColor: new THREE.Color(1.0, 1.0, 1.0),
    uPeakColor: new THREE.Color(1.0, 1.0, 1.0),
    uGlowIntensity: 0.7,
  },
  // === 11. Teal ===
  'teal-depth': {
    name: 'Teal Depth',
    id: 'teal-depth',
    uBaseColor1: new THREE.Color(0.002, 0.018, 0.02),
    uBaseColor2: new THREE.Color(0.008, 0.04, 0.045),
    uCoolCore: new THREE.Color(0.0, 0.55, 0.55),
    uCoolEdge: new THREE.Color(0.0, 0.25, 0.28),
    uWarmCore: new THREE.Color(0.2, 0.85, 0.75),
    uWarmEdge: new THREE.Color(0.08, 0.55, 0.5),
    uRippleColor: new THREE.Color(0.15, 0.8, 0.7),
    uPeakColor: new THREE.Color(1.0, 0.45, 0.15),
    uGlowIntensity: 1.2,
  },
  // === 12. Lavender ===
  'lavender-dream': {
    name: 'Lavender Dream',
    id: 'lavender-dream',
    uBaseColor1: new THREE.Color(0.012, 0.008, 0.022),
    uBaseColor2: new THREE.Color(0.03, 0.02, 0.055),
    uCoolCore: new THREE.Color(0.55, 0.35, 0.85),
    uCoolEdge: new THREE.Color(0.3, 0.15, 0.55),
    uWarmCore: new THREE.Color(0.75, 0.55, 1.0),
    uWarmEdge: new THREE.Color(0.5, 0.3, 0.75),
    uRippleColor: new THREE.Color(0.65, 0.45, 1.0),
    uPeakColor: new THREE.Color(1.0, 0.8, 0.25),
    uGlowIntensity: 1.1,
  },
  // === 13. Cherry Blossom ===
  'cherry-blossom': {
    name: 'Cherry Blossom',
    id: 'cherry-blossom',
    uBaseColor1: new THREE.Color(0.018, 0.005, 0.012),
    uBaseColor2: new THREE.Color(0.04, 0.012, 0.025),
    uCoolCore: new THREE.Color(1.0, 0.55, 0.65),
    uCoolEdge: new THREE.Color(0.7, 0.2, 0.35),
    uWarmCore: new THREE.Color(1.0, 0.72, 0.78),
    uWarmEdge: new THREE.Color(0.85, 0.45, 0.55),
    uRippleColor: new THREE.Color(1.0, 0.6, 0.7),
    uPeakColor: new THREE.Color(0.25, 0.9, 0.55),
    uGlowIntensity: 1.15,
  },
  // === 14. Copper ===
  'copper-forge': {
    name: 'Copper Forge',
    id: 'copper-forge',
    uBaseColor1: new THREE.Color(0.02, 0.01, 0.005),
    uBaseColor2: new THREE.Color(0.045, 0.025, 0.012),
    uCoolCore: new THREE.Color(0.85, 0.45, 0.2),
    uCoolEdge: new THREE.Color(0.5, 0.22, 0.08),
    uWarmCore: new THREE.Color(1.0, 0.65, 0.3),
    uWarmEdge: new THREE.Color(0.75, 0.38, 0.15),
    uRippleColor: new THREE.Color(0.9, 0.55, 0.25),
    uPeakColor: new THREE.Color(0.3, 0.65, 0.35),
    uGlowIntensity: 1.3,
  },
  // === 15. Mint ===
  'mint-fresh': {
    name: 'Mint Fresh',
    id: 'mint-fresh',
    uBaseColor1: new THREE.Color(0.003, 0.02, 0.015),
    uBaseColor2: new THREE.Color(0.01, 0.045, 0.035),
    uCoolCore: new THREE.Color(0.3, 0.9, 0.65),
    uCoolEdge: new THREE.Color(0.1, 0.45, 0.3),
    uWarmCore: new THREE.Color(0.5, 1.0, 0.8),
    uWarmEdge: new THREE.Color(0.25, 0.7, 0.5),
    uRippleColor: new THREE.Color(0.4, 1.0, 0.7),
    uPeakColor: new THREE.Color(1.0, 0.3, 0.55),
    uGlowIntensity: 1.2,
  },
};
