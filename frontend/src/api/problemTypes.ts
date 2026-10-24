// Mirrors backend/GroceryTracker.Api/ProblemTypes.cs exactly. Kept manually in
// sync (no shared package between the two projects) — the offline outbox's
// failure classifier and plain-language error map key off these strings.
export const ProblemTypes = {
  ProfileNotFound: '/errors/profile-not-found',
  TripNotFound: '/errors/trip-not-found',
  ItemNotFound: '/errors/item-not-found',
  ItemNameConflict: '/errors/item-name-conflict',
  TripItemNotFound: '/errors/trip-item-not-found',
  CategoryNotFound: '/errors/category-not-found',
  CategoryNameConflict: '/errors/category-name-conflict',
  CategoryBuiltIn: '/errors/category-built-in',
  CrossProfile: '/errors/cross-profile',
  PriceLocked: '/errors/price-locked',
  RecipeNotFound: '/errors/recipe-not-found',
  PhotoTooLarge: '/errors/photo-too-large',
  ReceiptNotFound: '/errors/receipt-not-found',
  ReceiptApplied: '/errors/receipt-applied',
  TooManyReceipts: '/errors/too-many-receipts',
  ReceiptsNotConfigured: '/errors/receipts-not-configured',
  ReceiptsDisabled: '/errors/receipts-disabled',
  ReceiptUnreadable: '/errors/receipt-unreadable',
  AliasConflict: '/errors/alias-conflict',
  Validation: '/errors/validation',
  RouteNotFound: '/errors/route-not-found',
  DbUpdate: '/errors/db-update',
  Unexpected: '/errors/unexpected',
} as const
