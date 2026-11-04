function formatAbsolute(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Time unavailable'

  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).formatToParts(new Date(timestamp * 1000))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))

  return `${values.day} ${values.month}, ${values.hour}:${values.minute} ${values.dayPeriod} IST`
}

function formatAge(timestamp, now) {
  if (!Number.isFinite(timestamp)) return 'First failed time unavailable'

  const elapsedSeconds = Math.max(0, Math.floor(now - timestamp))
  if (elapsedSeconds < 60) return 'First failed just now'

  const units = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  const [unit, secondsPerUnit] = units.find(([, size]) => elapsedSeconds >= size)
  const count = Math.floor(elapsedSeconds / secondsPerUnit)
  return `First failed ${count} ${unit}${count === 1 ? '' : 's'} ago`
}

export function formatCaseTimes(providerTimestamp, receivedAt, now = Date.now() / 1000) {
  const receivedTimestamp = receivedAt ? Date.parse(receivedAt) / 1000 : NaN

  return {
    absolute: formatAbsolute(providerTimestamp),
    relative: formatAge(providerTimestamp, now),
    received: formatAbsolute(receivedTimestamp),
  }
}
