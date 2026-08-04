import { ApiError } from '../api/client'
import { ProblemTypes } from '../api/problemTypes'
import type { OutboxAction } from './types'

export type FailureOutcome =
  | { kind: 'transient' }
  | { kind: 'delete-success' }
  | { kind: 'orphaned' }
  | { kind: 'auto-heal-category' }
  | { kind: 'permanent'; message: string }

// Plain-language messages for the failure dialog — the user must never see a
// raw status code or a ProblemDetails type string.
const PLAIN_LANGUAGE: Record<string, string> = {
  [ProblemTypes.CrossProfile]: "This belongs to a different profile and can't be merged automatically.",
  [ProblemTypes.Validation]: "Something about this change wasn't valid.",
  [ProblemTypes.CategoryBuiltIn]: "Built-in categories can't be changed.",
  [ProblemTypes.TripNotFound]: 'This trip no longer exists.',
  [ProblemTypes.ListNotFound]: 'This list no longer exists.',
  [ProblemTypes.ItemNotFound]: 'This item no longer exists.',
  [ProblemTypes.CategoryNotFound]: 'This category no longer exists.',
  [ProblemTypes.DbUpdate]: 'Your home server had a database problem saving this.',
  [ProblemTypes.Unexpected]: 'An unexpected error occurred on your home server.',
}

// Classifies a failed sync attempt into what the drainer should do next.
// Keys off ApiError.problemType (the backend's stable ProblemDetails `type`),
// not the bare HTTP status — see client.ts and backend/ProblemTypes.cs.
export function classifyFailure(error: unknown, action: OutboxAction): FailureOutcome {
  if (!(error instanceof ApiError)) {
    // fetch throws a plain TypeError for network failures/aborts/timeouts —
    // indistinguishable from "server is down," which is exactly transient.
    return { kind: 'transient' }
  }

  if (action === 'delete' && error.status === 404) {
    return { kind: 'delete-success' }
  }

  if (error.status >= 500) {
    return { kind: 'transient' }
  }

  if (error.problemType === ProblemTypes.ProfileNotFound) {
    return { kind: 'orphaned' }
  }

  if (error.problemType === ProblemTypes.CategoryNameConflict) {
    return { kind: 'auto-heal-category' }
  }

  const message = (error.problemType && PLAIN_LANGUAGE[error.problemType]) || error.message || 'This change was rejected.'
  return { kind: 'permanent', message }
}
