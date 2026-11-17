/** Original procedural sound design. No external samples, microphone or network. */
export class GameAudio {
  constructor(onCaption = () => {}) {
    this.onCaption = onCaption;
    this.ctx = null;
    this.volume = 0.7;
    this.paused = false;
    this.position = { x: 0, y: 0, z: 0 };
    this.forward = { x: 0, y: 0, z: -1 };
    this.voices = new Set();
    this.loops = {};
  }

  async unlock() {
    if (!this.ctx) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return false;
      this.ctx = new Context();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.volume * 0.68;
      this.compressor = c.createDynamicsCompressor();
      this.compressor.threshold.value = -15;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.22;
      this.master.connect(this.compressor);
      this.compressor.connect(c.destination);

      // Cold concrete & flooded chamber impulse response
      this.reverb = c.createConvolver();
      const impulse = c.createBuffer(2, Math.floor(c.sampleRate * 1.35), c.sampleRate);
      let seed = 631;
      for (let ch = 0; ch < 2; ch++) {
        const a = impulse.getChannelData(ch);
        for (let i = 0; i < a.length; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const env = Math.pow(1 - i / a.length, 2.8);
          a[i] = (seed / 2147483648 - 1) * env * 0.25;
        }
      }
      this.reverb.buffer = impulse;
      this.wet = c.createGain();
      this.wet.gain.value = 0.19;
      this.reverb.connect(this.wet);
      this.wet.connect(this.master);

      this.noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
      const a = this.noise.getChannelData(0);
      let b = 0;
      for (let i = 0; i < a.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        b = (b + 0.025 * (seed / 2147483648 - 1)) / 1.025;
        a[i] = b * 4;
      }

      this._loop('air', null, 'noise', 95, 0.020);
      this._loop('surf', { x: 18, y: 0, z: 2 }, 'noise', 180, 0.014);
      this._loop('pump', { x: 7, y: 0, z: -25 }, 'sawtooth', 48, 0);
      this._loop('motor', { x: 0, y: 1, z: -45 }, 'sawtooth', 116, 0);
      this._loop('water', { x: 4, y: 0, z: -24 }, 'noise', 240, 0);
    }
    if (this.paused && this.ctx.state === 'running') await this.ctx.suspend();
    else if (!this.paused && this.ctx.state !== 'running') await this.ctx.resume();
    return true;
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume * 0.68, this.ctx.currentTime, 0.03);
  }

  setPaused(value) {
    this.paused = !!value;
    if (this.ctx) {
      if (value) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    }
  }

  listener(pos, forward = { x: 0, y: 0, z: -1 }) {
    this.position = { x: pos.x, y: pos.y, z: pos.z };
    this.forward = { x: forward.x, y: forward.y, z: forward.z };
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      for (const k of ['X', 'Y', 'Z']) {
        l['position' + k].setValueAtTime(pos[k.toLowerCase()], t);
        l['forward' + k].setValueAtTime(forward[k.toLowerCase()], t);
      }
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  _position(panner, p) {
    if (!panner || !p) return;
    if (panner.positionX) {
      panner.positionX.value = p.x;
      panner.positionY.value = p.y;
      panner.positionZ.value = p.z;
    } else panner.setPosition(p.x, p.y, p.z);
  }

  _route(pos, occluded = false, replay = false) {
    const c = this.ctx, gain = c.createGain(), filter = c.createBiquadFilter();
    filter.type = replay ? 'bandpass' : 'lowpass';
    filter.frequency.value = occluded ? 520 : replay ? 1650 : 8800;
    filter.Q.value = replay ? 0.85 : 0.3;
    gain.connect(filter);
    const nodes = [gain, filter];
    let panner = null;
    if (pos) {
      panner = c.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.85;
      panner.maxDistance = 62;
      panner.rolloffFactor = 1.12;
      this._position(panner, pos);
      filter.connect(panner);
      panner.connect(this.master);
      panner.connect(this.reverb);
      nodes.push(panner);
    } else {
      filter.connect(this.master);
    }
    return { gain, filter, panner, nodes };
  }

  _loop(id, pos, wave, freq, level) {
    const c = this.ctx, r = this._route(pos);
    const src = wave === 'noise' ? c.createBufferSource() : c.createOscillator();
    if (wave === 'noise') {
      src.buffer = this.noise;
      src.loop = true;
    } else {
      src.type = wave;
      src.frequency.value = freq;
    }
    src.connect(r.gain);
    r.gain.gain.value = level;
    r.filter.type = 'lowpass';
    r.filter.frequency.value = wave === 'noise' ? freq : 420;
    src.start();
    this.loops[id] = { ...r, src };
  }

  _tone(route, freq, duration, level, wave = 'sine', delay = 0, endFreq = freq) {
    const c = this.ctx, t = c.currentTime + delay;
    const osc = c.createOscillator(), env = c.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env);
    env.connect(route.gain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    this.voices.add(osc);
    osc.onended = () => { osc.disconnect(); env.disconnect(); this.voices.delete(osc); };
  }

  _burst(route, duration, level, freq = 1000, delay = 0, q = 0.7) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource(), env = c.createGain(), f = c.createBiquadFilter();
    src.buffer = this.noise;
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + 0.009);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f);
    f.connect(env);
    env.connect(route.gain);
    src.start(t, Math.random() * 1.5, duration);
    this.voices.add(src);
    src.onended = () => { src.disconnect(); env.disconnect(); f.disconnect(); this.voices.delete(src); };
  }

  emit(kind, pos = null, options = {}) {
    const aliases = {
      stepConcrete: 'concrete', footstep: 'concrete', stepMetal: 'metal',
      stepWater: 'splash', water: 'splash', underwater: 'threat',
      recordStart: 'record', recordEnd: 'recorded', placed: 'place'
    };
    kind = aliases[kind] || kind;
    const labels = {
      concrete: '水泥地脚步',
      metal: '钢格栅脚步',
      splash: '涉水脚步',
      knock: '清脆金属敲击',
      wheel: '铸铁手轮转动',
      detent: '止回棘爪落锁',
      latch: '金属窗扣滑开',
      pickup: '收起设备',
      paper: '取下潮位记录卷',
      breaker: '供电合闸轰鸣',
      pump: '检修泵低频震动',
      motor: '自记仪走纸电机',
      relay: '继电器吸合',
      record: '磁带录下声响',
      recorded: '磁带已保存',
      place: '放下录放机',
      countdown: '录放机倒计时咔哒',
      replay: '磁带回放声',
      threat: '水下逼近涌动',
      submerged: '深水暗流异响',
      fifth: '楼板下的第五步',
      switch: '机械拨杆',
      fail: '水花骤然扑近',
      ending: '潮水彻底退去'
    };
    const silentCaptionKinds = new Set(['blocked']);
    if (options.caption !== false && !silentCaptionKinds.has(kind)) {
      this.onCaption((options.replay ? '磁带回放 · ' : '') + (labels[kind] || kind), pos, kind);
    }
    if (!this.ctx || this.paused || this.ctx.state !== 'running') return;
    if (this.voices.size > 96) return;

    const r = this._route(pos, options.occluded, options.replay);
    const s = Math.max(0.05, Math.min(2.2, options.strength ?? 1));
    r.gain.gain.value = s * (options.replay ? 0.88 : 1);
    const tone = (f, d, v, w = 'sine', delay = 0, end = f) => this._tone(r, f, d, v, w, delay, end);
    const noise = (d, v, f, delay = 0, q = 0.7) => this._burst(r, d, v, f, delay, q);

    if (options.replay) {
      // Subtle magnetic tape hiss & capstan click signature on replayed sounds
      noise(0.26, 0.08, 3200, 0, 1.2);
    }

    switch (kind) {
      case 'concrete':
        tone(88, 0.14, 0.28, 'sine', 0, 44);
        noise(0.085, 0.36, 850);
        break;
      case 'metal':
        tone(152, 0.44, 0.18, 'triangle');
        tone(438, 0.24, 0.08, 'sine');
        tone(728, 0.18, 0.04);
        noise(0.075, 0.38, 2200);
        break;
      case 'splash':
        noise(0.36, 0.72, 980);
        noise(0.20, 0.38, 2400, 0.04);
        tone(128, 0.18, 0.14, 'sine', 0, 42);
        break;
      case 'knock':
        tone(228, 0.92, 0.32, 'triangle');
        tone(596, 0.68, 0.17);
        tone(988, 0.44, 0.09);
        noise(0.07, 0.48, 2600);
        break;
      case 'wheel':
        tone(138, 0.45, 0.22, 'sawtooth', 0, 102);
        tone(312, 0.28, 0.11, 'triangle', 0.06, 260);
        noise(0.24, 0.32, 1300, 0, 1.4);
        break;
      case 'detent':
        tone(112, 0.22, 0.36, 'triangle', 0, 58);
        tone(480, 0.09, 0.18, 'square', 0.02, 320);
        noise(0.08, 0.45, 1900);
        break;
      case 'latch':
        tone(520, 0.08, 0.16, 'triangle', 0, 340);
        noise(0.06, 0.38, 2400);
        noise(0.42, 0.28, 720, 0.09, 1.1); // window sash sliding open
        break;
      case 'pickup':
        noise(0.08, 0.32, 1500);
        tone(290, 0.11, 0.12, 'triangle', 0.02, 410);
        break;
      case 'paper':
        noise(0.28, 0.42, 3100, 0, 0.9);
        noise(0.18, 0.28, 1400, 0.14);
        tone(360, 0.12, 0.09, 'sine', 0.16, 240);
        break;
      case 'breaker':
        noise(0.09, 0.55, 1800);
        tone(95, 0.55, 0.34, 'sawtooth', 0.04, 60);
        tone(120, 0.7, 0.15, 'sine', 0.06, 120);
        break;
      case 'blocked':
        tone(160, 0.06, 0.12, 'triangle', 0, 110);
        noise(0.04, 0.16, 900);
        break;
      case 'pump':
        tone(49, 0.9, 0.25, 'sawtooth');
        noise(0.6, 0.25, 260);
        break;
      case 'motor':
        tone(116, 0.65, 0.18, 'sawtooth');
        tone(232, 0.5, 0.06);
        noise(0.18, 0.2, 1400);
        break;
      case 'threat':
        noise(0.88, 0.65, 360);
        noise(0.55, 0.32, 820, 0.11);
        tone(47, 0.8, 0.20, 'sine', 0, 34);
        break;
      case 'submerged':
        tone(56, 0.95, 0.32, 'sine', 0, 31);
        noise(0.75, 0.42, 280, 0.05);
        break;
      case 'fifth':
        tone(67, 0.45, 0.4, 'sine', 0, 39);
        tone(167, 0.5, 0.17, 'triangle');
        noise(0.16, 0.5, 350);
        break;
      case 'relay':
      case 'switch':
        noise(0.07, 0.4, 1800);
        tone(680, 0.06, 0.07, 'square');
        noise(0.05, 0.24, 1500, 0.09);
        break;
      case 'record':
        tone(740, 0.1, 0.07);
        break;
      case 'recorded':
        tone(680, 0.09, 0.08);
        tone(980, 0.14, 0.08, 'sine', 0.10);
        break;
      case 'place':
        noise(0.09, 0.32, 1200);
        tone(185, 0.16, 0.12, 'triangle', 0, 130);
        break;
      case 'countdown':
        tone(620, 0.065, 0.065, 'triangle');
        break;
      case 'replay':
        noise(0.18, 0.25, 2400);
        tone(820, 0.08, 0.04);
        break;
      case 'fail':
        noise(1.8, 1.1, 520);
        tone(41, 1.6, 0.42, 'sawtooth', 0, 26);
        break;
      case 'ending':
        noise(2.4, 0.4, 250);
        tone(196, 3, 0.06);
        tone(294, 3, 0.04);
        break;
      default:
        noise(0.12, 0.2, 700);
    }

    const sentinel = this.ctx.createOscillator();
    sentinel.frequency.value = 0;
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    sentinel.connect(silent);
    silent.connect(this.master);
    sentinel.start();
    sentinel.stop(this.ctx.currentTime + 3.6);
    sentinel.onended = () => {
      r.nodes.forEach(n => n.disconnect());
      sentinel.disconnect();
      silent.disconnect();
    };
  }

  update(dt, state = {}) {
    if (!this.ctx || this.paused) return;
    const t = this.ctx.currentTime;
    const loop = (id, pos, level, cutoff) => {
      const l = this.loops[id];
      if (!l) return;
      if (pos) this._position(l.panner, pos);
      l.gain.gain.setTargetAtTime(level, t, 0.28);
      l.filter.frequency.setTargetAtTime(cutoff, t, 0.25);
    };
    const pumpPos = state.pumpPos || { x: 7, y: 0, z: -25 };
    const occluded = Math.abs(pumpPos.y - this.position.y) > 2;
    loop('surf', { x: 16, y: 0, z: 1 }, state.windowOpen ? 0.032 : 0.012, state.windowOpen ? 460 : 190);
    loop('pump', pumpPos, state.pumpActive ? 0.12 : 0, occluded ? 145 : 880);
    loop('motor', state.motorPos, state.motorActive ? 0.075 : 0, 1200);
    loop('water', state.threatPos, state.threatActive ? 0.065 : 0, 310);
  }

  stop() {
    if (!this.ctx) return;
    for (const l of Object.values(this.loops)) {
      try { l.src.stop(); } catch {}
      l.nodes.forEach(n => n.disconnect());
    }
    for (const v of this.voices) {
      try { v.stop(); } catch {}
    }
    this.voices.clear();
    this.ctx.close().catch(() => {});
    this.ctx = null;
    this.loops = {};
  }
}
