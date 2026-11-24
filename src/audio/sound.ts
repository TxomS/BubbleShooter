import { POP_STAGGER } from '../game/config';
import type { GameEvent } from '../game/state';

// Every sound is synthesised with the Web Audio API, so there are no audio
// files to download or license. Pops are notes on a pentatonic scale that climb
// with your combo, so a chain reaction plays a little rising melody. Music is a
// slow generative drift of bell notes over a drone, so it never loops.
//
// Two independent channels, each with its own on/off switch, volume and reverb:
// sound effects and music. Turning one off never touches the other.

const PENTATONIC = [0, 2, 4, 7, 9];

/** The four chords the music drifts through (MIDI note numbers), nine seconds each. */
const CHORDS = [
  [57, 60, 64, 67], // A minor 7
  [53, 57, 60, 64], // F major 7
  [48, 52, 55, 59], // C major 7
  [55, 59, 62, 64], // G 6
];
const CHORD_SECONDS = 9;

export interface AudioSettings {
  musicOn: boolean;
  music: number;
  sfxOn: boolean;
  sfx: number;
}

interface Channel {
  dry: GainNode;
  send: GainNode; // reverb send
  vol: GainNode;
}

interface ToneOpts {
  freq: number;
  freqTo?: number;
  type?: OscillatorType;
  start?: number; // seconds from now
  dur?: number;
  gain?: number;
  attack?: number;
  wet?: number; // reverb send, 0..1
  channel?: 'sfx' | 'music';
}

interface NoiseOpts {
  start?: number;
  dur?: number;
  gain?: number;
  type?: BiquadFilterType;
  freq?: number;
  freqTo?: number;
  q?: number;
}

/** Sliders feel natural when volume follows a curve rather than a straight line. */
const curve = (v: number) => v * v;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class Sound {
  private s: AudioSettings;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: Channel;
  private music!: Channel;
  private noiseBuf!: AudioBuffer;
  private nextNoteAt = 0;
  private musicStart = 0;
  private lastChord = -1;

  constructor(settings: AudioSettings) {
    this.s = { ...settings };
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.anyOn()) void this.ctx.resume();
    });
  }

  get settings(): Readonly<AudioSettings> {
    return this.s;
  }

  /** Is anything audible? When both channels are off the audio engine is put to sleep. */
  private anyOn(): boolean {
    return this.s.musicOn || this.s.sfxOn;
  }

  /** Browsers only allow audio after a user gesture, so call this from the first tap or key press. */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.anyOn() && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  apply(patch: Partial<AudioSettings>) {
    const wasOn = this.anyOn();
    this.s = { ...this.s, ...patch };
    const ctx = this.ctx;
    if (!ctx) return;
    this.applyGains();
    if (this.anyOn() !== wasOn) {
      if (this.anyOn()) void ctx.resume();
      else window.setTimeout(() => !this.anyOn() && void this.ctx?.suspend(), 250);
    }
  }

  /** A sample pop, played while a volume slider moves so you can hear the level. */
  preview(channel: 'sfx' | 'music') {
    if (!this.ready()) return;
    if (channel === 'sfx') {
      if (this.s.sfxOn) this.popNote(0, 2, 0);
    } else if (this.s.musicOn) {
      this.bell(midi(69), 0, 0.09, 2.5);
    }
  }

  handle(e: GameEvent) {
    if (!this.ready() || !this.s.sfxOn || this.s.sfx <= 0.001) return;
    switch (e.type) {
      case 'launch':
        this.tone({ freq: 260, freqTo: 880, type: 'sine', dur: 0.16, gain: 0.12, wet: 0.25 });
        this.noise({ dur: 0.18, gain: 0.07, type: 'bandpass', freq: 500, freqTo: 3200, q: 0.8 });
        break;
      case 'bounce':
        this.tone({ freq: 700, freqTo: 520, type: 'sine', dur: 0.07, gain: 0.1, wet: 0.3 });
        break;
      case 'land':
        this.tone({ freq: 170, freqTo: 80, type: 'sine', dur: 0.14, gain: 0.3, wet: 0.1 });
        this.noise({ dur: 0.05, gain: 0.05, type: 'lowpass', freq: 900 });
        break;
      case 'pop':
        e.orbs.forEach((_, i) => this.popNote(i, e.combo, i * POP_STAGGER));
        break;
      case 'drop': {
        const base = 0;
        const delay = 0.08;
        for (let i = 0; i < Math.min(8, e.orbs.length); i++) {
          const f = 900 - i * 45;
          this.tone({ freq: f, freqTo: f * 0.35, type: 'sine', start: base + delay + i * 0.05, dur: 0.45, gain: 0.07, wet: 0.5 });
        }
        break;
      }
      case 'rowAdded':
        this.tone({ freq: 70, freqTo: 38, type: 'sawtooth', dur: 0.5, gain: 0.16, wet: 0.2 });
        this.noise({ dur: 0.35, gain: 0.08, type: 'lowpass', freq: 400, freqTo: 120 });
        break;
      case 'rankUp':
        [0, 4, 7, 12].forEach((s, i) => this.tone({ freq: 523 * 2 ** (s / 12), type: 'triangle', start: i * 0.09, dur: 0.7, gain: 0.12, wet: 0.7 }));
        break;
      case 'won':
        [0, 4, 7, 12, 16, 19, 24].forEach((s, i) =>
          this.tone({ freq: 392 * 2 ** (s / 12), type: 'triangle', start: 0.15 + i * 0.1, dur: 0.9, gain: 0.13, wet: 0.7 }),
        );
        break;
      case 'lost':
        [0, -3, -7, -12].forEach((s, i) =>
          this.tone({ freq: 330 * 2 ** (s / 12), freqTo: 330 * 2 ** (s / 12) * 0.96, type: 'sine', start: 0.1 + i * 0.22, dur: 1.2, gain: 0.14, wet: 0.8 }),
        );
        break;
      default:
        break;
    }
  }

  /** A soft click for menu buttons. */
  click() {
    if (!this.ready() || !this.s.sfxOn) return;
    this.tone({ freq: 880, freqTo: 1320, type: 'sine', dur: 0.07, gain: 0.07, wet: 0.2 });
  }

  private ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private popNote(i: number, combo: number, start: number) {
    const idx = Math.min(14, combo * 2 + i);
    const semis = PENTATONIC[idx % 5] + 12 * Math.floor(idx / 5);
    const freq = 392 * 2 ** (semis / 12);
    this.tone({ freq, type: 'triangle', start, dur: 0.5, gain: 0.15, wet: 0.55 });
    this.tone({ freq: freq * 2, type: 'sine', start, dur: 0.3, gain: 0.05, wet: 0.7 });
    this.noise({ start, dur: 0.04, gain: 0.07, type: 'highpass', freq: 2500 });
  }

  // ---- music ----------------------------------------------------------------

  /** Called a few times a second: queues bell notes (and a pad on each chord change) slightly ahead of the clock. */
  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.s.musicOn || this.s.music <= 0.001) {
      this.nextNoteAt = Math.max(this.nextNoteAt, ctx.currentTime + 0.5);
      return;
    }
    while (this.nextNoteAt < ctx.currentTime + 1.2) {
      const at = this.nextNoteAt;
      const chordIndex = Math.floor((at - this.musicStart) / CHORD_SECONDS);
      const chord = CHORDS[chordIndex % CHORDS.length];
      const delay = Math.max(0, at - ctx.currentTime);

      if (chordIndex !== this.lastChord) {
        this.lastChord = chordIndex;
        for (const n of [chord[0] - 12, chord[1], chord[2]]) {
          this.tone({ freq: midi(n), type: 'sine', start: delay, dur: CHORD_SECONDS + 1.5, gain: 0.05, attack: 2.4, wet: 0.6, channel: 'music' });
        }
      }
      if (Math.random() < 0.78) {
        const note = chord[Math.floor(Math.random() * chord.length)] + (Math.random() < 0.45 ? 12 : 0);
        this.bell(midi(note), delay, 0.07, 3.6);
      }
      this.nextNoteAt += 0.8 + Math.random() * 1.5;
    }
  }

  private bell(freq: number, start: number, gain: number, dur: number) {
    this.tone({ freq, type: 'sine', start, dur, gain, attack: 0.012, wet: 0.9, channel: 'music' });
    this.tone({ freq: freq * 2.005, type: 'sine', start, dur: dur * 0.45, gain: gain * 0.35, attack: 0.008, wet: 0.9, channel: 'music' });
  }

  // ---- synthesis helpers ----------------------------------------------------

  private tone(o: ToneOpts) {
    const ctx = this.ctx!;
    const ch = o.channel === 'music' ? this.music : this.sfx;
    const t0 = ctx.currentTime + (o.start ?? 0);
    const dur = o.dur ?? 0.3;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur);

    const g = ctx.createGain();
    const attack = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(ch.dry);
    if (o.wet) {
      const s = ctx.createGain();
      s.gain.value = o.wet;
      g.connect(s);
      s.connect(ch.send);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(o: NoiseOpts) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.start ?? 0);
    const dur = o.dur ?? 0.1;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx.dry);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  private applyGains() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = this.s;
    this.sfx.vol.gain.setTargetAtTime(s.sfxOn ? curve(s.sfx) : 0, t, 0.03);
    this.music.vol.gain.setTargetAtTime(s.musicOn ? curve(s.music) : 0, t, 0.05);
  }

  private channel(ctx: AudioContext, ir: AudioBuffer, wet: number): Channel {
    const vol = ctx.createGain();
    vol.connect(this.master);
    const dry = ctx.createGain();
    dry.connect(vol);
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    conv.connect(vol);
    const send = ctx.createGain();
    send.gain.value = wet;
    send.connect(conv);
    return { dry, send, vol };
  }

  private build(ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Cheap generated reverb: decaying stereo noise, shared by both channels.
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.sfx = this.channel(ctx, ir, 0.4);
    this.music = this.channel(ctx, ir, 0.55);

    // One second of white noise, reused by every noise burst.
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.applyGains();
    this.sfx.vol.gain.value = this.s.sfxOn ? curve(this.s.sfx) : 0; // start at the saved level instead of fading in from silence
    this.music.vol.gain.value = this.s.musicOn ? curve(this.s.music) : 0;
    this.startDrone(ctx);
    this.musicStart = ctx.currentTime;
    this.nextNoteAt = ctx.currentTime + 0.6;
    window.setInterval(() => this.scheduleMusic(), 300);
  }

  /** A low, slowly breathing drone under the music so the game never feels silent. */
  private startDrone(ctx: AudioContext) {
    const amb = ctx.createGain();
    amb.gain.value = 0.12;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(amb);
    amb.connect(this.music.dry);
    amb.connect(this.music.send);

    for (const [f, detune] of [
      [55, 0],
      [82.41, 5],
      [110, -7],
      [164.81, 9],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = f > 100 ? 0.25 : 0.6;
      o.connect(g);
      g.connect(lp);
      o.start();
    }

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 0.04;
    lfo.connect(depth);
    depth.connect(amb.gain);
    lfo.start();
  }
}
