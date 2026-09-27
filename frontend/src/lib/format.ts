export function formatDateTime(ms: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(ms: number, now = Date.now()) {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
