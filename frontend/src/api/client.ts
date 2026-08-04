import type {
  Category,
  DashboardSummary,
  GroceryList,
  GroceryListInput,
  Health,
  Item,
  ItemHistory,
  Profile,
  Settings,
  Store,
  Trip,
  TripInput,
  TripSummary,
} from './types'

const BASE = '/api/v1'

interface ProblemBody {
  type?: string
  title?: string
  status?: number
  detail?: string
}

export class ApiError extends Error {
  status: number
  // The backend's stable ProblemDetails `type` URI (e.g.
  // "/errors/trip-not-found"), when the response was one. The offline outbox's
  // failure classifier keys off this, not the bare HTTP status.
  problemType?: string

  constructor(status: number, message: string, problemType?: string) {
    super(message)
    this.status = status
    this.problemType = problemType
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/problem+json')) {
      const problem = (await response.json().catch(() => null)) as ProblemBody | null
      throw new ApiError(response.status, problem?.detail || problem?.title || response.statusText, problem?.type)
    }
    const text = await response.text().catch(() => response.statusText)
    throw new ApiError(response.status, text || response.statusText)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const get = <T>(path: string, init?: RequestInit) => request<T>(path, init)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const del = (path: string) => request<void>(path, { method: 'DELETE' })

export const api = {
  // Reachability probe — always `no-store` server-side. Callers pass a
  // signal to bound how long a probe can hang when the server is down.
  health: (signal?: AbortSignal) => get<Health>('/health', { signal }),

  profiles: {
    list: () => get<Profile[]>('/profiles'),
    create: (name: string) => post<Profile>('/profiles', { name }),
    // Idempotent create-or-rename at a caller-supplied id — what the offline
    // outbox targets, so a create can be composed while offline and safely
    // replayed. `.create` (POST) is unchanged and still server-assigns an id.
    upsert: (id: string, name: string) => put<Profile>(`/profiles/${id}`, { name }),
    delete: (id: string) => del(`/profiles/${id}`),
  },

  categories: {
    list: () => get<Category[]>('/categories'),
    create: (name: string) => post<Category>('/categories', { name }),
    upsert: (id: string, name: string) => put<Category>(`/categories/${id}`, { name }),
    delete: (id: string) => del(`/categories/${id}`),
  },

  settings: {
    get: () => get<Settings>('/settings'),
    update: (patch: Partial<Settings>) => put<Settings>('/settings', patch),
  },

  stores: (profileId: string) => ({
    search: (search?: string) =>
      get<Store[]>(`/profiles/${profileId}/stores${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  }),

  items: (profileId: string) => ({
    search: (search?: string) =>
      get<Item[]>(`/profiles/${profileId}/items${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    history: (itemId: string) => get<ItemHistory>(`/profiles/${profileId}/items/${itemId}/history`),
  }),

  dashboard: (profileId: string) => get<DashboardSummary>(`/profiles/${profileId}/dashboard`),

  trips: (profileId: string) => ({
    list: (from?: string, to?: string) => {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const qs = params.toString()
      return get<TripSummary[]>(`/profiles/${profileId}/trips${qs ? `?${qs}` : ''}`)
    },
    get: (tripId: string) => get<Trip>(`/profiles/${profileId}/trips/${tripId}`),
    create: (input: TripInput) => post<Trip>(`/profiles/${profileId}/trips`, input),
    // Idempotent create-or-replace at a caller-supplied id (see profiles.upsert).
    upsert: (tripId: string, input: TripInput) => put<Trip>(`/profiles/${profileId}/trips/${tripId}`, input),
    delete: (tripId: string) => del(`/profiles/${profileId}/trips/${tripId}`),
  }),

  lists: (profileId: string) => ({
    list: () => get<GroceryList[]>(`/profiles/${profileId}/lists`),
    get: (listId: string) => get<GroceryList>(`/profiles/${profileId}/lists/${listId}`),
    create: (input: GroceryListInput) => post<GroceryList>(`/profiles/${profileId}/lists`, input),
    upsert: (listId: string, input: GroceryListInput) =>
      put<GroceryList>(`/profiles/${profileId}/lists/${listId}`, input),
    delete: (listId: string) => del(`/profiles/${profileId}/lists/${listId}`),
  }),
}
