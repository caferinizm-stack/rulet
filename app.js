// ─── Retra · Rulet ──────────────────────────────────────────────────────────
// Canlı Avrupa ruleti (0–36). Herkes aynı turu oynar; tur döngüsü, sonuç ve
// ödemeler **sunucuda** (supabase_faz75_rulet.sql). Bu dosya yalnızca durumu
// gösterir, çipleri sunucuya iletir ve çarkı sunucunun sayısına göre çevirir.
//
// Uygulama içinde `?app=1` ile açılır: oturum adresin `#` kısmından gelir,
// giriş ekranı hiç çizilmez. `?demo=1` sunucusuz deneme modudur.

const SUPABASE = {
  url: 'https://mwjyppehzqobmcrsmxlj.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13anlwcGVoenFvYm1jcnNteGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODYxOTksImV4cCI6MjEwNTc2MjE5OX0.OWXeMWkfzwftIJXGR4Pkr66mBq4IB5u6vM9T7I7Nx-0',
};
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

/** Kristal çipleri — diğer şans oyunlarıyla aynı tutarlar. */
const CHIPS = [
  { v: 10, c1: '#7f8aa3', c2: '#4b5468' },
  { v: 50, c1: '#2fbf71', c2: '#137a45' },
  { v: 100, c1: '#3d8bff', c2: '#1a4fa8' },
  { v: 500, c1: '#a45cff', c2: '#5b26a8' },
  { v: 1000, c1: '#ff8a2b', c2: '#b0500c' },
  { v: 10000, c1: '#ff3d58', c2: '#9a1029' },
  { v: 50000, c1: '#ff4fb4', c2: '#a1146a' },
  { v: 500000, c1: '#ffd34d', c2: '#b8860b' },
  { v: 1000000, c1: '#3a3350', c2: '#120f1c', ring: '#ffd34d' },
];

/** Avrupa çarkındaki sayı sırası (0'dan saat yönünde). */
const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const STEP = (Math.PI * 2) / 37;
const BET_MS = 20000;
const SPIN_MS = 9000;
const LAND_BEFORE_END = 1200; // top, dönüş bitmeden bu kadar önce cebe oturur
const RESULT_MS = 6000;
const MULT = { straight: 36, dozen: 3, column: 3, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2 };
const MAX_CHIP = 1000000;

const params = new URLSearchParams(location.search);
const APP_MODE = params.get('app') === '1';
const DEMO = params.get('demo') === '1';

// ─── Yardımcılar ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString('tr-TR');
function short(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(n % 1e3 && n < 1e4 ? 1 : 0)}K`;
  return String(n);
}
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const lerp = (a, b, t) => a + (b - a) * t;
const keyOf = (type, value = 0) => `${type}:${value}`;
const parseKey = (k) => { const [type, v] = k.split(':'); return { type, value: Number(v) || 0 }; };

function notifyApp(msg) {
  try { window.RetraGame?.postMessage(msg); } catch { /* köprü yok */ }
}

/** Bahis hangi sayıları kapsar? (masada vurgulamak için) */
function covers(type, value) {
  const all = Array.from({ length: 37 }, (_, i) => i);
  switch (type) {
    case 'straight': return [value];
    case 'red': return all.filter((n) => RED.has(n));
    case 'black': return all.filter((n) => n > 0 && !RED.has(n));
    case 'even': return all.filter((n) => n > 0 && n % 2 === 0);
    case 'odd': return all.filter((n) => n % 2 === 1);
    case 'low': return all.filter((n) => n >= 1 && n <= 18);
    case 'high': return all.filter((n) => n >= 19);
    case 'dozen': return all.filter((n) => n >= (value - 1) * 12 + 1 && n <= value * 12);
    case 'column': return all.filter((n) => n > 0 && ((n - 1) % 3) + 1 === value);
    default: return [];
  }
}
const wins = (type, value, n) => covers(type, value).includes(n);

const ERRORS = {
  PHASE_CLOSED: 'Bahisler kapandı, yeni turu bekle.',
  BALANCE: 'Kristal bakiyen yetersiz.',
  BAD_BET: 'Geçersiz bahis.',
  BAD_AMOUNT: 'Tek çip en fazla 1.000.000 kristal.',
  ROUND_LIMIT: 'Bu turda bahis sınırına ulaştın (20.000.000).',
  AUTH_REQUIRED: 'Oturum bulunamadı.',
  PROFILE_MISSING: 'Bu hesabın profili yok.',
  NO_ROUND: 'Tur hazırlanıyor…',
};
function errorText(e) {
  const t = `${e?.message ?? ''} ${e?.details ?? ''}`;
  for (const [k, v] of Object.entries(ERRORS)) if (t.includes(k)) return v;
  if (t.includes('Could not find the function')) return 'Sunucu kurulumu eksik (SQL bölüm FAZ 75).';
  if (/failed to fetch|network|timeout|load failed/i.test(t)) return 'Bağlantı yeniden kuruluyor…';
  return 'Sunucuya ulaşılamadı.';
}

// ─── Ses (dosya yok, tarayıcıda üretilir) ──────────────────────────────────
const Sound = {
  ctx: null,
  on: true,
  noiseBuf: null,
  roll: null,
  init() {
    try { this.on = localStorage.getItem('rulet_sound') !== '0'; } catch { /* yok */ }
  },
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('rulet_sound', this.on ? '1' : '0'); } catch { /* yok */ }
    if (!this.on) this.stopRoll();
    return this.on;
  },
  ready() { return this.on && this.ctx && this.ctx.state === 'running'; },
  noise() {
    if (this.noiseBuf) return this.noiseBuf;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return (this.noiseBuf = buf);
  },
  tone(freq, dur, type = 'sine', vol = 0.08, when = 0) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  /** Kısa, filtrelenmiş gürültü patlaması (çip / top çarpması). */
  burst(freq, q, dur, vol, when = 0) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  },
  /** Bahis: kil çiplerin masaya "tık-tık" oturması. */
  chip() {
    this.burst(3200, 6, 0.045, 0.5);
    this.burst(2400, 8, 0.05, 0.35, 0.035);
    this.tone(1650, 0.04, 'triangle', 0.035, 0.01);
  },
  /** Çip seçimi: hafif tık. */
  select() { this.burst(4200, 10, 0.03, 0.25); },
  tick(v = 1) { this.burst(5200 + Math.random() * 900, 14, 0.022, 0.22 * v); },
  /** "Bahisler kapandı" çanı. */
  closed() { this.tone(880, 0.35, 'sine', 0.06); this.tone(660, 0.45, 'sine', 0.05, 0.16); },
  /** Topun cebe düşüşü. */
  clack(v = 1) { this.burst(1800, 3, 0.07, 0.45 * v); this.tone(420, 0.06, 'triangle', 0.04 * v); },
  /**
   * Çark dönüşü: topun kanalda yuvarlanma uğultusu. Dönüş ortasından
   * katılınca da kalan süre kadar çalar; ses sunucu saatine göre azalır.
   */
  startRoll(remainSec, totalSec) {
    if (!this.ready() || remainSec <= 0.2) return;
    this.stopRoll();
    const ctx = this.ctx, t = ctx.currentTime;
    const done = 1 - remainSec / totalSec; // ne kadarı geçti (0..1)
    const src = ctx.createBufferSource();
    src.buffer = this.noise(); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
    const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 900; bp.gain.value = 8;
    const g = ctx.createGain();
    // Uğultu: hızlı başlar, yavaşlarken kısılır ve tonu düşer.
    const f0 = 2600 * (1 - done) + 500, v0 = 0.16 * (1 - done * 0.7);
    lp.frequency.setValueAtTime(f0, t);
    lp.frequency.exponentialRampToValueAtTime(380, t + remainSec);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, v0), t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + remainSec);
    // Hafif tırtıl (topun dikiş üzerinden geçişi)
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
    const lg = ctx.createGain(); lg.gain.value = 0.25;
    const amp = ctx.createGain(); amp.gain.value = 1;
    lfo.connect(lg).connect(amp.gain);
    src.connect(lp).connect(bp).connect(amp).connect(g).connect(ctx.destination);
    src.start(t); lfo.start(t);
    src.stop(t + remainSec + 0.05); lfo.stop(t + remainSec + 0.05);
    this.roll = { src, lfo };
  },
  stopRoll() {
    if (!this.roll) return;
    try { this.roll.src.stop(); this.roll.lfo.stop(); } catch { /* yok */ }
    this.roll = null;
  },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.24, 'triangle', 0.09, i * 0.085)); },
  lose() { this.tone(260, 0.22, 'sine', 0.05); this.tone(196, 0.3, 'sine', 0.05, 0.14); },
};

// ─── Supabase motoru ───────────────────────────────────────────────────────
function readInjectedSession() {
  const d = window.__RETRA_SUPABASE_SESSION__;
  if (d?.access_token && d?.refresh_token) return d;
  for (const raw of [location.hash.slice(1), location.search.slice(1)]) {
    if (!raw) continue;
    const p = new URLSearchParams(raw);
    if (p.get('access_token') && p.get('refresh_token')) {
      return { access_token: p.get('access_token'), refresh_token: p.get('refresh_token') };
    }
  }
  return null;
}
function clearTokensFromUrl() {
  try {
    const u = new URL(location.href);
    if (u.hash.includes('access_token')) { u.hash = ''; history.replaceState(null, '', u.toString()); }
  } catch { /* yok */ }
}

class LiveEngine {
  constructor(client) {
    this.client = client;
    this.listeners = new Set();
    this.snapshot = null;
    this.busy = false;
    this.failures = 0;
    this.needsLogin = true;
  }
  on(fn) { this.listeners.add(fn); }
  emit(s) { for (const fn of this.listeners) { try { fn(s); } catch (e) { console.error(e); } } }

  async connect() {
    let session = null;
    const injected = readInjectedSession();
    if (injected) {
      try {
        const { data, error } = await this.client.auth.setSession(injected);
        if (!error) { session = data.session; clearTokensFromUrl(); }
      } catch { /* yok */ }
    }
    if (!session) {
      try { session = (await this.client.auth.getSession()).data.session; } catch { session = null; }
    }
    this.needsLogin = !session;
    if (this.needsLogin) return false;
    this.start();
    await this.refresh();
    return true;
  }

  async signIn(email, password) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: 'E-posta veya şifre hatalı.' };
    return { ok: await this.connect() };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 1100);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
    window.addEventListener('online', () => this.refresh());
    try {
      this.channel = this.client
        .channel('rulet-turlari')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'roulette_rounds' }, () => this.refresh())
        .subscribe();
    } catch { /* yoksa yoklama yeter */ }
  }

  async rpc(fn, args) {
    const sent = Date.now();
    let { data, error } = await this.client.rpc(fn, args);
    if (error && /jwt|token|401|pgrst30/i.test(`${error.message} ${error.code}`)) {
      try { await this.client.auth.refreshSession(); } catch { /* yok */ }
      ({ data, error } = await this.client.rpc(fn, args));
    }
    if (error) throw error;
    if (data && typeof data === 'object' && data.serverTime) {
      data.__latency = (Date.now() - sent) / 2;
      data.__recv = Date.now();
    }
    return data;
  }

  async refresh() {
    if (this.busy) return;
    this.busy = true;
    try {
      const data = await this.rpc('roulette_state');
      this.failures = 0;
      this.snapshot = data;
      this.emit({ kind: 'state', data });
    } catch (e) {
      this.failures += 1;
      if (!this.snapshot || this.failures >= 3) this.emit({ kind: 'error', error: errorText(e) });
    } finally {
      this.busy = false;
    }
  }

  async call(fn, args) {
    try {
      const data = await this.rpc(fn, args);
      this.snapshot = data;
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  }
  placeBets(list) { return this.call('roulette_place_bets', { p_bets: list }); }
  undo() { return this.call('roulette_undo'); }
  clear() { return this.call('roulette_clear'); }
  async leaderboard() {
    try { return await this.rpc('roulette_leaderboard', { p_limit: 20 }); } catch { return null; }
  }
  async history100() {
    try { return await this.rpc('roulette_history', { p_limit: 100 }); } catch (e) { return { error: errorText(e) }; }
  }
}

// ─── Demo motoru (sunucusuz deneme) ────────────────────────────────────────
class DemoEngine {
  constructor() {
    this.listeners = new Set();
    this.balance = 1000000;
    this.history = [];
    this.seq = 1000;
    this.bets = [];
    this.lastBets = [];
    this.daily = new Map();
    this.names = ['Elif', 'Mert', 'Zeynep', 'Kaan', 'Ada', 'Emir', 'Defne', 'Can'];
    this.newRound(Date.now());
  }
  on(fn) { this.listeners.add(fn); }
  emit() { const d = this.state(); for (const fn of this.listeners) fn({ kind: 'state', data: d }); }
  async connect() { setInterval(() => this.tick(), 500); this.tick(); return true; }
  newRound(now) {
    this.seq += 1;
    this.r = { id: `demo-${this.seq}`, number: this.seq, phase: 'betting', bettingEndsAt: now + BET_MS, spinEndsAt: null, resultEndsAt: null, result: null };
    this.bets = [];
    this.bots = this.names.filter(() => Math.random() < 0.5).map((n) => ({ id: n, nickname: n, avatar: '', amount: CHIPS[Math.floor(Math.random() * 6)].v }));
  }
  tick() {
    const now = Date.now();
    const r = this.r;
    if (r.phase === 'betting' && now >= r.bettingEndsAt) {
      r.phase = 'spinning'; r.result = Math.floor(Math.random() * 37); r.spinEndsAt = r.bettingEndsAt + SPIN_MS;
    } else if (r.phase === 'spinning' && now >= r.spinEndsAt) {
      r.phase = 'result'; r.resultEndsAt = now + RESULT_MS;
      let pay = 0;
      for (const b of this.bets) { b.payout = wins(b.type, b.value, r.result) ? b.amount * MULT[b.type] : 0; pay += b.payout; }
      this.balance += pay;
      if (pay > 0) this.daily.set('Sen', (this.daily.get('Sen') || 0) + pay);
    } else if (r.phase === 'result' && now >= r.resultEndsAt) {
      this.history.unshift(r.result); this.history = this.history.slice(0, 100);
      if (this.bets.length) this.lastBets = this.agg(this.bets);
      this.newRound(now);
    }
    this.emit();
  }
  agg(list) {
    const m = new Map();
    for (const b of list) {
      const k = keyOf(b.type, b.value);
      const o = m.get(k) || { type: b.type, value: b.value, amount: 0, payout: 0 };
      o.amount += b.amount; o.payout += b.payout || 0; m.set(k, o);
    }
    return [...m.values()];
  }
  state() {
    const r = this.r;
    const total = this.bets.reduce((s, b) => s + b.amount, 0);
    const pay = this.bets.reduce((s, b) => s + (b.payout || 0), 0);
    const players = [...(total ? [{ id: 'me', nickname: 'Sen', avatar: '', amount: total }] : []), ...this.bots];
    return {
      serverTime: Date.now(), __latency: 0, __recv: Date.now(),
      player: { nickname: 'Sen', balance: this.balance },
      round: {
        ...r,
        result: r.phase === 'betting' ? null : r.result,
        myBets: this.agg(this.bets), totalBet: total, myPayout: pay,
        playerCount: players.length, totalStaked: players.reduce((s, p) => s + p.amount, 0), players,
        winners: r.phase === 'result' && pay > 0 ? [{ id: 'me', nickname: 'Sen', avatar: '', amount: total, payout: pay }] : [],
        lastBets: r.phase === 'betting' ? this.lastBets : [],
      },
      history: this.history,
    };
  }
  async placeBets(list) {
    if (this.r.phase !== 'betting' || Date.now() >= this.r.bettingEndsAt) return { ok: false, error: ERRORS.PHASE_CLOSED };
    const sum = list.reduce((s, b) => s + b.amount, 0);
    if (sum > this.balance) return { ok: false, error: ERRORS.BALANCE };
    this.balance -= sum;
    const batch = Math.random();
    for (const b of list) this.bets.push({ ...b, batch });
    await new Promise((r) => setTimeout(r, 120));
    return { ok: true, data: this.state() };
  }
  async undo() {
    const last = this.bets[this.bets.length - 1];
    if (!last) return { ok: true, data: this.state() };
    const keep = this.bets.filter((b) => b.batch !== last.batch);
    this.balance += this.bets.filter((b) => b.batch === last.batch).reduce((s, b) => s + b.amount, 0);
    this.bets = keep;
    return { ok: true, data: this.state() };
  }
  async clear() {
    this.balance += this.bets.reduce((s, b) => s + b.amount, 0);
    this.bets = [];
    return { ok: true, data: this.state() };
  }
  async history100() {
    return this.history.map((n, i) => ({ number: this.seq - 1 - i, result: n, at: Date.now() - i * 35000 }));
  }
  async leaderboard() {
    const rows = [...this.daily.entries()].map(([n, w]) => ({ id: n, nickname: n, avatar: '', won: w }));
    return { resetsAt: Date.now() + 5 * 3600e3, rows };
  }
}

// ─── Çark çizimi ───────────────────────────────────────────────────────────
class Wheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.lastTickSlot = null;
  }
  resize() {
    const css = this.canvas.clientWidth || 160;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Dönüşte çark ortaya büyüyerek gelir (CSS ölçeği): çizim baştan o
    // boyutun çözünürlüğünde yapılır, büyüyünce bulanıklaşmaz.
    const zoom = Math.max(1, this.zoom || 1);
    const px = Math.min(1000, Math.round(css * dpr * zoom));
    if (px === this.size) return;
    this.size = px;
    this.canvas.width = px; this.canvas.height = px;
    this.rotor = this.renderRotor(px);
    this.bowl = this.renderBowl(px);
  }
  renderBowl(px) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d'); const R = px / 2;
    g.translate(R, R);
    // Dış ahşap/altın çember
    let gr = g.createRadialGradient(0, 0, R * 0.8, 0, 0, R);
    gr.addColorStop(0, '#3a2412'); gr.addColorStop(0.55, '#6b3f1c'); gr.addColorStop(0.8, '#2a170b'); gr.addColorStop(1, '#120a05');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.995, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 207, 90, .85)'; g.lineWidth = R * 0.018;
    g.beginPath(); g.arc(0, 0, R * 0.965, 0, Math.PI * 2); g.stroke();
    // Topun döndüğü parlak kanal
    gr = g.createRadialGradient(0, 0, R * 0.74, 0, 0, R * 0.9);
    gr.addColorStop(0, '#151022'); gr.addColorStop(0.5, '#2b2340'); gr.addColorStop(1, '#0d0a16');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 207, 90, .55)'; g.lineWidth = R * 0.012;
    g.beginPath(); g.arc(0, 0, R * 0.9, 0, Math.PI * 2); g.stroke();
    // Saptırıcı elmaslar
    for (let i = 0; i < 8; i++) {
      g.save(); g.rotate((i * Math.PI) / 4 + Math.PI / 8);
      g.fillStyle = '#e8d7a0'; g.beginPath();
      g.moveTo(0, -R * 0.875); g.lineTo(R * 0.025, -R * 0.84); g.lineTo(0, -R * 0.805); g.lineTo(-R * 0.025, -R * 0.84); g.closePath(); g.fill();
      g.restore();
    }
    return c;
  }
  renderRotor(px) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d'); const R = px / 2;
    g.translate(R, R);
    const rOut = R * 0.76, rNum = R * 0.6, rPocket = R * 0.48;
    for (let i = 0; i < 37; i++) {
      const n = ORDER[i];
      const a0 = -Math.PI / 2 + i * STEP - STEP / 2, a1 = a0 + STEP;
      const col = colorOf(n);
      const base = col === 'red' ? ['#f03a50', '#9b0f27'] : col === 'black' ? ['#2e2a40', '#0c0a13'] : ['#25d27c', '#08703c'];
      const gr = g.createRadialGradient(0, 0, rPocket, 0, 0, rOut);
      gr.addColorStop(0, base[1]); gr.addColorStop(1, base[0]);
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, rOut, a0, a1); g.arc(0, 0, rPocket, a1, a0, true); g.closePath(); g.fill();
      // Cep bölmeleri (altın çizgi)
      g.strokeStyle = 'rgba(255, 214, 120, .9)'; g.lineWidth = Math.max(1, R * 0.008);
      g.beginPath(); g.moveTo(Math.cos(a0) * rPocket, Math.sin(a0) * rPocket); g.lineTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut); g.stroke();
      // Sayı
      const am = a0 + STEP / 2;
      g.save(); g.rotate(am + Math.PI / 2);
      g.fillStyle = '#fff';
      g.font = `900 ${Math.round(R * 0.085)}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 0, -(rOut + rNum) / 2 - R * 0.005);
      g.restore();
    }
    // Sayı halkası ile cep halkası arasındaki ince altın çember
    g.strokeStyle = 'rgba(255, 214, 120, .95)'; g.lineWidth = Math.max(1, R * 0.012);
    g.beginPath(); g.arc(0, 0, rNum - R * 0.02, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, rOut, 0, Math.PI * 2); g.stroke();
    // İç koni
    let gr = g.createRadialGradient(-R * 0.1, -R * 0.12, R * 0.05, 0, 0, rPocket);
    gr.addColorStop(0, '#8a5a2b'); gr.addColorStop(0.55, '#4e2f14'); gr.addColorStop(1, '#22140a');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rPocket, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 214, 120, .9)'; g.lineWidth = Math.max(1, R * 0.014);
    g.beginPath(); g.arc(0, 0, rPocket, 0, Math.PI * 2); g.stroke();
    // Göbek kolları
    for (let i = 0; i < 4; i++) {
      g.save(); g.rotate((i * Math.PI) / 2);
      const lg = g.createLinearGradient(0, -rPocket * 0.95, 0, 0);
      lg.addColorStop(0, '#ffe7a0'); lg.addColorStop(1, '#b8862b');
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(-R * 0.018, -R * 0.3); g.lineTo(0, -rPocket * 0.92); g.lineTo(R * 0.018, -R * 0.3); g.closePath(); g.fill();
      g.beginPath(); g.arc(0, -rPocket * 0.92, R * 0.022, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    gr = g.createRadialGradient(-R * 0.05, -R * 0.06, R * 0.02, 0, 0, R * 0.3);
    gr.addColorStop(0, '#3a2d5c'); gr.addColorStop(1, '#120d22');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 214, 120, .95)'; g.lineWidth = Math.max(1, R * 0.016);
    g.beginPath(); g.arc(0, 0, R * 0.3, 0, Math.PI * 2); g.stroke();
    return c;
  }
  /** Çarkın açısı (sunucu saatine bağlı, herkes aynı açıyı görür). */
  angleAt(now, round) {
    // Açı 2π'ye indirgenir: tuval döndürmesi float32 çalışır, çok büyük açı
    // (epoch saniyesi) çarkı yanlış yere çizer ve top cebiyle uyuşmazdı.
    const TAU = Math.PI * 2;
    // Saatte tam 200 tur: saat başında açı sıçramaz.
    let a = (((now % 3600000) / 3600000) * TAU * 200) % TAU;
    if (round && round.phase !== 'betting' && round.bettingEndsAt) {
      const D = SPIN_MS - LAND_BEFORE_END;
      const p = clamp((now - round.bettingEndsAt) / D, 0, 1);
      a += Math.PI * 6 * easeOutCubic(p);
    }
    return a % TAU;
  }
  /** Top: konum (çarka göre açı + yarıçap oranı) ya da null. */
  ball(now, round, lastResult) {
    if (round && round.phase !== 'betting' && round.result != null && round.bettingEndsAt) {
      const D = SPIN_MS - LAND_BEFORE_END;
      const p = clamp((now - round.bettingEndsAt) / D, 0, 1);
      const pocket = ORDER.indexOf(round.result) * STEP;
      const rel = pocket + Math.PI * 2 * 9 * (1 - easeOutCubic(p));
      let r;
      if (p < 0.55) r = 0.83 + 0.01 * Math.sin(p * 40);
      else if (p < 0.8) {
        const s = (p - 0.55) / 0.25;
        r = lerp(0.83, 0.54, s) + 0.07 * Math.abs(Math.sin(s * Math.PI * 3)) * (1 - s);
      } else {
        const s = (p - 0.8) / 0.2;
        r = 0.54 + 0.02 * Math.abs(Math.sin(s * Math.PI * 4)) * (1 - s);
      }
      return { rel, r, p };
    }
    if (lastResult != null) return { rel: ORDER.indexOf(lastResult) * STEP, r: 0.54, p: 1 };
    return null;
  }
  draw(now, round, lastResult, highlight) {
    this.resize();
    const g = this.ctx, px = this.size, R = px / 2;
    g.clearRect(0, 0, px, px);
    g.drawImage(this.bowl, 0, 0);
    const a = this.angleAt(now, round);
    g.save(); g.translate(R, R); g.rotate(a); g.drawImage(this.rotor, -R, -R);
    if (highlight != null) {
      const i = ORDER.indexOf(highlight);
      const a0 = -Math.PI / 2 + i * STEP - STEP / 2;
      g.fillStyle = 'rgba(255, 230, 140, .35)';
      g.beginPath(); g.arc(0, 0, R * 0.76, a0, a0 + STEP); g.arc(0, 0, R * 0.48, a0 + STEP, a0, true); g.closePath(); g.fill();
      g.strokeStyle = '#ffe28a'; g.lineWidth = R * 0.02; g.stroke();
    }
    g.restore();
    const b = this.ball(now, round, lastResult);
    if (b) {
      const ang = -Math.PI / 2 + a + b.rel;
      const x = R + Math.cos(ang) * R * b.r, y = R + Math.sin(ang) * R * b.r;
      const br = R * 0.048;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + br * 0.3, y + br * 0.4, br, 0, Math.PI * 2); g.fill();
      const gr = g.createRadialGradient(x - br * 0.35, y - br * 0.4, br * 0.1, x, y, br);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#e6e6ee'); gr.addColorStop(1, '#9c9cad');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill();
      // Cep çıtırtısı: top bölmelerden geçtikçe kısa tık
      if (b.p > 0.5 && b.p < 1) {
        const slot = Math.floor((b.rel + STEP / 2) / STEP);
        if (slot !== this.lastTickSlot) { this.lastTickSlot = slot; Sound.tick(1.2 - b.p); }
      }
    }
  }
}

// ─── Arayüz ────────────────────────────────────────────────────────────────
class Game {
  constructor(engine) {
    this.engine = engine;
    this.wheel = new Wheel($('wheel'));
    this.offset = 0;
    this.snap = null;
    this.roundId = null;
    this.chip = CHIPS[2].v;
    try { const c = Number(localStorage.getItem('rulet_chip')); if (CHIPS.some((x) => x.v === c)) this.chip = c; } catch { /* yok */ }
    this.confirmed = new Map();
    this.pending = [];
    this.inflight = new Map();
    this.flushTimer = null;
    this.shownResult = null;
    this.ready = false;
    this.cells = new Map();
    this.buildBoard();
    this.buildChips();
    this.bind();
    this.fit();
    window.addEventListener('resize', () => this.fit());
    engine.on((ev) => this.onEvent(ev));
    requestAnimationFrame((t) => this.frame(t));
  }

  get now() { return Date.now() + this.offset; }

  /** Çark, ekrandaki boş yüksekliği kullanacak kadar büyür (masa sabit). */
  fit() {
    const h = window.innerHeight;
    const w = Math.min(window.innerWidth, 560);
    const wheel = clamp(Math.round(h - 418), 118, Math.min(232, Math.round(w * 0.56)));
    const app = $('app');
    app.style.setProperty('--wheel', `${wheel}px`);
    // Dönüş sahnesindeki boyut: ekranın genişliği/yüksekliğine göre.
    const big = Math.round(Math.min(window.innerWidth * 0.86, h * 0.6, 460));
    this.wheel.zoom = big / wheel;
    this.spinTarget = big;
    if (this.centered) this.placeWheel(true);
  }

  /** Çarkı ortaya getirir (dönüşte) ya da yerine döndürür. */
  placeWheel(center) {
    const wrap = document.querySelector('.wheel-wrap');
    if (!center) {
      wrap.style.transform = '';
      this.centered = false;
      return;
    }
    const prev = wrap.style.transform;
    wrap.style.transition = 'none';
    wrap.style.transform = '';
    const r = wrap.getBoundingClientRect();
    wrap.style.transform = prev;
    void wrap.offsetWidth;
    wrap.style.transition = '';
    const scale = (this.spinTarget || r.width) / r.width;
    const cx = window.innerWidth / 2, cy = window.innerHeight * 0.46;
    const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
    wrap.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    const cap = $('spin-cap');
    cap.style.top = `${Math.round(cy + (this.spinTarget || r.width) / 2 + 14)}px`;
    this.centered = true;
  }
  get round() { return this.snap?.round ?? null; }

  // Masa ------------------------------------------------------------------
  buildBoard() {
    const grid = $('grid');
    const add = (parent, key, cls, html, style = {}) => {
      const el = document.createElement('button');
      el.className = `cell ${cls}`;
      el.dataset.key = key;
      el.innerHTML = html;
      Object.assign(el.style, style);
      parent.appendChild(el);
      this.cells.set(key, el);
      return el;
    };
    add(grid, keyOf('straight', 0), 'zero green', '0', { gridColumn: '1', gridRow: '1 / span 3' });
    for (let col = 1; col <= 12; col++) {
      for (let row = 1; row <= 3; row++) {
        const n = col * 3 - (row - 1);
        add(grid, keyOf('straight', n), colorOf(n), String(n), { gridColumn: String(col + 1), gridRow: String(row) });
      }
    }
    for (let row = 1; row <= 3; row++) add(grid, keyOf('column', 4 - row), 'col', '2:1', { gridColumn: '14', gridRow: String(row) });
    ['1-12', '13-24', '25-36'].forEach((t, i) => add($('dozens'), keyOf('dozen', i + 1), 'out', t));
    const outs = [
      ['low', '1-18', ''], ['even', 'ÇİFT', ''],
      ['red', '<span class="diamond" style="background:#ff4256"></span>', 'red-bet'],
      ['black', '<span class="diamond" style="background:#0f0d17;border:1px solid #fff5"></span>', 'black-bet'],
      ['odd', 'TEK', ''], ['high', '19-36', ''],
    ];
    for (const [type, html, cls] of outs) add($('outside'), keyOf(type), `out ${cls}`, html);
  }

  buildChips() {
    const box = $('chips');
    for (const c of CHIPS) {
      const el = document.createElement('button');
      el.className = 'chip';
      el.dataset.v = c.v;
      el.style.background = `radial-gradient(circle at 35% 30%, ${c.c1}, ${c.c2})`;
      if (c.ring) el.style.boxShadow = `0 4px 10px rgba(0,0,0,.45), inset 0 0 0 4px ${c.ring}`;
      el.innerHTML = `<span>${short(c.v)}</span>`;
      box.appendChild(el);
    }
    this.renderChips();
  }

  renderChips() {
    const avail = this.available();
    for (const el of $('chips').children) {
      const v = Number(el.dataset.v);
      el.classList.toggle('sel', v === this.chip);
      el.classList.toggle('off', v > avail);
    }
  }

  bind() {
    const unlock = () => Sound.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    const felt = $('felt');
    felt.addEventListener('click', (e) => {
      const el = e.target.closest('.cell');
      if (el) this.tap(el.dataset.key);
    });
    // Basılı tutarken kapsadığı sayılar parlar
    felt.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.cell');
      if (!el) return;
      const { type, value } = parseKey(el.dataset.key);
      if (type === 'straight') return;
      for (const n of covers(type, value)) this.cells.get(keyOf('straight', n))?.classList.add('hl');
    });
    const clearHl = () => { for (const el of this.cells.values()) el.classList.remove('hl'); };
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => felt.addEventListener(t, clearHl));
    $('chips').addEventListener('click', (e) => {
      const el = e.target.closest('.chip');
      if (!el) return;
      this.chip = Number(el.dataset.v);
      try { localStorage.setItem('rulet_chip', String(this.chip)); } catch { /* yok */ }
      Sound.select();
      this.renderChips();
    });
    $('btn-undo').onclick = () => this.undo();
    $('btn-clear').onclick = () => this.clear();
    $('btn-repeat').onclick = () => this.repeat();
    $('btn-double').onclick = () => this.double();
    $('btn-sound').onclick = () => { $('btn-sound').textContent = Sound.toggle() ? '🔊' : '🔇'; };
    $('btn-sound').textContent = Sound.on ? '🔊' : '🔇';
    $('btn-help').onclick = () => this.openSheet('sheet-help');
    $('btn-board').onclick = () => this.openBoard();
    // Son sonuçlara dokununca: son 100 turun tablosu (ortada açılır).
    for (const id of ['history', 'hist-title', 'stats']) $(id).onclick = () => this.openHistory();
    $('hist-close').onclick = () => this.closeHistory();
    $('hist-back').onclick = () => this.closeHistory();
    $('sheet-back').onclick = () => this.closeSheets();
    document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => this.closeSheets()));
  }

  // Sunucu olayları -------------------------------------------------------
  onEvent(ev) {
    if (ev.kind === 'error') {
      if (!this.snap) this.toast(ev.error);
      this.markReady();
      return;
    }
    this.apply(ev.data, false);
  }

  apply(data, fromAction) {
    if (!data?.round) return;
    if (data.serverTime) {
      const est = data.serverTime + (data.__latency || 0) - (data.__recv || Date.now());
      this.offset = this.snap ? this.offset * 0.7 + est * 0.3 : est;
    }
    const prevId = this.roundId;
    const busy = this.inflight.size > 0;
    if (busy && !fromAction && this.snap) {
      // İstek yoldayken gelen yoklama, masadaki çipleri/bakiyeyi ezmesin.
      data = { ...data, player: this.snap.player, round: { ...data.round, myBets: this.snap.round.myBets, totalBet: this.snap.round.totalBet } };
    }
    this.snap = data;
    if (data.round.id !== prevId) {
      this.roundId = data.round.id;
      this.pending = [];
      this.shownResult = null;
      $('result').hidden = true;
      for (const el of this.cells.values()) el.classList.remove('win', 'dim');
    }
    this.confirmed = new Map((data.round.myBets || []).map((b) => [keyOf(b.type, b.value), Number(b.amount) || 0]));
    $('round-no').textContent = `Tur #${fmt(data.round.number)}`;
    this.renderBets();
    this.renderSide();
    this.renderChips();
    if (data.round.phase === 'result') this.showResult();
    this.markReady();
  }

  markReady() {
    if (this.ready) return;
    this.ready = true;
    notifyApp('ready');
  }

  // Hesaplar ----------------------------------------------------------------
  pendingSum() {
    let s = 0;
    for (const p of this.pending) s += p.amount;
    for (const v of this.inflight.values()) s += v;
    return s;
  }
  available() { return Math.max(0, (Number(this.snap?.player?.balance) || 0) - this.pendingSum()); }
  bettingOpen() {
    const r = this.round;
    return !!r && r.phase === 'betting' && this.now < r.bettingEndsAt - 400;
  }
  shown() {
    const m = new Map(this.confirmed);
    const add = (k, v) => m.set(k, (m.get(k) || 0) + v);
    for (const [k, v] of this.inflightByKey || []) add(k, v);
    for (const p of this.pending) add(p.key, p.amount);
    return m;
  }

  // Bahis işlemleri -----------------------------------------------------------
  tap(key) {
    if (!this.snap) return;
    if (!this.bettingOpen()) { this.toast(ERRORS.PHASE_CLOSED); return; }
    if (this.chip > this.available()) {
      notifyApp('lowbalance');
      this.toast(ERRORS.BALANCE);
      return;
    }
    const cur = this.shown().get(key) || 0;
    if (cur + this.chip > 20000000) { this.toast(ERRORS.ROUND_LIMIT); return; }
    this.pending.push({ key, amount: this.chip });
    Sound.chip();
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* yok */ } }
    this.renderBets();
    this.renderChips();
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 260);
  }

  async flush() {
    clearTimeout(this.flushTimer);
    if (!this.pending.length || this.inflight.size) {
      if (this.pending.length) this.flushTimer = setTimeout(() => this.flush(), 200);
      return;
    }
    const batch = this.pending;
    this.pending = [];
    const agg = new Map();
    for (const p of batch) agg.set(p.key, (agg.get(p.key) || 0) + p.amount);
    const list = [];
    for (const [k, amount] of agg) {
      const { type, value } = parseKey(k);
      // Tek çip sınırı 1M: büyük toplamlar parçalanır.
      let left = amount;
      while (left > 0) { const a = Math.min(MAX_CHIP, left); list.push({ type, value, amount: a }); left -= a; }
    }
    await this.send(list, agg);
  }

  async send(list, agg) {
    if (!list.length) return;
    if (list.length > 60) { this.toast('Çok fazla çip: biraz daha az dene.'); return; }
    const id = Math.random();
    const total = list.reduce((s, b) => s + b.amount, 0);
    this.inflight.set(id, total);
    this.inflightByKey = agg;
    this.renderBets();
    const res = await this.engine.placeBets(list);
    this.inflight.delete(id);
    this.inflightByKey = null;
    if (res.ok) this.apply(res.data, true);
    else { this.toast(res.error); this.renderBets(); this.renderChips(); }
    if (this.pending.length) this.flush();
  }

  async undo() {
    if (this.pending.length) {
      this.pending.pop();
      this.renderBets(); this.renderChips();
      return;
    }
    if (!this.confirmed.size) return;
    if (!this.bettingOpen()) { this.toast(ERRORS.PHASE_CLOSED); return; }
    const res = await this.engine.undo();
    if (res.ok) this.apply(res.data, true); else this.toast(res.error);
  }

  async clear() {
    this.pending = [];
    this.renderBets(); this.renderChips();
    if (!this.confirmed.size) return;
    if (!this.bettingOpen()) { this.toast(ERRORS.PHASE_CLOSED); return; }
    const res = await this.engine.clear();
    if (res.ok) this.apply(res.data, true); else this.toast(res.error);
  }

  async repeat() {
    const last = this.round?.lastBets || [];
    if (!last.length) { this.toast('Tekrarlanacak önceki bahis yok.'); return; }
    await this.placeList(last.map((b) => ({ type: b.type, value: Number(b.value) || 0, amount: Number(b.amount) || 0 })));
  }

  async double() {
    const m = this.shown();
    if (!m.size) { this.toast('Önce masaya çip koy.'); return; }
    await this.placeList([...m].map(([k, amount]) => ({ ...parseKey(k), amount })));
  }

  async placeList(items) {
    if (!this.bettingOpen()) { this.toast(ERRORS.PHASE_CLOSED); return; }
    const total = items.reduce((s, b) => s + b.amount, 0);
    if (total > this.available()) { notifyApp('lowbalance'); this.toast(ERRORS.BALANCE); return; }
    await this.flush();
    const agg = new Map(items.map((b) => [keyOf(b.type, b.value), b.amount]));
    const list = [];
    for (const b of items) { let left = b.amount; while (left > 0) { const a = Math.min(MAX_CHIP, left); list.push({ type: b.type, value: b.value, amount: a }); left -= a; } }
    Sound.chip();
    await this.send(list, agg);
  }

  // Çizim -------------------------------------------------------------------
  renderBets() {
    const m = this.shown();
    const pendingKeys = new Set([...this.pending.map((p) => p.key), ...(this.inflightByKey ? this.inflightByKey.keys() : [])]);
    for (const [key, el] of this.cells) {
      const amount = m.get(key) || 0;
      let mini = el.querySelector('.mini');
      if (!amount) { mini?.remove(); continue; }
      if (!mini) { mini = document.createElement('span'); mini.className = 'mini'; el.appendChild(mini); }
      const c = [...CHIPS].reverse().find((x) => amount >= x.v) || CHIPS[0];
      mini.style.background = `radial-gradient(circle at 35% 30%, ${c.c1}, ${c.c2})`;
      mini.textContent = short(amount);
      mini.classList.toggle('pending', pendingKeys.has(key));
    }
    let total = 0;
    for (const v of m.values()) total += v;
    // 10.000 ve üstü kısaltılır (10K, 1.5M): kutudan taşmasın.
    $('my-total').textContent = total >= 10000 ? short(total) : fmt(total);
    $('balance').textContent = fmt(this.available());
    const hasAny = m.size > 0;
    $('btn-undo').disabled = !hasAny;
    $('btn-clear').disabled = !hasAny;
    $('btn-double').disabled = !hasAny;
    $('btn-repeat').disabled = !(this.round?.lastBets || []).length || hasAny;
  }

  renderSide() {
    const hist = this.snap?.history || [];
    const box = $('history');
    box.innerHTML = '';
    // Sığdığı kadar **tam** kutu (yarım kesik kutu görünmesin).
    const fitCount = Math.max(4, Math.floor(((box.clientWidth || 180) - 4 + 3) / 24));
    for (const n of hist.slice(0, fitCount)) {
      const d = document.createElement('div');
      d.className = `h ${colorOf(n)}`;
      d.textContent = n;
      box.appendChild(d);
    }
    let r = 0, b = 0, z = 0;
    for (const n of hist) { if (n === 0) z++; else if (RED.has(n)) r++; else b++; }
    $('st-red').textContent = r; $('st-black').textContent = b; $('st-green').textContent = z;
    const pl = this.round?.players || [];
    const pbox = $('players');
    pbox.innerHTML = '';
    for (const p of pl.slice(0, 6)) {
      const a = document.createElement('div');
      a.className = 'av';
      if (p.avatar) a.style.backgroundImage = `url("${String(p.avatar).replace(/"/g, '')}")`;
      else a.textContent = (p.nickname || '?').slice(0, 1).toUpperCase();
      a.title = p.nickname || '';
      pbox.appendChild(a);
    }
    const count = Number(this.round?.playerCount) || 0;
    const more = document.createElement('span');
    more.className = 'more';
    more.textContent = count ? `${count} oyuncu · ${short(this.round?.totalStaked || 0)}` : 'Masada henüz bahis yok';
    pbox.appendChild(more);
  }

  showResult() {
    const r = this.round;
    if (!r || r.result == null || this.shownResult === r.id) return;
    this.shownResult = r.id;
    const n = r.result;
    for (const [key, el] of this.cells) {
      const { type, value } = parseKey(key);
      const w = wins(type, value, n);
      el.classList.toggle('win', w);
      el.classList.toggle('dim', !w);
    }
    const medal = $('res-medal');
    medal.className = `medal ${colorOf(n)}`;
    medal.textContent = n;
    const parts = [n === 0 ? 'Sıfır' : RED.has(n) ? 'Kırmızı' : 'Siyah'];
    if (n > 0) parts.push(n % 2 ? 'Tek' : 'Çift', n <= 18 ? '1-18' : '19-36', `${Math.ceil(n / 12) * 12 - 11}-${Math.ceil(n / 12) * 12}`);
    $('res-title').textContent = parts.join(' · ');
    const bet = Number(r.totalBet) || 0, pay = Number(r.myPayout) || 0;
    const mine = $('res-mine');
    if (pay > 0) {
      mine.className = 'res-mine win';
      mine.textContent = `+${pay >= 1000000 ? short(pay) : fmt(pay)} kristal`;
      Sound.win();
      this.gain(pay);
      notifyApp(`win:${pay}`);
    } else if (bet > 0) {
      mine.className = 'res-mine lose';
      mine.textContent = 'Bu tur kazanamadın';
      Sound.lose();
    } else {
      mine.className = 'res-mine';
      mine.textContent = '';
    }
    const pod = $('podium');
    pod.innerHTML = '';
    (r.winners || []).slice(0, 3).forEach((w, i) => {
      const d = document.createElement('div');
      d.className = `pod${i === 0 ? ' first' : ''}`;
      const av = document.createElement('div');
      av.className = 'av';
      if (w.avatar) av.style.backgroundImage = `url("${String(w.avatar).replace(/"/g, '')}")`;
      else av.textContent = (w.nickname || '?').slice(0, 1).toUpperCase();
      const rk = document.createElement('div'); rk.className = 'rk'; rk.textContent = ['1.', '2.', '3.'][i];
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = w.nickname || 'Oyuncu';
      const wn = document.createElement('div'); wn.className = 'wn'; wn.textContent = `+${short(w.payout)}`;
      d.append(rk, av, nm, wn);
      pod.appendChild(d);
    });
    $('result').hidden = false;
  }

  gain(amount) {
    const g = $('gain');
    g.hidden = false;
    g.textContent = `+${short(amount)}`;
    g.style.animation = 'none'; void g.offsetWidth; g.style.animation = '';
    clearTimeout(this.gainTimer);
    this.gainTimer = setTimeout(() => (g.hidden = true), 1700);
  }

  frame() {
    const now = this.now;
    const r = this.round;
    const app = $('app');
    const phase = r?.phase || 'betting';
    const last = this.snap?.history?.[0] ?? null;
    let hl = null;
    if (r && phase !== 'betting' && r.result != null) {
      const landed = now >= r.bettingEndsAt + SPIN_MS - LAND_BEFORE_END;
      if (landed) hl = r.result;
    }
    // Çark dönmüyorken saniyede ~30 kare yeter (telefon ısınmaz, sonuç
    // ekranında takılma olmaz); dönüşte tam hız.
    this.tick = (this.tick || 0) + 1;
    const busy = phase === 'spinning';
    if (busy || this.tick % 2 === 0) this.wheel.draw(now, r, phase === 'betting' ? last : null, hl);
    this.spinSounds(now, r);

    const hub = $('hub');
    let num = '', sub = '', cls = 'hub';
    const ph = $('phase');
    if (!r) {
      ph.textContent = 'Masa hazırlanıyor…';
    } else if (phase === 'betting') {
      const left = Math.max(0, r.bettingEndsAt - now);
      num = String(Math.ceil(left / 1000));
      sub = 'saniye';
      ph.textContent = left > 400 ? 'Bahisler açık' : 'Bahisler kapanıyor';
      ph.className = 'phase';
      $('timer-bar').style.transform = `scaleX(${clamp(left / BET_MS, 0, 1)})`;
    } else {
      const landed = hl != null;
      ph.textContent = phase === 'result' ? 'Sonuç' : landed ? 'Top durdu!' : 'Çark dönüyor…';
      ph.className = 'phase off';
      $('timer-bar').style.transform = 'scaleX(0)';
      if (landed) { num = String(r.result); cls = `hub ${colorOf(r.result)}`; }
    }
    if (hub.className !== cls) hub.className = cls;
    if ($('hub-num').textContent !== num) $('hub-num').textContent = num;
    if ($('hub-sub').textContent !== sub) $('hub-sub').textContent = sub;

    const locked = !!r && !this.bettingOpen();
    app.classList.toggle('locked', locked);
    const spinning = phase === 'spinning';
    app.classList.toggle('spin', spinning);
    if (spinning !== !!this.centered) this.placeWheel(spinning);
    const closed = $('closed');
    const showClosed = false; // dönüş yazısı artık çarkın altında (spin-cap)
    if (closed.hidden === showClosed) closed.hidden = !showClosed;
    requestAnimationFrame(() => this.frame());
  }

  /**
   * Dönüş sesleri: bahisler kapanınca çan, top kanalda dönerken uğultu,
   * cebe düşerken sekme sesleri ve oturma "tak"ı. Sunucu saatine bağlı:
   * dönüşün ortasında açan da kalan kısmı duyar.
   */
  spinSounds(now, r) {
    if (!r || r.phase === 'betting' || !r.bettingEndsAt) { Sound.stopRoll(); return; }
    const s = this.spinFx?.id === r.id ? this.spinFx : (this.spinFx = { id: r.id, marks: new Set() });
    const D = SPIN_MS - LAND_BEFORE_END;
    const p = (now - r.bettingEndsAt) / D;
    if (p >= 1.4 || document.hidden) return;
    const once = (k, fn) => { if (!s.marks.has(k)) { s.marks.add(k); fn(); } };
    if (p < 0.15) once('closed', () => Sound.closed());
    if (p < 0.55) once('roll', () => Sound.startRoll((D * 0.8 - (now - r.bettingEndsAt)) / 1000, (D * 0.8) / 1000));
    [[0.58, 1], [0.64, 0.8], [0.7, 0.6], [0.76, 0.45], [0.83, 0.3]].forEach(([at, v]) => {
      if (p >= at && p < at + 0.05) once(`b${at}`, () => Sound.clack(v));
    });
    if (p >= 1 && p < 1.1) once('land', () => Sound.clack(1.1));
  }

  // Alt sayfalar ----------------------------------------------------------
  openSheet(id) { $('sheet-back').hidden = false; $(id).hidden = false; }
  closeSheets() { $('sheet-back').hidden = true; for (const id of ['sheet-help', 'sheet-board']) $(id).hidden = true; }
  async openBoard() {
    this.openSheet('sheet-board');
    const list = $('board-list');
    list.innerHTML = '<div class="empty">Yükleniyor…</div>';
    const data = await this.engine.leaderboard();
    const rows = data?.rows || [];
    if (data?.resetsAt) {
      const ms = Math.max(0, Number(data.resetsAt) - this.now);
      const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
      $('board-reset').textContent = `Sıralama ${h} sa ${m} dk sonra sıfırlanır`;
    }
    list.innerHTML = '';
    if (!rows.length) { list.innerHTML = '<div class="empty">Bugün henüz kazanan yok. İlk sen ol!</div>'; return; }
    rows.forEach((w, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      const rk = document.createElement('div'); rk.className = 'rk'; rk.textContent = i + 1;
      const av = document.createElement('div'); av.className = 'av';
      if (w.avatar) av.style.backgroundImage = `url("${String(w.avatar).replace(/"/g, '')}")`;
      else av.textContent = (w.nickname || '?').slice(0, 1).toUpperCase();
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = w.nickname || 'Oyuncu';
      const wn = document.createElement('div'); wn.className = 'wn'; wn.textContent = `+${fmt(w.won)}`;
      row.append(rk, av, nm, wn);
      list.appendChild(row);
    });
  }

  async openHistory() {
    $('hist-back').hidden = false;
    $('hist-modal').hidden = false;
    const grid = $('hist-grid');
    grid.innerHTML = '<div class="empty">Yükleniyor…</div>';
    const data = await this.engine.history100();
    if (!Array.isArray(data)) {
      grid.innerHTML = `<div class="empty">${data?.error || 'Geçmiş okunamadı.'}</div>`;
      return;
    }
    const nums = data.map((d) => Number(d.result)).filter((n) => n >= 0 && n <= 36);
    const total = nums.length || 1;
    const pct = (k) => `${Math.round((k / total) * 100)}%`;
    const cnt = (f) => nums.filter(f).length;
    const red = cnt((n) => RED.has(n)), zero = cnt((n) => n === 0), black = nums.length - red - zero;
    const freq = new Map();
    for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);
    const all = Array.from({ length: 37 }, (_, i) => [i, freq.get(i) || 0]);
    const hot = [...all].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5);
    const cold = [...all].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, 5);
    const ball = (n, extra = '') => `<span class="hb ${colorOf(n)}">${n}${extra}</span>`;
    const bar = (label, a, b, ca, cb) => `<div class="hbar"><span>${label}</span><div class="hbar-track"><i class="${ca}" style="width:${(a / total) * 100}%"></i><i class="${cb}" style="width:${(b / total) * 100}%"></i></div><small class="hbar-n">${a} · ${b}</small></div>`;
    $('hist-sub').textContent = `Son ${nums.length} tur · en yeni solda üstte`;
    $('hist-stats').innerHTML = `
      <div class="hs-row"><span class="dot red"></span>Kırmızı <b>${red}</b> <small>${pct(red)}</small>
        <span class="dot black"></span>Siyah <b>${black}</b> <small>${pct(black)}</small>
        <span class="dot green"></span>Sıfır <b>${zero}</b> <small>${pct(zero)}</small></div>
      ${bar('Tek / Çift', cnt((n) => n % 2 === 1), cnt((n) => n > 0 && n % 2 === 0), 'c-a', 'c-b')}
      ${bar('1-18 / 19-36', cnt((n) => n >= 1 && n <= 18), cnt((n) => n >= 19), 'c-a', 'c-b')}
      <div class="hs-row doz">Düzine: <b>${cnt((n) => n >= 1 && n <= 12)}</b> · <b>${cnt((n) => n >= 13 && n <= 24)}</b> · <b>${cnt((n) => n >= 25)}</b></div>
      <div class="hs-row"><span class="lbl">🔥 Sıcak</span>${hot.map(([n, c]) => ball(n, `<em>${c}</em>`)).join('')}</div>
      <div class="hs-row"><span class="lbl">❄️ Soğuk</span>${cold.map(([n, c]) => ball(n, `<em>${c}</em>`)).join('')}</div>`;
    grid.innerHTML = data.length
      ? data.map((d, i) => `<div class="hcell${i === 0 ? ' last' : ''}" title="Tur #${d.number}">${ball(Number(d.result))}<small>#${d.number}</small></div>`).join('')
      : '<div class="empty">Henüz biten tur yok.</div>';
  }

  closeHistory() { $('hist-back').hidden = true; $('hist-modal').hidden = true; }

  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }
}

// ─── Başlat ────────────────────────────────────────────────────────────────
async function main() {
  Sound.init();
  // Uygulama içinde ses dokunuş beklemeden açılabilir; tarayıcıda ilk
  // dokunuşta açılır.
  Sound.unlock();
  let engine;
  if (DEMO) {
    engine = new DemoEngine();
  } else {
    try {
      const { createClient } = await import(SUPABASE_JS);
      const client = createClient(SUPABASE.url, SUPABASE.anonKey, {
        auth: { persistSession: !APP_MODE, autoRefreshToken: true, detectSessionInUrl: false },
      });
      engine = new LiveEngine(client);
    } catch {
      $('gate').hidden = false;
      $('login').hidden = true;
      $('gate-text').textContent = 'Oyun yüklenemedi. İnternetini kontrol et.';
      $('retry').hidden = false;
      $('retry').onclick = () => location.reload();
      notifyApp('ready');
      return;
    }
  }
  const game = new Game(engine);
  window.__rulet = game;
  const ok = await engine.connect();
  if (ok) return;

  // Oturum yok
  $('gate').hidden = false;
  if (APP_MODE) {
    $('login').hidden = true;
    $('gate-text').textContent = 'Hesabına bağlanılamadı.';
    $('retry').hidden = false;
    $('retry').onclick = () => location.reload();
    game.markReady();
    return;
  }
  game.markReady();
  $('login').onsubmit = async (e) => {
    e.preventDefault();
    const res = await engine.signIn($('email').value.trim(), $('password').value);
    if (res.ok) $('gate').hidden = true;
    else $('gate-text').textContent = res.error || 'Giriş yapılamadı.';
  };
}

main();
