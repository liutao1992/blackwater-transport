const MAX_VOICES = 32;
const MASTER_LEVEL = 0.72;
const NOISE_SECONDS = 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const SHOT_PRESETS = {
  m4: {
    level: 0.8,
    reflection: 0.2,
    noiseDuration: 0.14,
    noiseFrequency: 1750,
    noisePeak: 0.34,
    impactDuration: 0.2,
    impactFrequency: 112,
    impactEndFrequency: 46,
    impactPeak: 0.34,
  },
  ak: {
    level: 0.84,
    reflection: 0.24,
    noiseDuration: 0.17,
    noiseFrequency: 1320,
    noisePeak: 0.4,
    impactDuration: 0.24,
    impactFrequency: 94,
    impactEndFrequency: 40,
    impactPeak: 0.42,
  },
  deagle: {
    level: 0.9,
    reflection: 0.3,
    noiseDuration: 0.23,
    noiseFrequency: 980,
    noisePeak: 0.48,
    impactDuration: 0.31,
    impactFrequency: 78,
    impactEndFrequency: 32,
    impactPeak: 0.5,
  },
  bot: {
    level: 0.62,
    reflection: 0.13,
    noiseDuration: 0.12,
    noiseFrequency: 2250,
    noisePeak: 0.22,
    impactDuration: 0.15,
    impactFrequency: 165,
    impactEndFrequency: 68,
    impactPeak: 0.24,
  },
};

function scheduleEnvelope(param, when, duration, peak, attack = 0.003, release = 0.04) {
  const end = when + duration;
  const attackTime = Math.min(Math.max(0.0005, attack), duration * 0.35);
  const releaseTime = Math.min(Math.max(0.001, release), duration * 0.6);
  const releaseStart = Math.max(when + attackTime, end - releaseTime);

  param.cancelScheduledValues(when);
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(peak, when + attackTime);
  param.setValueAtTime(peak, releaseStart);
  param.linearRampToValueAtTime(0, end);
}

function closeQuietly(context) {
  if (!context || typeof context.close !== 'function') return;
  try {
    const result = context.close();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Closing an already closed context is harmless during cleanup.
  }
}

/**
 * Procedural Web Audio sound system. It deliberately has no Three.js dependency:
 * positions only need x/y/z properties, and yaw is a Three.js-style Y rotation
 * in radians (zero looks down -Z).
 */
export class AudioSystem {
  constructor() {
    // The constructor only records state. AudioContext is created by resume(),
    // normally in response to a user gesture.
    this._context = null;
    this._master = null;
    this._limiter = null;
    this._deckInput = null;
    this._graphNodes = [];
    this._noiseBuffer = null;

    this._voices = new Set();
    this._ambience = null;
    this._ambienceActive = true;
    this._volume = 0.75;
    this._listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this._resumePromise = null;
    this._disposed = false;
  }

  /** Create/resume audio and, when enabled, start the quiet ambient bed. */
  async resume() {
    if (this._disposed) return false;
    if (this._resumePromise) return this._resumePromise;

    const operation = (async () => {
      try {
        if (!this._context) {
          const root = typeof globalThis !== 'undefined' ? globalThis : {};
          const Context = root.AudioContext || root.webkitAudioContext;
          if (typeof Context !== 'function') return false;

          let context;
          try {
            context = new Context();
          } catch {
            return false;
          }

          this._context = context;
          try {
            this._buildGraph();
          } catch {
            this._clearGraph();
            this._context = null;
            closeQuietly(context);
            return false;
          }
        }

        const context = this._context;
        if (context.state === 'closed') return false;
        if (context.state !== 'running' && typeof context.resume === 'function') {
          await context.resume();
        }
        if (this._disposed || context.state === 'closed') return false;

        if (this._ambienceActive) this._startAmbience();
        return true;
      } catch {
        // Autoplay policy and device errors must not break the game loop.
        return false;
      }
    })();

    this._resumePromise = operation;
    try {
      return await operation;
    } finally {
      if (this._resumePromise === operation) this._resumePromise = null;
    }
  }

  setVolume(value) {
    let numeric;
    try {
      numeric = Number(value);
    } catch {
      return;
    }
    if (!Number.isFinite(numeric)) return;

    this._volume = clamp(numeric, 0, 1);
    if (!this._master || !this._context || this._context.state === 'closed') return;

    const now = this._context.currentTime;
    const gain = this._master.gain;
    try {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(this._volume * MASTER_LEVEL, now + 0.015);
    } catch {
      // A context can close between the state check and this scheduling call.
    }
  }

  updateListener(position, yaw) {
    if (
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Number.isFinite(position.z)
    ) {
      this._listener.x = position.x;
      this._listener.y = position.y;
      this._listener.z = position.z;
    }
    if (Number.isFinite(yaw)) this._listener.yaw = yaw;
  }

  shot(kind = 'm4', position = null, local = false) {
    const name = typeof kind === 'string' ? kind.toLowerCase() : 'm4';
    const preset = SHOT_PRESETS[name] || SHOT_PRESETS.m4;

    return this._play(
      {
        position,
        local,
        level: preset.level,
        reflection: preset.reflection,
      },
      (voice, now) => {
        this._noiseBurst(voice, now, preset.noiseDuration, {
          filterType: 'bandpass',
          frequency: preset.noiseFrequency,
          q: 0.65,
          peak: preset.noisePeak,
          attack: 0.001,
          release: 0.055,
        });
        this._tone(voice, now, preset.impactDuration, {
          type: 'sine',
          frequency: preset.impactFrequency,
          endFrequency: preset.impactEndFrequency,
          peak: preset.impactPeak,
          attack: 0.001,
          release: 0.1,
        });
      },
    );
  }

  hit(headshot = false) {
    return this._play({ level: headshot ? 0.72 : 0.58 }, (voice, now) => {
      if (headshot) {
        this._tone(voice, now, 0.12, {
          type: 'sine',
          frequency: 1320,
          endFrequency: 1980,
          peak: 0.22,
          release: 0.045,
        });
        this._tone(voice, now + 0.055, 0.1, {
          type: 'sine',
          frequency: 1980,
          endFrequency: 2640,
          peak: 0.15,
          release: 0.04,
        });
        this._noiseBurst(voice, now, 0.035, {
          filterType: 'highpass',
          frequency: 3600,
          peak: 0.08,
          release: 0.02,
        });
      } else {
        this._tone(voice, now, 0.105, {
          type: 'triangle',
          frequency: 650,
          endFrequency: 420,
          peak: 0.2,
          release: 0.04,
        });
        this._noiseBurst(voice, now, 0.04, {
          filterType: 'bandpass',
          frequency: 1800,
          q: 0.8,
          peak: 0.08,
          release: 0.025,
        });
      }
    });
  }

  kill() {
    return this._play({ level: 0.68 }, (voice, now) => {
      this._tone(voice, now, 0.21, {
        type: 'sine',
        frequency: 220,
        endFrequency: 105,
        peak: 0.2,
        release: 0.1,
      });
      this._tone(voice, now + 0.035, 0.17, {
        type: 'triangle',
        frequency: 660,
        endFrequency: 990,
        peak: 0.16,
        release: 0.07,
      });
      this._noiseBurst(voice, now, 0.055, {
        filterType: 'bandpass',
        frequency: 950,
        peak: 0.08,
        release: 0.03,
      });
    });
  }

  reload(stage = 'start') {
    const name = typeof stage === 'string' ? stage.toLowerCase() : 'start';
    const selected = name === 'mag' || name === 'end' ? name : 'start';

    return this._play({ level: 0.62 }, (voice, now) => {
      if (selected === 'mag') {
        this._noiseBurst(voice, now, 0.12, {
          filterType: 'lowpass',
          frequency: 480,
          peak: 0.24,
          release: 0.06,
        });
        this._tone(voice, now, 0.14, {
          type: 'sine',
          frequency: 96,
          endFrequency: 54,
          peak: 0.18,
          release: 0.07,
        });
        this._noiseBurst(voice, now + 0.09, 0.045, {
          filterType: 'highpass',
          frequency: 1450,
          peak: 0.12,
          release: 0.025,
        });
      } else if (selected === 'end') {
        this._noiseBurst(voice, now, 0.065, {
          filterType: 'highpass',
          frequency: 1850,
          peak: 0.18,
          release: 0.035,
        });
        this._tone(voice, now + 0.01, 0.12, {
          type: 'triangle',
          frequency: 380,
          endFrequency: 720,
          peak: 0.15,
          release: 0.055,
        });
      } else {
        this._noiseBurst(voice, now, 0.075, {
          filterType: 'bandpass',
          frequency: 950,
          q: 0.9,
          peak: 0.2,
          release: 0.04,
        });
        this._tone(voice, now, 0.09, {
          type: 'triangle',
          frequency: 175,
          endFrequency: 108,
          peak: 0.12,
          release: 0.04,
        });
      }
    });
  }

  footstep(sprinting = false) {
    const running = Boolean(sprinting);
    return this._play({ level: running ? 0.5 : 0.38 }, (voice, now) => {
      this._noiseBurst(voice, now, running ? 0.12 : 0.1, {
        filterType: 'lowpass',
        frequency: running ? 330 : 260,
        q: 0.45,
        peak: running ? 0.26 : 0.2,
        attack: 0.001,
        release: 0.055,
        playbackRate: running ? 1.12 : 0.94,
      });
      this._tone(voice, now, 0.12, {
        type: 'sine',
        frequency: running ? 94 : 76,
        endFrequency: 42,
        peak: running ? 0.14 : 0.11,
        attack: 0.001,
        release: 0.065,
      });
    });
  }

  damage() {
    return this._play({ level: 0.64 }, (voice, now) => {
      this._noiseBurst(voice, now, 0.19, {
        filterType: 'bandpass',
        frequency: 330,
        q: 0.55,
        peak: 0.26,
        attack: 0.001,
        release: 0.1,
      });
      this._tone(voice, now, 0.28, {
        type: 'triangle',
        frequency: 138,
        endFrequency: 48,
        peak: 0.3,
        attack: 0.001,
        release: 0.15,
      });
    });
  }

  ui() {
    return this._play({ level: 0.48 }, (voice, now) => {
      this._tone(voice, now, 0.075, {
        type: 'sine',
        frequency: 660,
        endFrequency: 990,
        peak: 0.16,
        attack: 0.002,
        release: 0.035,
      });
      this._tone(voice, now + 0.035, 0.05, {
        type: 'sine',
        frequency: 1320,
        peak: 0.06,
        attack: 0.002,
        release: 0.025,
      });
    });
  }

  setAmbience(active) {
    this._ambienceActive = Boolean(active);
    if (this._ambienceActive) {
      if (this._canPlay()) this._startAmbience();
    } else {
      this._stopAmbience();
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    this._stopAmbience();
    for (const voice of Array.from(this._voices)) {
      this._releaseVoice(voice, true);
    }

    const context = this._context;
    this._context = null;
    this._clearGraph();
    this._noiseBuffer = null;
    closeQuietly(context);
  }

  _canPlay() {
    return Boolean(
      !this._disposed &&
        this._context &&
        this._master &&
        this._context.state !== 'closed',
    );
  }

  _buildGraph() {
    const context = this._context;

    this._master = this._trackGraph(context.createGain());
    this._master.gain.value = this._volume * MASTER_LEVEL;

    if (typeof context.createDynamicsCompressor === 'function') {
      this._limiter = this._trackGraph(context.createDynamicsCompressor());
      this._limiter.threshold.value = -18;
      this._limiter.knee.value = 10;
      this._limiter.ratio.value = 12;
      this._limiter.attack.value = 0.003;
      this._limiter.release.value = 0.18;
      this._master.connect(this._limiter);
      this._limiter.connect(context.destination);
    } else {
      this._master.connect(context.destination);
    }

    // One shared buffer is used by every noise burst and by the wind loop.
    this._noiseBuffer = this._createNoiseBuffer();

    // Fixed, non-feedback multi-tap delays suggest reflections from a steel deck.
    this._deckInput = this._trackGraph(context.createGain());
    this._deckInput.gain.value = 0.6;
    const taps = [
      { time: 0.055, gain: 0.16, cutoff: 2300 },
      { time: 0.115, gain: 0.085, cutoff: 1700 },
      { time: 0.19, gain: 0.04, cutoff: 1150 },
    ];
    for (const tap of taps) {
      const delay = this._trackGraph(context.createDelay(0.5));
      const filter = this._trackGraph(context.createBiquadFilter());
      const gain = this._trackGraph(context.createGain());
      delay.delayTime.value = tap.time;
      filter.type = 'lowpass';
      filter.frequency.value = tap.cutoff;
      filter.Q.value = 0.35;
      gain.gain.value = tap.gain;
      this._deckInput.connect(delay);
      delay.connect(filter);
      filter.connect(gain);
      gain.connect(this._master);
    }
  }

  _createNoiseBuffer() {
    const context = this._context;
    const sampleRate = context.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * NOISE_SECONDS));
    const buffer = context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;

    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.08 + white * 0.92;
      data[i] = previous;
    }
    return buffer;
  }

  _startAmbience() {
    if (this._ambience || !this._ambienceActive || !this._canPlay() || !this._noiseBuffer) {
      return;
    }

    const context = this._context;
    const nodes = [];
    const sources = [];
    try {
      const bus = context.createGain();
      nodes.push(bus);
      bus.gain.value = 0;
      bus.connect(this._master);

      const wind = context.createBufferSource();
      nodes.push(wind);
      sources.push(wind);
      wind.buffer = this._noiseBuffer;
      wind.loop = true;

      const windFilter = context.createBiquadFilter();
      nodes.push(windFilter);
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 760;
      windFilter.Q.value = 0.3;

      const windGain = context.createGain();
      nodes.push(windGain);
      windGain.gain.value = 0.032;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(bus);

      const hull = context.createOscillator();
      nodes.push(hull);
      sources.push(hull);
      hull.type = 'sine';
      hull.frequency.value = 56;
      const hullGain = context.createGain();
      nodes.push(hullGain);
      hullGain.gain.value = 0.009;
      hull.connect(hullGain);
      hullGain.connect(bus);

      // An LFO gives the wind a slow movement without JavaScript timers.
      const lfo = context.createOscillator();
      nodes.push(lfo);
      sources.push(lfo);
      lfo.type = 'sine';
      lfo.frequency.value = 0.12;
      const lfoGain = context.createGain();
      nodes.push(lfoGain);
      lfoGain.gain.value = 170;
      lfo.connect(lfoGain);
      lfoGain.connect(windFilter.frequency);

      this._ambience = { nodes, sources, bus };
      const now = context.currentTime;
      wind.start(now);
      hull.start(now);
      lfo.start(now);
      bus.gain.setValueAtTime(0, now);
      bus.gain.linearRampToValueAtTime(1, now + 0.8);
    } catch {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // It may not have reached start() yet.
        }
      }
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Ignore partial graph cleanup errors.
        }
      }
      this._ambience = null;
    }
  }

  _stopAmbience() {
    const ambience = this._ambience;
    this._ambience = null;
    if (!ambience) return;

    const now = this._context ? this._context.currentTime : 0;
    try {
      ambience.bus.gain.cancelScheduledValues(now);
      ambience.bus.gain.setValueAtTime(0, now);
    } catch {
      // The context may already be closed.
    }
    for (const source of ambience.sources) {
      try {
        source.stop();
      } catch {
        // stop() is intentionally idempotent during teardown.
      }
    }
    for (const node of ambience.nodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore already disconnected nodes.
      }
    }
  }

  _play(options, build) {
    const voice = this._createVoice(options);
    if (!voice) return false;

    try {
      build(voice, this._context.currentTime + 0.001);
      voice.building = false;
      if (voice.pending === 0) {
        this._releaseVoice(voice, true);
        return false;
      }
      return true;
    } catch {
      voice.building = false;
      this._releaseVoice(voice, true);
      return false;
    }
  }

  _createVoice({ position = null, local = false, level = 1, reflection = 0 } = {}) {
    if (!this._canPlay()) return null;

    while (this._voices.size >= MAX_VOICES) {
      const oldest = this._voices.values().next().value;
      if (!oldest) break;
      this._releaseVoice(oldest, true);
    }

    const voice = {
      nodes: [],
      sources: [],
      pending: 0,
      building: true,
      released: false,
      output: null,
    };
    this._voices.add(voice);

    try {
      const context = this._context;
      const spatial = this._spatial(position, local);
      const output = this._trackVoice(voice, context.createGain());
      output.gain.value = clamp(level * spatial.gain, 0, 1);
      voice.output = output;

      let panner;
      if (typeof context.createStereoPanner === 'function') {
        panner = this._trackVoice(voice, context.createStereoPanner());
        panner.pan.value = spatial.pan;
      } else {
        // Very old implementations can still play centered audio.
        panner = this._trackVoice(voice, context.createGain());
      }
      output.connect(panner);
      panner.connect(this._master);

      if (reflection > 0 && this._deckInput) {
        const send = this._trackVoice(voice, context.createGain());
        send.gain.value = clamp(reflection, 0, 0.5);
        panner.connect(send);
        send.connect(this._deckInput);
      }
      return voice;
    } catch {
      this._releaseVoice(voice, true);
      return null;
    }
  }

  _spatial(position, local) {
    if (
      local ||
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      return { gain: 1, pan: 0 };
    }

    const dx = position.x - this._listener.x;
    const dy = position.y - this._listener.y;
    const dz = position.z - this._listener.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = 1 / (1 + distance / 14);
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    if (horizontalDistance < 0.0001) return { gain, pan: 0 };

    // Three.js Y rotation: right = (cos(yaw), 0, -sin(yaw)).
    const right = dx * Math.cos(this._listener.yaw) - dz * Math.sin(this._listener.yaw);
    return { gain, pan: clamp(right / horizontalDistance, -1, 1) };
  }

  _noiseBurst(voice, when, duration, options) {
    if (!this._noiseBuffer) return;

    const context = this._context;
    const source = this._registerSource(voice, context.createBufferSource());
    source.buffer = this._noiseBuffer;
    source.playbackRate.value = options.playbackRate || 1;

    const filter = this._trackVoice(voice, context.createBiquadFilter());
    filter.type = options.filterType || 'bandpass';
    filter.frequency.value = clamp(
      options.frequency || 1200,
      20,
      (context.sampleRate || 44100) * 0.45,
    );
    filter.Q.value = options.q === undefined ? 0.7 : options.q;

    const gain = this._trackVoice(voice, context.createGain());
    scheduleEnvelope(
      gain.gain,
      when,
      duration,
      options.peak,
      options.attack,
      options.release,
    );
    source.connect(filter);
    filter.connect(gain);
    gain.connect(voice.output);

    const offset = Math.random() * Math.max(0, this._noiseBuffer.duration - duration - 0.01);
    source.start(when, offset, duration);
  }

  _tone(voice, when, duration, options) {
    const context = this._context;
    const oscillator = this._registerSource(voice, context.createOscillator());
    oscillator.type = options.type || 'sine';

    const nyquistSafeFrequency = (context.sampleRate || 44100) * 0.45;
    const startFrequency = clamp(options.frequency || 440, 1, nyquistSafeFrequency);
    oscillator.frequency.setValueAtTime(startFrequency, when);
    if (Number.isFinite(options.endFrequency)) {
      oscillator.frequency.exponentialRampToValueAtTime(
        clamp(options.endFrequency, 1, nyquistSafeFrequency),
        when + duration,
      );
    }

    const gain = this._trackVoice(voice, context.createGain());
    scheduleEnvelope(
      gain.gain,
      when,
      duration,
      options.peak,
      options.attack,
      options.release,
    );
    oscillator.connect(gain);
    gain.connect(voice.output);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  _trackGraph(node) {
    this._graphNodes.push(node);
    return node;
  }

  _trackVoice(voice, node) {
    voice.nodes.push(node);
    return node;
  }

  _registerSource(voice, source) {
    voice.nodes.push(source);
    voice.sources.push(source);
    voice.pending += 1;
    source.onended = () => {
      if (voice.released) return;
      voice.pending = Math.max(0, voice.pending - 1);
      if (voice.pending === 0 && !voice.building) this._releaseVoice(voice);
    };
    return source;
  }

  _releaseVoice(voice, stop = false) {
    if (!voice || voice.released) return;
    voice.released = true;
    this._voices.delete(voice);

    for (const source of voice.sources) {
      source.onended = null;
      if (stop) {
        try {
          source.stop();
        } catch {
          // A source may already have ended or never have started.
        }
      }
    }
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore already disconnected nodes.
      }
    }
    voice.nodes.length = 0;
    voice.sources.length = 0;
  }

  _clearGraph() {
    for (const node of this._graphNodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore partial graph cleanup errors.
      }
    }
    this._graphNodes.length = 0;
    this._master = null;
    this._limiter = null;
    this._deckInput = null;
  }
}
