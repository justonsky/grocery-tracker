// Mirrors backend/GroceryTracker.Api/ProblemTypes.cs exactly. Kept manually in
// sync (no shared package between the two projects) — the offline outbox's
// failure classifier and plain-language error map key off these strings.
export const ProblemTypes = {
  ProfileNotFound: '/errors/profile-not-found',
  TripNotFound: '/errors/trip-not-found',
  ListNotFound: '/errors/list-not-found',
  ItemNotFound: '/errors/item-not-found',
  CategoryNotFound: '/errors/category-not-found',
  CategoryNameConflict: '/errors/category-name-conflict',
  CategoryBuiltIn: '/errors/category-built-in',
  CrossProfile: '/errors/cross-profile',
  Validation: '/errors/validation',
  DbUpdate: '/errors/db-update',
  Unexpected: '/errors/unexpected',
} as const
