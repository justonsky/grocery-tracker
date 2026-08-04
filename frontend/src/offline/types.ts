export type OutboxEntity = 'trip' | 'list' | 'profile' | 'category'
export type OutboxAction = 'put' | 'delete'
export type OutboxStatus = 'pending' | 'inflight' | 'failed' | 'blocked' | 'orphaned'

export interface OutboxError {
  httpStatus?: number
  problemType?: string
  detail: string
  at: number
}

export interface OutboxOp {
  // Absent until the record has been written once — idb assigns it via
  // autoIncrement, and it's the total drain order.
  seq?: number
  opId: string
  status: OutboxStatus
  entity: OutboxEntity
  action: OutboxAction
  entityId: string
  profileId: string | null
  // True if the server had never seen this entity when it was first queued —
  // distinguishes "delete an offline-only draft" (drop silently) from
  // "delete something the server already has" (queue a real delete).
  isCreate: boolean
  payload: unknown | null // Input DTO body; null for delete
  dependsOn: string[] // entityIds (e.g. a Category) that must land first
  attempts: number
  lastError: OutboxError | null
  createdAt: number
  updatedAt: number
  // Pre-rendered human description ("Trip at Aldi — Jul 28, 12 items") so the
  // failure dialog can describe an op whose target no longer exists in any
  // query cache.
  label: string
}
