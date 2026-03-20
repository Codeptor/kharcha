export function vibrate(ms: number | number[] = 10) {
  try {
    navigator?.vibrate?.(ms)
  } catch {}
}

export function tickVibrate() {
  vibrate(5)
}

export function selectVibrate() {
  vibrate([10, 30, 10])
}

export function deselectVibrate() {
  vibrate(8)
}

export function syncVibrate() {
  vibrate([15, 50, 15, 50, 15])
}

export function toggleVibrate() {
  vibrate(12)
}
