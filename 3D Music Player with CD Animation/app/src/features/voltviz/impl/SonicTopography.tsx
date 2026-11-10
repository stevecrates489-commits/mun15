/**
 * Sonic Topography — CmzYa's audio-reactive pillar terrain
 * (https://github.com/CmzYa/sonic-topography), ported for the player. GPL-3.0;
 * © CmzYa. See `../sonic/LICENSE`.
 *
 * What was ported
 * ---------------
 * `MapScene.tsx` + `CustomShaderMaterial.ts` (React Three Fiber + drei's
 * `shaderMaterial`) → the same scene in plain three.js: the instanced pillar
 * grid, the identical vertex/fragment shaders and uniform set, the meteor and
 * trail-particle pools, the camera rig and the theme color lerp. The scene
 * logic ran on a 1000 Hz "logic frame" + R3F's render frame upstream; here it
 * runs on the backdrop's render frame with the same dt-scaled math, which is
 * indistinguishable at display rates.
 *
 * `lib/AudioEngine.ts` → `../sonic/audio-engine.ts` (GPL header kept): the
 * Wallpaper Engine audio listener is gone and `setSpectrum()` is fed from the
 * deck's own `AnalyserNode` instead — a 64-bin, 0–22 kHz magnitude frame
 * resampled by frequency from real analyser bins, exactly the shape Wallpaper
 * Engine delivered, so every band cut and trigger threshold keeps its tuning.
 *
 * Wallpaper Engine-only chrome (player controller, album art, property panel,
 * click-to-meteor) is not ported: this visualizer only renders the terrain
 * and reacts to the music.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, EyeOff, SlidersHorizontal } from 'lucide-react';
import * as THREE from 'three186';
import { createRenderer, disposeObject, disposeRenderer } from '../lib/three';
import { SonicAudioEngine } from '../sonic/audio-engine';
import { themes } from '../sonic/themes';
import { loadSonicSettings, saveSonicSettings } from '../sonic/settings';
import type { OverlayProps, VisualizerFactory } from '../runtime-types';

/* ---- persisted settings (the shared VoltViz tuning rides alongside it) ---- */

const SETTINGS_KEY = 'md-voltviz-sonic-topography';

interface SonicSettings {
  theme: string;
  idleWave: boolean;
  pulses: boolean;
  meteors: boolean;
  rippleStrength: number;
  meteorStrength: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  peakColor: boolean;
  tilt: number;
  central: boolean;
  ring: boolean;
  flow: boolean;
  river: boolean;
  spike: boolean;
}

const SETTINGS_DEFAULTS: SonicSettings = {
  theme: 'nocturnal',
  idleWave: true,
  pulses: true,
  meteors: true,
  rippleStrength: 1,
  meteorStrength: 1,
  autoRotate: false,
  autoRotateSpeed: 10,
  peakColor: true,
  tilt: 25,
  central: true,
  ring: true,
  flow: true,
  river: true,
  spike: true,
};

/* ---- the shader (upstream CustomShaderMaterial, verbatim GLSL) ---- */

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uIdleWave;
  uniform float uCentralIntensity;
  uniform float uRingIntensity;
  uniform float uFlowIntensity;
  uniform float uRiverIntensity;
  uniform float uSpikeIntensity;
  uniform float uResponseRange;
  uniform float uHalfExtent;

  // Frequency envelopes
  uniform float uSubBass;
  uniform float uBass;
  uniform float uLowMid;
  uniform float uMid;
  uniform float uHighMid;

  // Timbral
  uniform float uSmoothness;
  uniform float uDensity;
  uniform float uEnergy;

  struct Ripple {
    vec2 pos;
    float time;
    float strength;
    float isActive;
    float rippleType;
  };
  uniform Ripple uRipples[20];

  varying vec2 vUv;
  varying float vElevation;
  varying float vDistance;
  varying vec2 vRippleAnim; // x for normal, y for white
  varying vec3 vNormal;
  varying float vRelativeY;
  varying vec2 vInstancePos;
  varying float vPeakIntensity;

  // Simplex noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187,  0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ; m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  // Eased lift: ease-out-cubic for smooth rise + subtle elastic overshoot at high energy
  float easeLift(float raw, float maxHeight) {
    float x = clamp(raw, 0.0, 1.0);
    float eased = 1.0 - pow(1.0 - x, 2.5);
    float overshoot = sin(x * 6.283 * 1.5) * exp(-x * 4.0) * 0.15;
    return (eased + overshoot) * maxHeight;
  }

  // Flow lift: quick initial response, soft peak with gentle pulsing mid-energy
  float flowLift(float raw, float maxHeight) {
    float x = clamp(raw, 0.0, 1.0);
    float eased = pow(x, 0.75);
    float breathe = sin(x * 3.14159) * 0.12;
    return (eased + breathe) * maxHeight;
  }

  void main() {
    vUv = uv;
    vNormal = normal;

    vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 pos2D = instancePos.xz;
    vInstancePos = pos2D;

    float centerDist = length(pos2D);
    vDistance = centerDist;

    float rnd = random(pos2D);

    // 1. Idle Background state (smooth, ocean-like)
    vec2 movingPos = pos2D * 0.05 + vec2(uTime * 0.1, uTime * 0.05);
    float baseNoise = (snoise(movingPos) + 1.0) * 0.5;
    float wave = sin(pos2D.x * 0.15 + pos2D.y * 0.1 - uTime * 0.6) * 0.5 + 0.5;

    float range = uResponseRange;
    float globalFalloff = smoothstep(uHalfExtent * 0.71 * range, uHalfExtent * 0.36 * range, centerDist);
    float idleElevation = mix(baseNoise, wave, uSmoothness * 0.5 + 0.2) * 0.8 * globalFalloff;

    // 2. Frequency Regions & Displacements with eased animation curves

    // Sub-Bass: Center heavy, ultra slow rolling hills, massive block lifts
    float subRegion = smoothstep(uHalfExtent * 0.30 * range, 0.0, centerDist);
    float subLift = easeLift(uSubBass, 6.0) * subRegion * uCentralIntensity;

    // Peak intensity: derived from subLift height, normalised to 0-1
    vPeakIntensity = clamp(subLift / 6.0, 0.0, 1.0);

    // Bass: Chunk-based lifts, springy feel
    float bassNoise = snoise(pos2D * 0.1 - vec2(0.0, uTime * 0.2));
    float bassRegion = smoothstep(uHalfExtent * 0.42 * range, uHalfExtent * 0.06 * range, centerDist + bassNoise * 5.0);
    float bassRnd = smoothstep(0.0, 1.0, rnd + uDensity * 0.5);
    float bassLift = easeLift(uBass, 5.0) * bassRegion * bassRnd * uRingIntensity;

    // Low Mid: Flowing waves across the whole map slowly
    float lowMidNoise = snoise(pos2D * 0.05 + vec2(uTime * 0.1, 0.0));
    float lowMidLift = flowLift(uLowMid, 3.0) * (lowMidNoise * 0.5 + 0.5) * uFlowIntensity;

    // Mid: River-like current. Strong diagonal flow.
    float riverFlow = sin(pos2D.x * 0.2 + pos2D.y * 0.2 + snoise(pos2D * 0.1) * 2.0 - uTime * 2.0);
    float midLift = flowLift(uMid, 4.0) * max(0.0, riverFlow) * uRiverIntensity;

    // High Mid: Individual scattered spikes, highly dependent on column random
    float highMidRegion = smoothstep(uHalfExtent * 0.12 * range, uHalfExtent * 0.54 * range, centerDist);
    float highMidLift = 0.0;
    if (fract(rnd * 13.3) > 0.8) {
        float hmRaw = easeLift(uHighMid, 3.0);
        highMidLift = hmRaw * highMidRegion * fract(rnd * 7.7) * uSpikeIntensity;
    }

    // Combine independent per-channel lifts (each already scaled by its own intensity)
    float audioElevation = subLift + bassLift + lowMidLift + midLift + highMidLift;

    // Energy Spike with elastic bounce
    if (rnd > 0.99) {
        float energyRaw = clamp(uEnergy, 0.0, 1.0);
        float energyBounce = 1.0 - pow(1.0 - energyRaw, 1.5);
        energyBounce += sin(energyRaw * 6.283 * 2.0) * exp(-energyRaw * 5.0) * 0.2;
        audioElevation += energyBounce * 6.0 * uSpikeIntensity;
    }

    audioElevation *= globalFalloff;

    // Background ambient noise - always present as base layer
    float hillNoise = snoise(pos2D * 0.08 + vec2(uTime * 0.12, 0.0));
    float hillNoise2 = snoise(pos2D * 0.06 + vec2(0.0, uTime * 0.08));

    // Medium flowing ripples
    float rippleNoise = snoise(pos2D * 0.15 + vec2(uTime * 0.2, uTime * 0.15));

    // Fine subtle texture
    float textureNoise = snoise(pos2D * 0.4 + uTime * 0.3) * 0.3;

    float baseUndulation = hillNoise * 0.6 + hillNoise2 * 0.4;
    baseUndulation = baseUndulation * 0.5 + 0.5;

    float rippleUndulation = rippleNoise * 0.3 + 0.5;

    // Per-block subtle variation
    float blockVariation = (rnd - 0.5) * 0.15;

    float combinedWave = baseUndulation * 0.5 + rippleUndulation * 0.35 + textureNoise + blockVariation;

    // Apply gentle easing curve for softer peaks
    combinedWave = smoothstep(0.1, 0.9, combinedWave);

    // Background ambient wave - always present, scaled by uIdleWave (default 1.0)
    float idleBlockWave = combinedWave * uIdleWave * 2.5 * globalFalloff;

    float elevation = idleElevation + audioElevation + idleBlockWave;

    // Ripples
    float rippleElevation = 0.0;
    float rippleIntensityNormal = 0.0;
    float rippleIntensityWhite = 0.0;
    float speed = 14.0;        // ripple spread speed
    float width = 5.0;         // ripple width

    for(int i = 0; i < 10; i++) {
      if(uRipples[i].isActive > 0.0) {
         float dist = length(pos2D - uRipples[i].pos);
         float timeSince = uTime - uRipples[i].time;

         float curSpeed = speed;
         float curWidth = width;
         float curFadeDist = 22.0;   // fade distance
         float elevationScale = 3.0; // height influence

         if (uRipples[i].rippleType > 0.5) {
             curSpeed = 18.0;
             curWidth = 2.5;         // meteor ripples are sharper
             curFadeDist = 18.0;     // fade slower, more visible
             elevationScale = 1.8;   // stronger height influence
         }

         float waveRadius = timeSince * curSpeed;
         float d = dist - waveRadius;
         // Gaussian-like falloff
         float rippleWave = exp(-d*d / curWidth);
         // fade curve
         float fade = exp(-waveRadius / curFadeDist);
         // smoothed strength curve
         float strengthCurve = clamp(uRipples[i].strength * 0.4, 0.0, 1.0);
         float rPulse = rippleWave * fade * strengthCurve;

         rippleElevation += rPulse * elevationScale;
         if (uRipples[i].rippleType > 0.5) {
             rippleIntensityWhite += rPulse;
         } else {
             rippleIntensityNormal += rPulse;
         }
      }
    }

    elevation += rippleElevation;
    vRippleAnim = vec2(
      clamp(sqrt(rippleIntensityNormal), 0.0, 1.0),
      clamp(sqrt(rippleIntensityWhite), 0.0, 1.0)
    );
    vElevation = elevation;

    float yPos = position.y + 0.5; // 0 to 1
    vRelativeY = yPos;

    float totalHeight = 1.0 + elevation;
    vec3 pos = position;
    pos.y = -0.5 + yPos * totalHeight; // Anchor bottom to local -0.5

    vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;

  // High frequency & timbral uniforms for color
  uniform float uPresence;
  uniform float uBrilliance;
  uniform float uAir;

  uniform float uWarmth;
  uniform float uBrightness;
  uniform float uSharpness;

  // Theme Uniforms
  uniform vec3 uBaseColor1;
  uniform vec3 uBaseColor2;
  uniform vec3 uCoolCore;
  uniform vec3 uCoolEdge;
  uniform vec3 uWarmCore;
  uniform vec3 uWarmEdge;
  uniform vec3 uRippleColor;
  uniform vec3 uPeakColor;
  uniform float uGlowIntensity;
  uniform float uPeakEnabled;
  uniform float uPeakIntensity;
  uniform float uLightMode;

  varying vec2 vUv;
  varying float vElevation;
  varying float vDistance;
  varying vec2 vRippleAnim;
  varying vec3 vNormal;
  varying float vRelativeY;
  varying vec2 vInstancePos;
  varying float vPeakIntensity;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  void main() {
    // Meteor ripple colour: bright white in dark mode (light mode is not ported)
    vec3 meteorRippleColor = vec3(1.0, 1.0, 1.0);

    bool isTop = vNormal.y > 0.5;
    float distFromTop = 1.0 - vRelativeY;

    float rnd = random(vInstancePos);
    float centerDist = length(vInstancePos);

    float normElevation = clamp(vElevation / 8.0, 0.0, 1.0);

    // Base dark pillars
    vec3 cBase1 = uBaseColor1;
    vec3 cBase2 = uBaseColor2;

    // Timbre determines palette
    vec3 coolCore = uCoolCore;
    vec3 coolEdge = uCoolEdge;

    vec3 warmCore = uWarmCore;
    vec3 warmEdge = uWarmEdge;

    float warmBlend = smoothstep(0.0, 1.0, uWarmth * 1.5 + (0.5 - centerDist/80.0));

    vec3 zoneCore = mix(coolCore, warmCore, warmBlend);
    vec3 zoneEdge = mix(coolEdge, warmEdge, warmBlend);

    // Shift colors slightly per pillar
    vec3 targetGlow = mix(zoneCore, zoneEdge, fract(rnd * 11.0));

    // Distance fade for contrast and brightness
    float distFade = 1.0 - smoothstep(40.0, 75.0, centerDist);

    // Brightness lifts the black point of the glow, adding cyan/white wash
    targetGlow = mix(targetGlow, vec3(0.4, 0.8, 1.0), uBrightness * 0.6);

    vec3 currentGlow = mix(cBase2, targetGlow, normElevation) * uGlowIntensity * distFade;

    // Ripple overrides - softer blend with squared intensity
    float normalBlend = vRippleAnim.x * vRippleAnim.x;
    float whiteBlend = vRippleAnim.y * vRippleAnim.y;
    currentGlow = mix(currentGlow, uRippleColor, normalBlend * 0.85);
    currentGlow = mix(currentGlow, meteorRippleColor, whiteBlend * 0.9);

    // Peak color - the centre bulge's summit colour
    float peakBlend = pow(vPeakIntensity, 0.85) * uPeakEnabled * uPeakIntensity;
    currentGlow = mix(currentGlow, uPeakColor, clamp(peakBlend, 0.0, 1.0) * 0.7);

    vec3 bodyColor = mix(cBase1, cBase2, vRelativeY * distFade);
    vec3 finalColor;

    if (isTop) {
       float topIntensity = smoothstep(0.0, 0.4, normElevation);

       // Peak color brightens the top face further
       topIntensity += clamp(peakBlend * 0.4, 0.0, 1.0);

       // Distance falloff for twinkling on flat ground
       float twinkleDistFalloff = smoothstep(60.0, 30.0, centerDist);
       float twinkleMultiplier = mix(twinkleDistFalloff, 1.0, smoothstep(0.01, 0.1, normElevation));

       // Inactive shimmering (Air / Brilliance)
       bool isSparkleTarget = fract(rnd * 31.0) > 0.95;
       if (isSparkleTarget && normElevation < 0.1) {
          topIntensity += uAir * 2.0 * twinkleMultiplier;
       }

       finalColor = mix(cBase2, currentGlow, topIntensity);

       // Edges glow on the top face
       float edgeX = smoothstep(0.05, 0.01, vUv.x) + smoothstep(0.95, 0.99, vUv.x);
       float edgeY = smoothstep(0.05, 0.01, vUv.y) + smoothstep(0.95, 0.99, vUv.y);
       float edge = min(edgeX + edgeY, 1.0);
       finalColor += currentGlow * edge * 0.8 * (topIntensity + 0.3);

       // Presence / Sharpness flickers - slower, more deliberate flashes
       float flashChance = smoothstep(0.5, 1.0, uPresence);
       if (fract(rnd * 53.0) > 0.985 - flashChance * 0.05) {
           float flashSync = sin(uTime * 8.0 + rnd * 50.0) * 0.5 + 0.5;
           finalColor += mix(vec3(1.0), vec3(0.5, 1.0, 1.0), rnd) * flashSync * uPresence * (1.0 + uSharpness * 1.5) * twinkleMultiplier;
       }

       // Brilliance micro-sparks strictly on edges - much rarer and slower
       float brilliancePhase = sin(uTime * 1.5 + rnd * 30.0) * 0.5 + 0.5;
       if (edge > 0.6 && fract(rnd * 89.0) > 0.992 && brilliancePhase > 0.7) {
           finalColor += vec3(1.0) * uBrilliance * 2.0 * twinkleMultiplier * brilliancePhase;
       }

    } else {
       // Side faces
       // Smooth music has longer vertical glow, sharp music restricts it tightly to top
       float verticalFalloff = mix(1.0, 3.0, uSharpness);
       float sideGlow = smoothstep(0.5 / verticalFalloff, 0.0, distFromTop) * normElevation;

       if (normElevation < 0.02) sideGlow = 0.0;

       vec3 sideGlowColor = mix(currentGlow, uPeakColor, clamp(peakBlend * 0.4, 0.0, 1.0));
       finalColor = mix(bodyColor, sideGlowColor, sideGlow * 1.5);

       // Top Rim
       float rimGlow = smoothstep(0.03, 0.0, distFromTop) * normElevation;
       finalColor += mix(currentGlow, uPeakColor, clamp(peakBlend * 0.35, 0.0, 1.0)) * rimGlow;
    }

    // Peak colour wash over everything
    finalColor = mix(finalColor, uPeakColor, clamp(peakBlend * 0.15, 0.0, 1.0));

    finalColor += uRippleColor * normalBlend * 0.4;
    finalColor += (meteorRippleColor - vec3(0.5)) * whiteBlend * 1.4;

    // Aerial Perspective / Fog
    float aerialFog = smoothstep(30.0, 65.0, vDistance);
    vec3 atmosphericColor = mix(cBase1, cBase2, 0.4);
    finalColor = mix(finalColor, atmosphericColor, aerialFog * 0.5);

    // Distance fade out to transparent
    float alphaFade = 1.0 - smoothstep(55.0, 78.0, vDistance);

    gl_FragColor = vec4(finalColor, alphaFade);
  }
`;

/* ---- the audio feed: real analyser bins → Wallpaper Engine's 64-bin frame ---- */

/* Wallpaper Engine delivered magnitudes 0..1 for 64 bins covering 0–22.05 kHz;
   every band cut and trigger below was tuned against that grid. The deck's
   analyser is resampled onto the same grid by frequency, so no tuning moves.
   `sens` is the visualizer's shared SENSITIVITY slider (a gain on the tap). */
const FEED_BINS = 64;
const FEED_TOP_HZ = 22050;

function resampleTo64(spec: Uint8Array, sampleRate: number, sens: number, out: number[]) {
  /* spec is byte frequency data of an 8192-point FFT: one bin per sampleRate/8192 Hz */
  const binHz = sampleRate / (spec.length * 2);
  const step = FEED_TOP_HZ / FEED_BINS;
  for (let i = 0; i < FEED_BINS; i++) {
    const from = Math.max(0, Math.floor((i * step) / binHz));
    const to = Math.max(from + 1, Math.floor(((i + 1) * step) / binHz));
    let sum = 0;
    let n = 0;
    for (let k = from; k < to && k < spec.length; k++, n++) sum += spec[k];
    const v = n > 0 ? (sum / n / 255) * sens : 0;
    out[i] = Math.min(1, Math.max(0, v));
  }
}

/* ---- the scene (upstream MapScene) ---- */

type ChannelName = 'central' | 'ring' | 'flow' | 'river' | 'spike';

interface SonicTopographyApi {
  setTheme(theme: string): void;
  setIdleWave(on: boolean): void;
  setPulses(on: boolean): void;
  setMeteors(on: boolean): void;
  setRippleStrength(v: number): void;
  setMeteorStrength(v: number): void;
  setAutoRotate(on: boolean): void;
  setAutoRotateSpeed(v: number): void;
  setPeakColor(on: boolean): void;
  setTilt(v: number): void;
  setChannel(name: ChannelName, on: boolean): void;
}

const GRID = 160;
const TOTAL_RANGE = 168;
const SPACING = TOTAL_RANGE / GRID;
const PILLAR_WIDTH = SPACING * 0.857;
const COUNT = GRID * GRID;
const HALF_EXTENT = TOTAL_RANGE / 2;
const MAX_METEORS = 40;
const MAX_PARTICLES = 200;
const PULSE_ANCHOR_EXPIRE_MS = 1500;
/* upstream wallpaper defaults: distance 85, azimuth 120°, elevation 25°;
   the shared SCALE slider maps to camera distance (zoom) */
const BASE_DISTANCE = 85;

const MeteorState = { active: false, x: 0, y: -1000, z: 0, speed: 0, strength: 0 };

const SonicTopography: VisualizerFactory = ({ container, width, height, dpr }) => {
  const st: SonicSettings = loadSonicSettings(SETTINGS_KEY, SETTINGS_DEFAULTS);

  const renderer = createRenderer(container, width, height, dpr, { antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);

  const engine = new SonicAudioEngine();
  engine.pulseTrigger.enabled = st.pulses;
  engine.meteorTrigger.enabled = st.meteors;
  const theme = () => themes[st.theme] ?? themes.nocturnal;

  /* fog + clear colour follow the theme's sky (upstream lerps fog to uBaseColor1) */
  const fog = new THREE.Fog(theme().uBaseColor1.clone(), 30, 95);
  scene.fog = fog;
  renderer.setClearColor(fog.color, 1);

  /* ---- uniforms: upstream shaderMaterial defaults, theme colours seeded from
     the selected theme so the first frame is already dressed ---- */
  const t0 = theme();
  const ripples: { pos: THREE.Vector2; time: number; strength: number; isActive: number; rippleType: number }[] =
    Array.from({ length: 20 }, () => ({ pos: new THREE.Vector2(), time: -100, strength: 0, isActive: 0, rippleType: 0 }));

  const uniforms = {
    uTime: { value: 0 },
    uSubBass: { value: 0 },
    uBass: { value: 0 },
    uLowMid: { value: 0 },
    uMid: { value: 0 },
    uHighMid: { value: 0 },
    uPresence: { value: 0 },
    uBrilliance: { value: 0 },
    uAir: { value: 0 },
    uWarmth: { value: 0 },
    uBrightness: { value: 0 },
    uSharpness: { value: 0 },
    uSmoothness: { value: 0 },
    uDensity: { value: 0 },
    uSpectralCentroid: { value: 0 },
    uEnergy: { value: 0 },
    uIdleWave: { value: 0 },
    uCentralIntensity: { value: 1 },
    uRingIntensity: { value: 1 },
    uFlowIntensity: { value: 1 },
    uRiverIntensity: { value: 1 },
    uSpikeIntensity: { value: 1 },
    uResponseRange: { value: 1 },
    uHalfExtent: { value: HALF_EXTENT },
    uRipples: { value: ripples },
    uBaseColor1: { value: t0.uBaseColor1.clone() },
    uBaseColor2: { value: t0.uBaseColor2.clone() },
    uCoolCore: { value: t0.uCoolCore.clone() },
    uCoolEdge: { value: t0.uCoolEdge.clone() },
    uWarmCore: { value: t0.uWarmCore.clone() },
    uWarmEdge: { value: t0.uWarmEdge.clone() },
    uRippleColor: { value: t0.uRippleColor.clone() },
    uPeakColor: { value: t0.uPeakColor.clone() },
    uGlowIntensity: { value: t0.uGlowIntensity },
    uPeakEnabled: { value: 1 },
    uPeakIntensity: { value: 1 },
    uLightMode: { value: 0 }, // light mode is a wallpaper-only feature; dark mode only here
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: true,
  });

  const pillarGeometry = new THREE.BoxGeometry(PILLAR_WIDTH, 1, PILLAR_WIDTH);
  const pillars = new THREE.InstancedMesh(pillarGeometry, material, COUNT);
  {
    const m = new THREE.Matrix4();
    const offset = (GRID * SPACING) / 2;
    let i = 0;
    for (let x = 0; x < GRID; x++) {
      for (let z = 0; z < GRID; z++) {
        m.makeTranslation(x * SPACING - offset, 0.5, z * SPACING - offset);
        pillars.setMatrixAt(i++, m);
      }
    }
    pillars.instanceMatrix.needsUpdate = true;
  }
  scene.add(pillars);

  /* meteors + trail particles (upstream's two instanced meshes) */
  const meteorGeometry = new THREE.BoxGeometry(0.4, 1.2, 0.4);
  const meteorMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const meteors = new THREE.InstancedMesh(meteorGeometry, meteorMaterial, MAX_METEORS);
  meteors.frustumCulled = false;

  const particleGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const particleMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    toneMapped: false,
    transparent: true,
    opacity: 0.6,
  });
  const particles = new THREE.InstancedMesh(particleGeometry, particleMaterial, MAX_PARTICLES);
  particles.frustumCulled = false;
  scene.add(meteors, particles);

  /* ---- interaction pools (upstream's ripple/meteor/particle logic) ---- */

  let rippleIndex = 0;
  const addRipple = (x: number, y: number, strength: number, isWhite = false) => {
    const r = ripples[rippleIndex];
    r.pos.set(x, y);
    r.time = simTime;
    r.strength = strength;
    r.isActive = 1;
    r.rippleType = isWhite ? 1 : 0;
    rippleIndex = (rippleIndex + 1) % 20;
  };

  const meteorPool = Array.from({ length: MAX_METEORS }, () => ({ ...MeteorState }));
  let meteorIndex = 0;
  let lastMeteorSpawnTime = -Infinity;

  const addMeteor = (strength: number) => {
    const now = realTime;
    const cooldownSeconds = engine.meteorTrigger.cooldown / 60;
    if (now - lastMeteorSpawnTime < cooldownSeconds) return;
    lastMeteorSpawnTime = now;

    const angle = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * 35;
    const m = meteorPool[meteorIndex];
    m.active = true;
    m.x = Math.cos(angle) * dist;
    m.z = Math.sin(angle) * dist;
    m.y = 30 + Math.random() * 10;
    m.speed = 1.0 + Math.random() * 0.5 + strength * 2.5;
    m.strength = strength;
    meteorIndex = (meteorIndex + 1) % MAX_METEORS;
  };

  const particlePool = Array.from({ length: MAX_PARTICLES }, () => ({
    active: false,
    x: 0, y: -1000, z: 0,
    vx: 0, vy: 0, vz: 0,
    life: 0, maxLife: 1, scale: 1,
  }));
  let particleIndex = 0;

  const spawnParticle = (x: number, y: number, z: number, speedMultiplier: number) => {
    const p = particlePool[particleIndex];
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 1.5;
    p.y = y + (Math.random() - 0.5) * 1.5;
    p.z = z + (Math.random() - 0.5) * 1.5;
    p.vx = (Math.random() - 0.5) * 2.0;
    p.vy = Math.random() * 2.0 + speedMultiplier * 10.0;
    p.vz = (Math.random() - 0.5) * 2.0;
    p.life = 0;
    p.maxLife = 0.5 + Math.random() * 0.5;
    p.scale = Math.random() * 0.6 + 0.2;
    particleIndex = (particleIndex + 1) % MAX_PARTICLES;
  };

  /* Pulse anchor: keep kick ripples clustered in groups of 3~7 per anchor position */
  const pulseAnchor = { x: 0, z: 0, initialized: false, lastTriggerTime: 0, hitsRemaining: 0 };

  /* Triggered effects' intensity multipliers, read from the trigger callback */
  let rippleMultiplier = st.rippleStrength;
  let meteorMultiplier = st.meteorStrength;

  engine.onFreqTrigger = (strength, mode, action) => {
    if (action === 'Meteor') {
      addMeteor(Math.min(strength * 20, 4.0) * meteorMultiplier);
    } else {
      const now = performance.now();
      if (
        !pulseAnchor.initialized ||
        now - pulseAnchor.lastTriggerTime > PULSE_ANCHOR_EXPIRE_MS ||
        pulseAnchor.hitsRemaining <= 0
      ) {
        pulseAnchor.x = (Math.random() - 0.5) * 50;
        pulseAnchor.z = (Math.random() - 0.5) * 50;
        pulseAnchor.hitsRemaining = 5 + Math.floor(Math.random() * 9);
        pulseAnchor.initialized = true;
      }
      pulseAnchor.hitsRemaining--;
      pulseAnchor.lastTriggerTime = now;

      let rx: number, rz: number;
      if (mode === 'Kick') {
        rx = pulseAnchor.x + (Math.random() - 0.5) * 8;
        rz = pulseAnchor.z + (Math.random() - 0.5) * 8;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const dist = 15 + Math.random() * 45;
        rx = Math.cos(angle) * dist;
        rz = Math.sin(angle) * dist;
      }
      addRipple(rx, rz, Math.min(strength * 40, 8.0) * rippleMultiplier);
    }
  };

  /* ---- camera rig (upstream updateCameraPosition) ---- */
  let angleX = 120;
  let angleY = st.tilt;
  const updateCameraPosition = (ax: number, ay: number, dist: number) => {
    const azimuth = (ax * Math.PI) / 180;
    const elevation = (ay * Math.PI) / 180;
    const horizontalDist = dist * Math.cos(elevation);
    camera.position.x = horizontalDist * Math.sin(azimuth);
    camera.position.z = horizontalDist * Math.cos(azimuth);
    camera.position.y = dist * Math.sin(elevation);
    camera.lookAt(0, 0, 0);
  };
  updateCameraPosition(angleX, angleY, BASE_DISTANCE);

  /* ---- clock + feed scratch ---- */
  let simTime = 0; // the shader's clock: SCALE's SPEED multiplies its rate
  let realTime = 0; // seconds since mount, real time (spawn cooldowns, rotation)
  const feed = new Array<number>(FEED_BINS).fill(0);
  const tempColor = new THREE.Color();
  const whiteColor = new THREE.Color(0xffffff);
  const dummyPosition = new THREE.Vector3();
  const dummyRotation = new THREE.Quaternion();
  const dummyScale = new THREE.Vector3();
  const dummyMatrix = new THREE.Matrix4();

  /* hidden until first use, like upstream's per-frame writes */
  dummyPosition.set(0, -1000, 0);
  dummyScale.set(0, 0, 0);
  dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
  for (let i = 0; i < MAX_METEORS; i++) meteors.setMatrixAt(i, dummyMatrix);
  for (let i = 0; i < MAX_PARTICLES; i++) particles.setMatrixAt(i, dummyMatrix);
  meteors.instanceMatrix.needsUpdate = true;
  particles.instanceMatrix.needsUpdate = true;

  return {
    resize(w, h, pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    frame({ audio, settings, dt }) {
      /* ---- audio in: one resample of the deck's spectrum, then the engine ---- */
      resampleTo64(audio.spectrum({ fftSize: 8192, smoothing: 0 }), audio.sampleRate, settings.sensitivity, feed);
      engine.setSpectrum(feed);
      const data = engine.getAudioData(dt);
      const idle = engine.getIdleWaveIntensity(dt);

      simTime += dt * settings.speed;
      realTime += dt;

      /* ---- meteor + particle simulation (upstream's 1000 Hz logic frame) ---- */
      for (const m of meteorPool) {
        if (!m.active) continue;
        m.y -= m.speed * 60 * dt;
        if (m.y <= 0) {
          m.active = false;
          addRipple(m.x, m.z, m.strength * 1.5, true);
          for (let p = 0; p < 10; p++) spawnParticle(m.x, 0.5, m.z, m.speed * 1.5);
        } else if (Math.random() > 0.3) {
          spawnParticle(m.x, m.y, m.z, m.speed * 0.2);
        }
      }
      for (const p of particlePool) {
        if (!p.active) continue;
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
        } else {
          p.x += p.vx * dt * 10;
          p.y += p.vy * dt * 10;
          p.z += p.vz * dt * 10;
        }
      }

      /* ---- camera ---- */
      if (st.autoRotate) {
        angleX = (angleX + st.autoRotateSpeed * dt) % 360;
      }
      updateCameraPosition(angleX, angleY, BASE_DISTANCE / settings.scale);

      /* ---- theme colours (upstream lerps at 0.05 per render frame) ---- */
      const t = theme();
      const lerp = 0.05;
      uniforms.uBaseColor1.value.lerp(t.uBaseColor1, lerp);
      uniforms.uBaseColor2.value.lerp(t.uBaseColor2, lerp);
      uniforms.uCoolCore.value.lerp(t.uCoolCore, lerp);
      uniforms.uCoolEdge.value.lerp(t.uCoolEdge, lerp);
      uniforms.uWarmCore.value.lerp(t.uWarmCore, lerp);
      uniforms.uWarmEdge.value.lerp(t.uWarmEdge, lerp);
      uniforms.uRippleColor.value.lerp(t.uRippleColor, lerp);
      uniforms.uPeakColor.value.lerp(t.uPeakColor, lerp);
      uniforms.uGlowIntensity.value = THREE.MathUtils.lerp(uniforms.uGlowIntensity.value, t.uGlowIntensity, lerp);
      uniforms.uPeakEnabled.value = st.peakColor ? 1 : 0;
      fog.color.lerp(t.uBaseColor1, lerp);
      renderer.setClearColor(fog.color, 1);

      /* ---- uniforms ---- */
      uniforms.uTime.value = simTime;
      uniforms.uBass.value = data.bass;
      uniforms.uMid.value = data.mid;
      uniforms.uEnergy.value = data.energy;
      uniforms.uSubBass.value = data.subBass;
      uniforms.uLowMid.value = data.lowMid;
      uniforms.uHighMid.value = data.highMid;
      uniforms.uPresence.value = data.presence;
      uniforms.uBrilliance.value = data.brilliance;
      uniforms.uAir.value = data.air;
      uniforms.uWarmth.value = data.warmth;
      uniforms.uBrightness.value = data.brightness;
      uniforms.uSharpness.value = data.sharpness;
      uniforms.uSmoothness.value = data.smoothness;
      uniforms.uDensity.value = data.density;
      uniforms.uSpectralCentroid.value = data.spectralCentroid;
      uniforms.uCentralIntensity.value = st.central ? 1 : 0;
      uniforms.uRingIntensity.value = st.ring ? 1 : 0;
      uniforms.uFlowIntensity.value = st.flow ? 1 : 0;
      uniforms.uRiverIntensity.value = st.river ? 1 : 0;
      uniforms.uSpikeIntensity.value = st.spike ? 1 : 0;
      uniforms.uIdleWave.value = st.idleWave ? idle : 0;

      /* meteor matrices + colour */
      tempColor.copy(t.uWarmCore).lerp(whiteColor, 0.7);
      meteorMaterial.color.lerp(tempColor, lerp);
      for (let i = 0; i < MAX_METEORS; i++) {
        const m = meteorPool[i];
        if (!m.active) {
          dummyPosition.set(0, -1000, 0);
          dummyScale.set(0, 0, 0);
        } else {
          dummyPosition.set(m.x, Math.max(0, m.y), m.z);
          dummyScale.set(1.5, 1.5, 1.5);
        }
        dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
        meteors.setMatrixAt(i, dummyMatrix);
      }
      meteors.instanceMatrix.needsUpdate = true;

      /* particle matrices */
      particleMaterial.color.copy(meteorMaterial.color);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particlePool[i];
        if (!p.active) {
          dummyPosition.set(0, -1000, 0);
          dummyScale.set(0, 0, 0);
        } else {
          const s = p.scale * (1.0 - p.life / p.maxLife);
          dummyPosition.set(p.x, p.y, p.z);
          dummyScale.set(s, s, s);
        }
        dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
        particles.setMatrixAt(i, dummyMatrix);
      }
      particles.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
    },

    dispose() {
      disposeObject(scene);
      disposeRenderer(renderer);
    },

    api: {
      setTheme(next: string) {
        st.theme = themes[next] ? next : st.theme;
        save();
      },
      setIdleWave(on: boolean) { st.idleWave = on; save(); },
      setPulses(on: boolean) { st.pulses = on; engine.pulseTrigger.enabled = on; save(); },
      setMeteors(on: boolean) { st.meteors = on; engine.meteorTrigger.enabled = on; save(); },
      setRippleStrength(v: number) { st.rippleStrength = v; rippleMultiplier = v; save(); },
      setMeteorStrength(v: number) { st.meteorStrength = v; meteorMultiplier = v; save(); },
      setAutoRotate(on: boolean) { st.autoRotate = on; save(); },
      setAutoRotateSpeed(v: number) { st.autoRotateSpeed = v; save(); },
      setPeakColor(on: boolean) { st.peakColor = on; save(); },
      setTilt(v: number) { st.tilt = v; angleY = v; save(); },
      setChannel(name: ChannelName, on: boolean) {
        if (name === 'central') st.central = on;
        else if (name === 'ring') st.ring = on;
        else if (name === 'flow') st.flow = on;
        else if (name === 'river') st.river = on;
        else if (name === 'spike') st.spike = on;
        save();
      },
    } satisfies SonicTopographyApi,
  };

  function save() {
    saveSonicSettings(SETTINGS_KEY, { ...st });
  }
};

export default SonicTopography;

/* ---- the settings card (the visualizer's own controls, VoltViz-style) ---- */

const CHANNELS: readonly (readonly [ChannelName, string])[] = [
  ['central', 'CENTRE'],
  ['ring', 'RING'],
  ['flow', 'FLOW'],
  ['river', 'RIVER'],
  ['spike', 'SPIKE'],
];

export function Overlay({ api }: OverlayProps) {
  const vizApi = api as SonicTopographyApi | null;
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<SonicSettings>(() => loadSonicSettings(SETTINGS_KEY, SETTINGS_DEFAULTS));

  useEffect(() => { if (vizApi && s.theme) vizApi.setTheme(s.theme); }, [vizApi, s.theme]);
  useEffect(() => { vizApi?.setIdleWave(s.idleWave); }, [vizApi, s.idleWave]);
  useEffect(() => { vizApi?.setPulses(s.pulses); }, [vizApi, s.pulses]);
  useEffect(() => { vizApi?.setMeteors(s.meteors); }, [vizApi, s.meteors]);
  useEffect(() => { vizApi?.setRippleStrength(s.rippleStrength); }, [vizApi, s.rippleStrength]);
  useEffect(() => { vizApi?.setMeteorStrength(s.meteorStrength); }, [vizApi, s.meteorStrength]);
  useEffect(() => { vizApi?.setAutoRotate(s.autoRotate); }, [vizApi, s.autoRotate]);
  useEffect(() => { vizApi?.setAutoRotateSpeed(s.autoRotateSpeed); }, [vizApi, s.autoRotateSpeed]);
  useEffect(() => { vizApi?.setPeakColor(s.peakColor); }, [vizApi, s.peakColor]);
  useEffect(() => { vizApi?.setTilt(s.tilt); }, [vizApi, s.tilt]);
  useEffect(() => {
    for (const [name] of CHANNELS) vizApi?.setChannel(name, s[name]);
  }, [vizApi, s.central, s.ring, s.flow, s.river, s.spike]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<SonicSettings>) => setS((prev) => ({ ...prev, ...p }));

  const field = 'w-full px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer outline-none transition-colors';
  const select = `${field} appearance-none pr-9`;
  const option = 'bg-gray-900 text-white';
  const chevron = 'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/70';
  const chip = (on: boolean) =>
    `px-2 py-1 rounded-full border text-[10px] tracking-wide transition-colors ${
      on ? 'bg-emerald-400/15 border-emerald-400/50 text-emerald-200' : 'bg-white/5 border-white/15 text-white/50 hover:border-white/30'
    }`;
  const row = 'flex items-center justify-between gap-2';
  const label = 'font-mono text-[8px] tracking-[0.15em] text-white/40';

  return (
    <div className="absolute bottom-6 right-6 flex flex-col items-end gap-3 z-20">
      {open && (
        <div className="w-64 max-w-[calc(100vw-3rem)] flex flex-col gap-2 p-3 bg-black/60 backdrop-blur-sm border border-white/20 rounded-2xl">
          <div className="relative">
            <select
              aria-label="Theme"
              value={s.theme}
              onChange={(e) => patch({ theme: e.target.value })}
              className={select}
              style={{ colorScheme: 'dark' }}
            >
              {Object.values(themes).map((t) => (
                <option key={t.id} value={t.id} className={option}>Theme: {t.name}</option>
              ))}
            </select>
            <ChevronDown className={chevron} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button className={chip(s.idleWave)} onClick={() => patch({ idleWave: !s.idleWave })}>IDLE WAVE</button>
            <button className={chip(s.pulses)} onClick={() => patch({ pulses: !s.pulses })}>RIPPLES</button>
            <button className={chip(s.meteors)} onClick={() => patch({ meteors: !s.meteors })}>METEORS</button>
            <button className={chip(s.peakColor)} onClick={() => patch({ peakColor: !s.peakColor })}>PEAK</button>
            <button className={chip(s.autoRotate)} onClick={() => patch({ autoRotate: !s.autoRotate })}>SPIN</button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map(([name, label2]) => (
              <button key={name} className={chip(s[name])} onClick={() => patch({ [name]: !s[name] } as Partial<SonicSettings>)}>
                {label2}
              </button>
            ))}
          </div>

          {(
            [
              ['RIPPLE STRENGTH', 'rippleStrength', 0, 2, 0.1],
              ['METEOR STRENGTH', 'meteorStrength', 0, 2, 0.1],
              ['TILT', 'tilt', 5, 60, 1],
              ['SPIN SPEED', 'autoRotateSpeed', 2, 40, 1],
            ] as const
          ).map(([lab, key, min, max, step]) => (
            <div key={key}>
              <div className={row}>
                <span className={label}>{lab}</span>
                <span className="font-mono text-[8px] text-white/40">{s[key].toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={s[key]}
                onChange={(e) => patch({ [key]: Number(e.target.value) } as Partial<SonicSettings>)}
                className="chrome-range w-full"
                aria-label={lab.toLowerCase()}
              />
            </div>
          ))}

          <p className="font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
            SONIC TOPOGRAPHY — © CmzYa, GPL-3.0 · github.com/CmzYa/sonic-topography
          </p>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition-colors cursor-pointer"
        title={open ? 'Hide settings' : 'Show settings'}
        aria-expanded={open}
      >
        {open ? <EyeOff className="w-4 h-4" /> : <SlidersHorizontal className="w-4 h-4" />}
      </button>
    </div>
  );
}
