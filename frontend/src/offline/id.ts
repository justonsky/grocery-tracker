// `crypto.randomUUID()` only exists in secure contexts (HTTPS or localhost).
// This app is designed to run over plain HTTP on a home network/Tailscale
// (see CLAUDE.md), so relying on it — with a Math.random().toString(36)
// fallback — silently produced non-GUID client ids that the backend's
// `{id:guid}` route constraints then rejected. `crypto.getRandomValues`,
// unlike `randomUUID`, is available without a secure context, so build a
// UUID v4 from that instead of falling back to a non-GUID shape.
function uuidV4FromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return uuidV4FromBytes(crypto.getRandomValues(new Uint8Array(16)))
  }
  const bytes = Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  return uuidV4FromBytes(bytes)
}
