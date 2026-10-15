// Mirrors the C# DTOs in GroceryTracker.Core/Dtos exactly (property-for-property,
// PascalCase -> camelCase) — the API serializes with System.Text.Json's Web
// defaults, which use camelCase.

export interface Profile {
  id: string
  name: string
  createdAt: string
  tripCount: number
  // Color theme id (see app/themes.ts); unknown ids fall back to the default.
  theme: string
}

export interface Category {
  id: string
  name: string
  isBuiltIn: boolean
  sortOrder: number
}

export interface Store {
  id: string
  name: string
}

export interface Item {
  id: string
  name: string
  defaultCategoryId: string | null
  // Most recently paid and mean paid price; both null when never purchased.
  // averagePrice backs the trip editor's "fill estimates" button.
  lastPrice: number | null
  averagePrice: number | null
}

// planned: a shopping list, nothing bought yet. shopping: in the store.
// done: the shop is over and the trip is history.
export type TripStatus = 'planned' | 'shopping' | 'done'

export interface TripItemLine {
  id: string
  itemId: string
  itemName: string
  categoryId: string
  categoryName: string
  // null = "any store"
  storeName: string | null
  // Whether the item has actually been picked up.
  checked: boolean
  // null until the item is actually bought — a planned item has no price yet.
  price: number | null
  // What the shopper expects to pay; null = no estimate.
  estimate: number | null
  // When the line becomes read-only (7 days after its price was first entered);
  // null while there is no price. priceLocked is the server's verdict right now.
  priceLocksAt: string | null
  priceLocked: boolean
}

export interface TripItemInput {
  // The existing line's id when editing; null/absent for a new line. Lets the
  // server tell an edited line from a removed-and-re-added one.
  id?: string | null
  itemName: string
  categoryId: string
  storeName: string | null
  checked: boolean
  price: number | null
  estimate?: number | null
}

export interface Trip {
  id: string
  // Optional label ("Weekly stock-up"); falls back to the date in the UI.
  name: string | null
  date: string
  budget: number | null
  stores: string[]
  items: TripItemLine[]
  total: number
  status: TripStatus
  completedAt: string | null
  estimatedTotal: number
  // Estimate minus price over lines that have both; positive = under estimate.
  // null when no line has both.
  savings: number | null
}

export interface TripInput {
  name: string | null
  date: string
  budget: number | null
  stores: string[]
  items: TripItemInput[]
  // Omitted keeps the trip's current status.
  status?: TripStatus
}

export interface TripSummary {
  id: string
  name: string | null
  date: string
  stores: string[]
  itemCount: number
  checkedCount: number
  total: number
  budget: number | null
  status: TripStatus
  estimatedTotal: number
  savings: number | null
}

export interface TripLine {
  itemName: string
  categoryName: string
  price: number
}

export interface RecentTrip {
  id: string
  name: string | null
  date: string
  storeName: string
  itemCount: number
  total: number
  items: TripLine[]
}

export interface TrackedItem {
  itemId: string
  itemName: string
  categoryName: string
  lastPrice: number
  recentPrices: number[]
  trend: 'up' | 'down' | 'flat'
  deltaFromPrevious: number | null
}

export interface DashboardSummary {
  todaySpend: number
  todayCount: number
  monthSpend: number
  monthCount: number
  yearSpend: number
  yearCount: number
  recentTrip: RecentTrip | null
  trackedItems: TrackedItem[]
}

export interface PurchasePoint {
  date: string
  storeName: string
  price: number
  deltaFromPrevious: number | null
}

export interface ItemHistory {
  itemId: string
  itemName: string
  categoryName: string
  current: number
  lowest: number
  lowestMeta: string
  highest: number
  highestMeta: string
  average: number
  variance: number
  variancePct: number
  history: PurchasePoint[]
}

export interface Settings {
  themeMode: 'system' | 'light' | 'dark'
}

export interface Health {
  service: string
  instanceId: string
  appVersion: string
  serverTime: string
  status: string
}
