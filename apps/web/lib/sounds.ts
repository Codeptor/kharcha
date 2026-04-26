let ctx: AudioContext | null = null

function getCtx() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === "suspended") ctx.resume()
  return ctx
}

function tickDown() {
  const c = getCtx()
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = "sine"
  osc.frequency.setValueAtTime(350, t)
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.035)
  gain.gain.setValueAtTime(0.24, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.045)
}

function tickUp() {
  const c = getCtx()
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = "sine"
  osc.frequency.setValueAtTime(120, t)
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.03)
  gain.gain.setValueAtTime(0.2, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.04)
}

export function tickSound(_ratio = 0.5) {
  try { tickDown() } catch {}
}

function cellChirp(ratio: number) {
  const c = getCtx()
  const t = c.currentTime
  const r = Math.max(0, Math.min(1, ratio))
  const base = 520 + r * 720
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = "triangle"
  osc.frequency.setValueAtTime(base, t)
  osc.frequency.exponentialRampToValueAtTime(base * 1.18, t + 0.02)
  gain.gain.setValueAtTime(0.12 + r * 0.06, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.06)
}

export function cellSound(ratio = 0.5) {
  try { cellChirp(ratio) } catch {}
}

function clickNoise() {
  const c = getCtx()
  const t = c.currentTime
  const src = c.createBufferSource()
  const buf = c.createBuffer(1, 0.006 * c.sampleRate, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (2 * Math.random() - 1) * Math.exp(-i / 40)
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = "bandpass"
  filter.frequency.value = 4000 + 800 * Math.random()
  filter.Q.value = 2.5
  const gain = c.createGain()
  gain.gain.value = 0.32
  src.connect(filter)
  filter.connect(gain)
  gain.connect(c.destination)
  src.start(t)
}

export function bootSound() {
  try { clickNoise() } catch {}
}

export function selectSound() {
  try { clickNoise() } catch {}
}

export function deselectSound() {
  try { clickNoise() } catch {}
}

export function syncStartSound() {
  try {
    tickUp()
    setTimeout(() => tickUp(), 80)
  } catch {}
}

export function syncDoneSound() {
  try {
    tickUp()
    setTimeout(() => tickUp(), 100)
    setTimeout(() => tickUp(), 200)
  } catch {}
}

export function toggleSound() {
  try { tickDown() } catch {}
}

export function enterSound() {
  try { tickUp() } catch {}
}

export function exitSound() {
  try { tickDown() } catch {}
}
