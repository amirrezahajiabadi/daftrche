/* ═══ Audio Engine: Procedural Music + Multi-Channel Ambient Mixer + User Tracks ═══ */
import { safeSet, readString, readJSON } from './store.js';

const readVolume = key => {
  const v = parseFloat(readString(key, '0.8'));
  return Number.isFinite(v) ? v : 0.8;
};

let ctx = null, musicGain = null, ambGain = null;

function ensureCtx() {
  if (typeof window === 'undefined') throw new Error('AudioContext unavailable');
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('AudioContext unsupported');
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = readVolume('daftarche-vol-music');
    musicGain.connect(ctx.destination);
  }
  if (!ambGain) {
    ambGain = ctx.createGain();
    ambGain.gain.value = readVolume('daftarche-vol-amb');
    ambGain.connect(ctx.destination);
  }
  return ctx;
}

export function unlockAudio() { try { ensureCtx(); } catch { /* ignore */ } }

/* ── Master Volume ── */
const VOL_SAVE_MS = 250;
let volMusicTimer = 0, volAmbTimer = 0, mixerSaveTimer = 0;

export function setMusicVolume(v) {
  if (musicGain) musicGain.gain.value = v;
  if (userAudio) userAudio.volume = v * .95;
  clearTimeout(volMusicTimer);
  volMusicTimer = setTimeout(() => { volMusicTimer = 0; safeSet('daftarche-vol-music', v); }, VOL_SAVE_MS);
}
export function setAmbVolume(v) {
  if (ambGain) ambGain.gain.value = v;
  clearTimeout(volAmbTimer);
  volAmbTimer = setTimeout(() => { volAmbTimer = 0; safeSet('daftarche-vol-amb', v); }, VOL_SAVE_MS);
}
export function getVolumes() {
  return {
    m: readVolume('daftarche-vol-music'),
    a: readVolume('daftarche-vol-amb'),
  };
}

/* ── Noise buffers ── */
let whiteBuf = null, brownBuf = null, dropBuf = null;
function getWhite(c) {
  if (!whiteBuf) {
    const len = c.sampleRate * 2; whiteBuf = c.createBuffer(1, len, c.sampleRate);
    const d = whiteBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return whiteBuf;
}
function getBrown(c) {
  if (!brownBuf) {
    const len = c.sampleRate * 2; brownBuf = c.createBuffer(1, len, c.sampleRate);
    const d = brownBuf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
  }
  return brownBuf;
}
function getDrop(c) {
  if (!dropBuf) {
    const len = (c.sampleRate * .08) | 0; dropBuf = c.createBuffer(1, len, c.sampleRate);
    const d = dropBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  return dropBuf;
}

/* ═══ Procedural Music ═══ */
export const MUSIC_TRACKS = {
  night:  { label: 'آرامش شب',   root: 196.00, scale: [0, 3, 5, 7, 10], bpm: 7,  wave: 'sine' },
  spring: { label: 'صبح بهاری',  root: 261.63, scale: [0, 2, 4, 7, 9],  bpm: 11, wave: 'triangle' },
  deep:   { label: 'تمرکز عمیق', root: 146.83, scale: [0, 5, 7, 12],    bpm: 5,  wave: 'sine' },
};
export const TRACK_KEYS = Object.keys(MUSIC_TRACKS);

function startProc(key) {
  const c = ensureCtx(), cfg = MUSIC_TRACKS[key];
  const out = c.createGain(); out.gain.value = 0; out.connect(musicGain);
  out.gain.linearRampToValueAtTime(.8, c.currentTime + 2);
  const nodes = [out];
  [0, 7].forEach(semi => {
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.value = (cfg.root / 2) * Math.pow(2, semi / 12);
    const g = c.createGain(); g.gain.value = .045;
    o.connect(g); g.connect(out); o.start(); nodes.push(o);
  });
  let next = c.currentTime + .3;
  const step = () => {
    while (next < c.currentTime + 1.2) {
      if (Math.random() < .85) {
        const deg = cfg.scale[(Math.random() * cfg.scale.length) | 0];
        const oct = Math.random() < .25 ? 2 : 1;
        const f = cfg.root * oct * Math.pow(2, deg / 12);
        const o = c.createOscillator(); o.type = cfg.wave; o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0, next);
        g.gain.linearRampToValueAtTime(.14, next + .04);
        g.gain.exponentialRampToValueAtTime(.0001, next + 2.4);
        o.connect(g); g.connect(out);
        o.start(next); o.stop(next + 2.6);
      }
      next += (60 / cfg.bpm) * (Math.random() < .3 ? 1.5 : 1);
    }
  };
  step();
  const iv = setInterval(step, 400);
  return {
    stop() {
      clearInterval(iv);
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, .5);
      setTimeout(() => { nodes.forEach(n => { try { n.stop(); } catch {} }); try { out.disconnect(); } catch {} }, 1500);
    }
  };
}

/* ═══ Multi-Channel Ambient Sound Mixer ═══ */
export const AMBIENT_CHANNELS = Object.freeze({
  rain: 'باران',
  fireplace: 'شومینه',
  cafe: 'کافه',
  sea: 'دریا',
  forest: 'جنگل',
});
export const AMBIENT_CHANNEL_KEYS = Object.freeze(Object.keys(AMBIENT_CHANNELS));
export const MIXER_STORAGE_KEY = 'daftarche-amb-mixer';

function clampVol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}

function loadMixerState() {
  const saved = readJSON(MIXER_STORAGE_KEY, null);
  const legacyScene = readString('daftarche-scene', 'none');
  const out = {};

  for (const key of AMBIENT_CHANNEL_KEYS) {
    const entry = saved && typeof saved === 'object' ? saved[key] : null;
    if (entry && typeof entry === 'object') {
      out[key] = {
        vol: clampVol(entry.vol),
        muted: typeof entry.muted === 'boolean' ? entry.muted : true,
      };
    } else {
      const legacyMatch = !saved && legacyScene === key;
      out[key] = {
        vol: legacyMatch ? 0.8 : 0.7,
        muted: !legacyMatch,
      };
    }
  }
  return out;
}

let mixerState = loadMixerState();
let mixerEnabled = readString('daftarche-ambsound', '1') !== '0';
const channelHandles = new Map();

function saveMixerState() {
  clearTimeout(mixerSaveTimer);
  mixerSaveTimer = setTimeout(() => {
    mixerSaveTimer = 0;
    safeSet(MIXER_STORAGE_KEY, JSON.stringify(mixerState));
  }, VOL_SAVE_MS);
}

function startAmbChannel(scene, initialVol) {
  const c = ensureCtx();
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(ambGain);
  out.gain.linearRampToValueAtTime(clampVol(initialVol), c.currentTime + 0.8);
  const stops = [];

  if (scene === 'rain') {
    const src = c.createBufferSource(); src.buffer = getWhite(c); src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const g = c.createGain(); g.gain.value = .16;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out); src.start();
    stops.push(src);
    const iv = setInterval(() => {
      if (Math.random() < .8) {
        const t = c.currentTime + Math.random() * .15;
        const s = c.createBufferSource(); s.buffer = getDrop(c);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 3200; bp.Q.value = 6;
        const gg = c.createGain();
        gg.gain.setValueAtTime(.09, t); gg.gain.exponentialRampToValueAtTime(.0001, t + .09);
        s.connect(bp); bp.connect(gg); gg.connect(out); s.start(t);
      }
    }, 140);
    stops.push({ stop: () => clearInterval(iv) });
  } else if (scene === 'fireplace') {
    const src = c.createBufferSource(); src.buffer = getBrown(c); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340;
    const g = c.createGain(); g.gain.value = .28;
    src.connect(lp); lp.connect(g); g.connect(out); src.start();
    stops.push(src);
    const iv = setInterval(() => {
      if (Math.random() < .55) {
        const t = c.currentTime + Math.random() * .12;
        const s = c.createBufferSource(); s.buffer = getDrop(c);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 2400; bp.Q.value = 4.5;
        const gg = c.createGain();
        gg.gain.setValueAtTime(.08, t); gg.gain.exponentialRampToValueAtTime(.0001, t + .07);
        s.connect(bp); bp.connect(gg); gg.connect(out); s.start(t);
      }
    }, 190);
    stops.push({ stop: () => clearInterval(iv) });
  } else if (scene === 'cafe') {
    const src = c.createBufferSource(); src.buffer = getBrown(c); src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.9;
    const g = c.createGain(); g.gain.value = .24;
    const lfo = c.createOscillator(); lfo.frequency.value = .14;
    const lg = c.createGain(); lg.gain.value = .05;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(); lfo.start();
    stops.push(src, lfo);
  } else if (scene === 'sea') {
    const src = c.createBufferSource(); src.buffer = getBrown(c); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480;
    const g = c.createGain(); g.gain.value = .22;
    const lfo = c.createOscillator(); lfo.frequency.value = .09;
    const lg = c.createGain(); lg.gain.value = .14;
    lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = .023;
    const lg2 = c.createGain(); lg2.gain.value = 120;
    lfo2.connect(lg2); lg2.connect(lp.frequency);
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start(); lfo.start(); lfo2.start();
    stops.push(src, lfo, lfo2);
  } else if (scene === 'forest') {
    const src = c.createBufferSource(); src.buffer = getWhite(c); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = c.createGain(); g.gain.value = .05;
    src.connect(lp); lp.connect(g); g.connect(out); src.start();
    stops.push(src);
    const iv = setInterval(() => {
      if (Math.random() < .5) {
        const base = 1900 + Math.random() * 900;
        const n = 2 + ((Math.random() * 2) | 0);
        for (let i = 0; i < n; i++) {
          const t = c.currentTime + i * .18 + Math.random() * .05;
          const o = c.createOscillator(); o.type = 'sine';
          o.frequency.setValueAtTime(base, t);
          o.frequency.exponentialRampToValueAtTime(base * 1.4, t + .09);
          o.frequency.exponentialRampToValueAtTime(base * .9, t + .16);
          const gg = c.createGain();
          gg.gain.setValueAtTime(0, t);
          gg.gain.linearRampToValueAtTime(.05, t + .02);
          gg.gain.exponentialRampToValueAtTime(.0001, t + .18);
          o.connect(gg); gg.connect(out); o.start(t); o.stop(t + .2);
        }
      }
    }, 2200);
    stops.push({ stop: () => clearInterval(iv) });
  }

  return {
    setVol(v) {
      try {
        out.gain.setTargetAtTime(clampVol(v), c.currentTime, 0.05);
      } catch { /* ignore */ }
    },
    stop() {
      try {
        const t = c.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0, t, .35);
      } catch { /* ignore */ }
      setTimeout(() => {
        stops.forEach(s => { try { s.stop(); } catch {} });
        try { out.disconnect(); } catch {}
      }, 1000);
    },
  };
}

function syncAudioMixer() {
  for (const key of AMBIENT_CHANNEL_KEYS) {
    const ch = mixerState[key];
    const shouldPlay = mixerEnabled && ch && !ch.muted && ch.vol > 0;
    const handle = channelHandles.get(key);
    if (shouldPlay) {
      if (handle) {
        handle.setVol(ch.vol);
      } else {
        try {
          channelHandles.set(key, startAmbChannel(key, ch.vol));
        } catch {
          // Web Audio unavailable — fail silently
        }
      }
    } else if (handle) {
      handle.stop();
      channelHandles.delete(key);
    }
  }
}

export function getMixerState() {
  const copy = {};
  for (const key of AMBIENT_CHANNEL_KEYS) {
    const cur = mixerState[key] || { vol: 0.7, muted: true };
    copy[key] = { vol: clampVol(cur.vol), muted: Boolean(cur.muted) };
  }
  return copy;
}

export function setChannelVolume(channel, vol) {
  if (!AMBIENT_CHANNELS[channel]) return getMixerState();
  const clamped = clampVol(vol);
  mixerState[channel] = {
    vol: clamped,
    muted: clamped === 0 ? true : Boolean(mixerState[channel]?.muted),
  };
  saveMixerState();
  syncAudioMixer();
  return getMixerState();
}

export function toggleChannelMute(channel, forceMuted) {
  if (!AMBIENT_CHANNELS[channel]) return getMixerState();
  const cur = mixerState[channel] || { vol: 0.7, muted: true };
  const nextMuted = typeof forceMuted === 'boolean' ? forceMuted : !cur.muted;
  const nextVol = !nextMuted && cur.vol === 0 ? 0.5 : cur.vol;
  mixerState[channel] = { vol: nextVol, muted: nextMuted };
  saveMixerState();
  syncAudioMixer();
  return getMixerState();
}

export function setMixerEnabled(soundOn) {
  mixerEnabled = Boolean(soundOn);
  syncAudioMixer();
}

/* ═══ Playback Control ═══ */
let procHandle = null, userAudio = null, userUrl = null;

function stopProc() { if (procHandle) { procHandle.stop(); procHandle = null; } }
function stopUser() {
  if (userAudio) { userAudio.pause(); userAudio = null; }
  if (userUrl) { URL.revokeObjectURL(userUrl); userUrl = null; }
}

export function setMusic(key) {
  stopProc(); stopUser();
  if (key !== 'none') {
    try { procHandle = startProc(key); } catch { /* ignore */ }
  }
}
export function playUserTrack(track) {
  stopProc(); stopUser();
  userUrl = URL.createObjectURL(track.blob);
  userAudio = new Audio(userUrl);
  userAudio.loop = true;
  userAudio.volume = getVolumes().m * .95;
  userAudio.play().catch(() => {});
}
export function stopMusicAll() { stopProc(); stopUser(); }

export function setAmbience(scene, soundOn) {
  mixerEnabled = Boolean(soundOn);
  if (scene && scene !== 'none' && AMBIENT_CHANNELS[scene]) {
    const anyUnmuted = AMBIENT_CHANNEL_KEYS.some(k => !mixerState[k]?.muted);
    if (!anyUnmuted) {
      mixerState[scene] = { vol: mixerState[scene]?.vol || 0.7, muted: false };
      saveMixerState();
    }
  }
  syncAudioMixer();
}

/* ═══ User Tracks (IndexedDB) ═══ */
const DB_NAME = 'daftarche-audio';
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tracks', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
export async function loadUserTracks() {
  try {
    const d = await db();
    return await new Promise(res => {
      const q = d.transaction('tracks').objectStore('tracks').getAll();
      q.onsuccess = () => res(q.result || []);
      q.onerror = () => res([]);
    });
  } catch { return []; }
}
export async function addUserTrack(t) {
  const d = await db();
  return new Promise(res => { const tx = d.transaction('tracks', 'readwrite'); tx.objectStore('tracks').put(t); tx.oncomplete = res; });
}
export async function removeUserTrack(id) {
  const d = await db();
  return new Promise(res => { const tx = d.transaction('tracks', 'readwrite'); tx.objectStore('tracks').delete(id); tx.oncomplete = res; });
}

export function clearUserAudioData() {
  stopProc();
  stopUser();
  for (const [, handle] of channelHandles) {
    try { handle.stop(); } catch {}
  }
  channelHandles.clear();
  clearTimeout(volMusicTimer); volMusicTimer = 0;
  clearTimeout(volAmbTimer); volAmbTimer = 0;
  clearTimeout(mixerSaveTimer); mixerSaveTimer = 0;
  if (ctx) {
    try { ctx.close(); } catch {}
    ctx = null; musicGain = null; ambGain = null;
  }
  whiteBuf = brownBuf = dropBuf = null;
  return new Promise(resolve => {
    const remove = () => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    };
    db().then(
      d => { try { d.close(); } catch {} dbP = null; remove(); },
      () => { dbP = null; remove(); }
    );
  });
}
