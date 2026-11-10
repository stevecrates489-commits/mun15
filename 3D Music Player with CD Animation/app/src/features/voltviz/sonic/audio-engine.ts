/**
 * Sonic Topography's audio engine, ported for the player.
 *
 * Upstream: https://github.com/CmzYa/sonic-topography — `src/lib/AudioEngine.ts`,
 * GPL-3.0 (see LICENSE beside this file). © CmzYa. This port keeps the band
 * math, the trigger evaluation and the idle-wave logic untouched; the only
 * change is the input: Wallpaper Engine's `wallpaperRegisterAudioListener`
 * callback is replaced by `setSpectrum()`, which the visualizer feeds from the
 * deck's own `AnalyserNode` — the same 64-bin, 0–22 kHz frame Wallpaper Engine
 * would have delivered, resampled from real analyser bins by frequency.
 */

export interface AudioData {
  // Legacy base
  bass: number;
  mid: number;
  treble: number;
  energy: number;

  // Granular bands
  subBass: number; // 20-60Hz
  lowMid: number; // 140-300Hz
  highMid: number; // 800-2kHz
  presence: number; // 2-4kHz
  brilliance: number; // 4-8kHz
  air: number; // 8-16kHz

  // Timbral Metrics
  warmth: number;
  brightness: number;
  sharpness: number;
  smoothness: number;
  density: number;
  spectralCentroid: number;
}

export type TriggerPreset = 'Auto Beat' | 'Advanced';

export class TriggerConfig {
  public enabled: boolean = false;
  public mode: TriggerPreset = 'Auto Beat';

  // Advanced parameters
  public freqIndex: number = -1;
  public threshold: number = 0.5;

  // Auto Beat parameters
  public sensitivity: number = 0.15;
  public cooldown: number = 60;
  public bandStart: number = 0;
  public bandEnd: number = 16;
  public pulseStrength: number = 0.2;

  // Internal evaluation state
  public currentCooldown: number = 0;
  public beatHold: number = 0;
  public lastEvalEnergy: number = 0;
  public lastEvalThresh: number = 0;

  public fluxHistory: number[] = new Array(40).fill(0);
  public fluxHistoryIndex: number = 0;
  public smoothedFlux: number = 0;
  public prevSmoothedFlux: number = 0;

  public action: 'Pulse' | 'Meteor';

  constructor(action: 'Pulse' | 'Meteor') {
    this.action = action;
    this.enabled = true;
    this.mode = 'Auto Beat';
    if (action === 'Pulse') {
      // Pulse: target sub-bass to low-mid range (~0-516 Hz)
      // Covers kick drums, bass, snare body, and low frequency transients
      this.bandStart = 0;
      this.bandEnd = 12;
      this.sensitivity = 0.22;
      this.cooldown = 45; // ~0.75s at 60fps, allows faster beat tracking
      this.pulseStrength = 0.25;
    } else if (action === 'Meteor') {
      // Meteor: target high and very high frequencies (~4000-15000 Hz)
      // Covers vocal sibilance, cymbals, hi-hats, and bright airy transients
      this.bandStart = 92;
      this.bandEnd = 340;
      this.sensitivity = 0.4;
      this.cooldown = 180; // ~3s between meteors for dramatic effect
      this.pulseStrength = 0.5;
    }
  }

  public getTriggerRange(): [number, number] {
    if (this.mode === 'Auto Beat') return [this.bandStart, this.bandEnd];
    const c = this.freqIndex >= 0 ? this.freqIndex : Math.floor(0.2 * 512);
    return [Math.max(0, c - 2), Math.min(511, c + 2)];
  }
}

export class SonicAudioEngine {
  public isPlaying: boolean = false;
  private idleFadeOutDuration = 1.0;
  private lastActiveTime: number = 0;
  private lastIdleTime: number = 0;
  private idleEnergyThreshold = 0.02;
  private currentIdleIntensity: number = 0;
  private debounceDuration = 1.0;
  private idleStartTime: number = 0; // 0 = not idle, >0 = when idling began

  private prevData: number[] = new Array(512).fill(0);
  private prevBrightness: number = 0;

  // The incoming spectrum frame and whether one has arrived
  private incomingAudioData: number[] = new Array(512).fill(0);
  private audioReceived: boolean = false;

  private smoothedData: AudioData = {
    bass: 0, mid: 0, treble: 0, energy: 0,
    subBass: 0, lowMid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0,
    warmth: 0, brightness: 0, sharpness: 0, smoothness: 0, density: 0, spectralCentroid: 0,
  };

  public pulseTrigger = new TriggerConfig('Pulse');
  public meteorTrigger = new TriggerConfig('Meteor');

  public onFreqTrigger?: (
    strength: number,
    type: 'Kick' | 'Snare' | 'Advanced',
    action: 'Pulse' | 'Meteor',
  ) => void;

  private evaluateTrigger(
    config: TriggerConfig,
    fluxScore: number,
    spectrumData: number[],
    deltaTime: number = 0.016,
  ) {
    if (!config.enabled) return;

    const binCount = 512;
    let eVal = 0;
    let triggered = false;
    const [startBin, endBin] = config.getTriggerRange();

    if (config.mode === 'Advanced') {
      if (config.freqIndex >= 0 && config.freqIndex < binCount) {
        let sum = 0;
        let count = 0;
        for (let k = startBin; k <= endBin; k++) {
          sum += spectrumData[k] || 0;
          count++;
        }
        eVal = sum / count;

        config.lastEvalThresh = config.threshold;
        if (config.currentCooldown <= 0 && eVal > config.threshold) {
          triggered = true;
        }
      }
      config.lastEvalEnergy = eVal;
      if (triggered) {
        if (this.onFreqTrigger) this.onFreqTrigger(eVal, 'Advanced', config.action);
        config.currentCooldown = 60;
      }
    }

    // Frame-rate independent cooldown decay (referenced to 60fps)
    if (config.currentCooldown > 0) config.currentCooldown -= deltaTime * 60;
    if (config.currentCooldown < 0) config.currentCooldown = 0;

    // Auto Beat Evaluation
    if (config.mode === 'Auto Beat') {
      // Frame-rate independent smoothing factor
      const fluxSmoothDt = 1 - Math.pow(1 - 0.4, deltaTime * 60);
      config.smoothedFlux += (fluxScore - config.smoothedFlux) * fluxSmoothDt;
      config.fluxHistory[config.fluxHistoryIndex] = config.smoothedFlux;
      config.fluxHistoryIndex = (config.fluxHistoryIndex + 1) % config.fluxHistory.length;

      let avgFlux = 0, fluxVariance = 0;
      for (let i = 0; i < config.fluxHistory.length; i++) avgFlux += config.fluxHistory[i];
      avgFlux /= config.fluxHistory.length;

      for (let i = 0; i < config.fluxHistory.length; i++) {
        fluxVariance += Math.pow(config.fluxHistory[i] - avgFlux, 2);
      }
      fluxVariance /= config.fluxHistory.length;
      const fluxStdDev = Math.sqrt(fluxVariance);

      const thresholdMultiplier = Math.max(0.1, 5.0 - config.sensitivity * 4.0);
      const adaptiveThreshold = Math.max(0.05, avgFlux + fluxStdDev * thresholdMultiplier);

      const isPeak = config.prevSmoothedFlux > adaptiveThreshold && config.prevSmoothedFlux >= config.smoothedFlux;

      if (config.beatHold > 0) {
        config.beatHold -= deltaTime * 60;
      } else if (isPeak && config.prevSmoothedFlux - config.smoothedFlux > 0.0001) {
        if (this.onFreqTrigger) this.onFreqTrigger(config.prevSmoothedFlux * 2.2 * config.pulseStrength, 'Kick', config.action);
        config.beatHold = config.cooldown;
      }

      config.lastEvalEnergy = config.smoothedFlux * 2.0;
      config.lastEvalThresh = adaptiveThreshold * 2.0;
      config.prevSmoothedFlux = config.smoothedFlux;
    }
  }

  // True once the first spectrum frame has arrived (the upstream
  // `isWallpaperEngineMode`)
  public hasAudio(): boolean {
    return this.audioReceived;
  }

  /**
   * The port's input seam. `audioData` is the Wallpaper Engine-style frame:
   * magnitude 0..1 per bin, up to 64 bins covering 0–22 kHz. Upstream expanded
   * whatever arrived to the engine's 512-bin working grid by interpolation;
   * that expansion is kept byte-for-byte so every band cut below sees the
   * values it was tuned against.
   */
  public setSpectrum(audioData: number[]) {
    // First time initialization
    if (!this.audioReceived) {
      this.lastActiveTime = performance.now();
      this.lastIdleTime = 0;
    }
    this.audioReceived = true;
    // Expand the incoming bins to 512 by interpolation
    const inputBins = audioData.length || 128;
    for (let i = 0; i < 512; i++) {
      const sourceIndex = Math.floor(i * inputBins / 512);
      this.incomingAudioData[i] = audioData[sourceIndex] || 0;
    }
  }

  // The engine's working spectrum (upstream `getWallpaperAudioData`)
  private getWorkingSpectrum(): number[] {
    return this.incomingAudioData;
  }

  public getAudioData(deltaTime: number = 0.016): AudioData {
    const spectrumData = this.getWorkingSpectrum();
    const binCount = spectrumData.length || 512;

    let energySum = 0;
    let centroidNum = 0;
    let centroidDen = 0;

    let subBassSum = 0, bassSum = 0, lowMidSum = 0, midSum = 0;
    let highMidSum = 0, presenceSum = 0, brillianceSum = 0, airSum = 0;
    let jumpVolatilitySum = 0;
    let fluxPulse = 0;
    let fluxMeteor = 0;

    this.isPlaying = true;

    for (let i = 0; i < binCount; i++) {
      const val = spectrumData[i] || 0;
      energySum += val;

      centroidNum += i * val;
      centroidDen += val;

      const prevVal = this.prevData[i] || 0;
      jumpVolatilitySum += Math.abs(val - prevVal);

      // Flux for pulse (low-mid frequency range)
      if (i >= this.pulseTrigger.bandStart && i <= this.pulseTrigger.bandEnd) {
        const diff = val - prevVal;
        if (diff > 0) fluxPulse += diff;
      }

      // Flux for meteor (high frequency range)
      if (i >= this.meteorTrigger.bandStart && i <= this.meteorTrigger.bandEnd) {
        const diff = val - prevVal;
        if (diff > 0) fluxMeteor += diff;
      }

      this.prevData[i] = val;

      // Frequency bands (optimized for visual effects)
      if (i <= 4) subBassSum += val; // 0-172 Hz: centre bulge
      else if (i <= 12) bassSum += val; // 172-516 Hz: mid ring
      else if (i <= 24) lowMidSum += val; // 516-1032 Hz: whole-map flow
      else if (i <= 45) midSum += val; // 1032-1935 Hz: river diagonal
      else if (i <= 81) highMidSum += val; // 1935-3483 Hz: edge spikes
      else if (i <= 120) presenceSum += val; // 3.5-5.2 kHz: top shimmer
      else if (i <= 180) brillianceSum += val; // 5.2-7.7 kHz: edge sparks
      else if (i <= 255) airSum += val; // 7.7-11 kHz: still sparkle
    }

    const energy = energySum / binCount;

    // Update last active/idle time based on audio energy
    if (energy > this.idleEnergyThreshold) {
      this.lastActiveTime = performance.now();
    } else {
      this.lastIdleTime = performance.now();
    }

    // Evaluate triggers
    this.evaluateTrigger(this.pulseTrigger, fluxPulse, spectrumData, deltaTime);
    this.evaluateTrigger(this.meteorTrigger, fluxMeteor, spectrumData, deltaTime);

    // Average amplitudes per band
    const subBass = subBassSum / 5; // bins 0-4
    const bass = bassSum / 9; // bins 5-12
    const lowMid = lowMidSum / 13; // bins 13-24
    const mid = midSum / 21; // bins 25-45
    const highMid = highMidSum / 37; // bins 46-81
    const presence = presenceSum / 40; // bins 82-120
    const brilliance = brillianceSum / 61; // bins 121-180
    const air = airSum / 76; // bins 181-255

    // Legacy mapping for compatibility
    const oldBass = (subBassSum + bassSum + lowMidSum) / 27; // bins 0-24
    const oldMid = (midSum + highMidSum) / 58; // bins 25-81
    const oldTreble = (presenceSum + brillianceSum + airSum) / 177; // bins 82-255

    // Timbral Metrics
    const warmth = energySum > 0 ? (subBassSum + bassSum + lowMidSum + midSum) / energySum : 0;
    const brightness = energySum > 0 ? (presenceSum + brillianceSum + airSum) / energySum : 0;

    const sharpness = Math.max(0, brightness - this.prevBrightness) * 10;
    this.prevBrightness = brightness;

    const smoothnessVal = Math.max(0, 1.0 - (jumpVolatilitySum / binCount) * 2.0);

    const activeThreshold = energy * 1.5;
    let activeBands = 0;
    if (subBass > activeThreshold) activeBands++;
    if (bass > activeThreshold) activeBands++;
    if (lowMid > activeThreshold) activeBands++;
    if (mid > activeThreshold) activeBands++;
    if (highMid > activeThreshold) activeBands++;
    if (presence > activeThreshold) activeBands++;
    if (brilliance > activeThreshold) activeBands++;
    if (air > activeThreshold) activeBands++;
    const density = activeBands / 8;

    const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0;

    // The original's smoothing constants
    const dt = energySum > 0 ? 0.15 : 0.08;

    this.smoothedData.bass += (oldBass - this.smoothedData.bass) * dt;
    this.smoothedData.mid += (oldMid - this.smoothedData.mid) * dt;
    this.smoothedData.treble += (oldTreble - this.smoothedData.treble) * dt;
    this.smoothedData.energy += (energy - this.smoothedData.energy) * dt;

    this.smoothedData.subBass += (subBass - this.smoothedData.subBass) * dt;
    this.smoothedData.lowMid += (lowMid - this.smoothedData.lowMid) * dt;
    this.smoothedData.highMid += (highMid - this.smoothedData.highMid) * dt;
    this.smoothedData.presence += (presence - this.smoothedData.presence) * dt;
    this.smoothedData.brilliance += (brilliance - this.smoothedData.brilliance) * dt;
    this.smoothedData.air += (air - this.smoothedData.air) * dt;

    this.smoothedData.warmth += (warmth - this.smoothedData.warmth) * dt;
    this.smoothedData.brightness += (brightness - this.smoothedData.brightness) * dt;
    this.smoothedData.sharpness += (sharpness - this.smoothedData.sharpness) * dt;
    this.smoothedData.smoothness += (smoothnessVal - this.smoothedData.smoothness) * dt;
    this.smoothedData.density += (density - this.smoothedData.density) * dt;
    this.smoothedData.spectralCentroid += (spectralCentroid - this.smoothedData.spectralCentroid) * dt;

    return { ...this.smoothedData };
  }

  // Calculate idle wave intensity
  public getIdleWaveIntensity(deltaTime: number = 0.016): number {
    const now = performance.now();
    let targetIntensity: number;

    if (this.audioReceived) {
      const hasEnergy = this.lastActiveTime > this.lastIdleTime;

      if (hasEnergy) {
        // Energy → stop the idle wave now, reset the idle timer
        targetIntensity = 0;
        this.idleStartTime = 0;
      } else {
        // No energy → idle only after the debounce has fully elapsed
        if (this.idleStartTime === 0) {
          this.idleStartTime = now;
        }
        const idleElapsed = (now - this.idleStartTime) / 1000;
        targetIntensity = idleElapsed >= this.debounceDuration ? 1 : 0;
      }
    } else {
      targetIntensity = this.isPlaying ? 0 : 1;
    }

    // Smooth transition
    const fadeSpeed = 1.0 / this.idleFadeOutDuration;
    const delta = fadeSpeed * deltaTime;

    if (targetIntensity > this.currentIdleIntensity) {
      this.currentIdleIntensity = Math.min(targetIntensity, this.currentIdleIntensity + delta);
    } else if (targetIntensity < this.currentIdleIntensity) {
      this.currentIdleIntensity = Math.max(targetIntensity, this.currentIdleIntensity - delta);
    }

    return this.currentIdleIntensity;
  }

  // Set debounce time
  public setIdleWaveDebounce(seconds: number) {
    this.debounceDuration = seconds;
  }

  // Set idle fade duration
  public setIdleFadeOutDuration(seconds: number) {
    this.idleFadeOutDuration = seconds;
  }
}
