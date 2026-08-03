// Mirrors the C# DTOs in GroceryTracker.Core/Dtos exactly (property-for-property,
// PascalCase -> camelCase) — the API serializes with System.Text.Json's Web
// defaults, which use camelCase.

export interface Profile {
  id: string
  name: string
  createdAt: string
  tripCount: number
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
}

export interface TripItemLine {
  id: string
  itemId: string
  itemName: string
  categoryId: string
  categoryName: string
  price: number
}

export interface TripItemInput {
  itemName: string
  categoryId: string
  price: number
}

export interface Trip {
  id: string
  date: string
  storeId: string
  storeName: string
  items: TripItemLine[]
  total: number
}

export interface TripInput {
  date: string
  storeName: string
  items: TripItemInput[]
}

export interface TripSummary {
  id: string
  date: string
  storeId: string
  storeName: string
  itemCount: number
  total: number
}

export interface ListItemLine {
  id: string
  itemId: string
  itemName: string
  categoryId: string
  categoryName: string
  preferredStoreName: string | null
  checked: boolean
}

export interface ListItemInput {
  itemName: string
  categoryId: string
  preferredStoreName: string | null
  checked: boolean
}

export interface GroceryList {
  id: string
  name: string
  date: string | null
  stores: string[]
  items: ListItemLine[]
}

export interface GroceryListInput {
  name: string
  date: string | null
  stores: string[]
  items: ListItemInput[]
}

export interface TripLine {
  itemName: string
  categoryName: string
  price: number
}

export interface RecentTrip {
  id: string
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
  history: PurchasePoint[]
}

export interface Settings {
  themeMode: 'system' | 'light' | 'dark'
  currentProfileId: string | null
}
