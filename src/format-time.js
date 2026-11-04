export function formatProviderTime(timestamp) {
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
