import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ProblemTypes } from '../api/problemTypes'
import { classifyFailure } from './errors'

describe('classifyFailure', () => {
  it('treats a plain network error (not an ApiError) as transient', () => {
    expect(classifyFailure(new TypeError('Failed to fetch'), 'put')).toEqual({ kind: 'transient' })
  })

  it('treats a 404 on delete as success — the end state is already achieved', () => {
    const error = new ApiError(404, 'not found', ProblemTypes.TripNotFound)
    expect(classifyFailure(error, 'delete')).toEqual({ kind: 'delete-success' })
  })

  it('treats a 404 on put as permanent, not delete-success', () => {
    const error = new ApiError(404, 'not found', ProblemTypes.TripNotFound)
    expect(classifyFailure(error, 'put').kind).toBe('permanent')
  })

  it('treats any 5xx as transient', () => {
    const error = new ApiError(503, 'unavailable', ProblemTypes.Unexpected)
    expect(classifyFailure(error, 'put')).toEqual({ kind: 'transient' })
  })

  it('routes profile-not-found to orphaned', () => {
    const error = new ApiError(404, 'gone', ProblemTypes.ProfileNotFound)
    expect(classifyFailure(error, 'put')).toEqual({ kind: 'orphaned' })
  })

  it('routes category-name-conflict to auto-heal', () => {
    const error = new ApiError(409, 'conflict', ProblemTypes.CategoryNameConflict)
    expect(classifyFailure(error, 'put')).toEqual({ kind: 'auto-heal-category' })
  })

  it('routes cross-profile to permanent with a plain-language message', () => {
    const error = new ApiError(409, 'raw server text', ProblemTypes.CrossProfile)
    const outcome = classifyFailure(error, 'put')
    expect(outcome.kind).toBe('permanent')
    if (outcome.kind === 'permanent') {
      expect(outcome.message).not.toContain('raw server text')
      expect(outcome.message.toLowerCase()).toContain('different profile')
    }
  })

  it('falls back to the raw message for an unrecognized problem type', () => {
    const error = new ApiError(400, 'some new error the client has never seen', undefined)
    const outcome = classifyFailure(error, 'put')
    expect(outcome).toEqual({ kind: 'permanent', message: 'some new error the client has never seen' })
  })
})
