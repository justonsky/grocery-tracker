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
  // What those prices are per: an item ("each") or a pound ("lb"), for things bought by weight.
  priceUnit?: PriceUnit
  // The unit it was last bought in — the trip editor's default for a new line.
  unit?: QuantityUnit
}

export type QuantityUnit = 'each' | 'lb' | 'oz' | 'kg' | 'g'
export type PriceUnit = 'each' | 'lb'

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
  // How much the line bought (price stays the whole line's cost). Absent from older servers: 1 each.
  quantity?: number
  unit?: QuantityUnit
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
  // Omitted keeps the line's current quantity (1 each for a new line).
  quantity?: number
  unit?: QuantityUnit
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
  // Meals planned on the trip, in order. Absent on trips from servers that predate recipes.
  recipes?: TripRecipe[]
}

export interface TripRecipe {
  id: string
  name: string
  photoVersion: number
  itemCount: number
}

export interface TripInput {
  name: string | null
  date: string
  budget: number | null
  stores: string[]
  items: TripItemInput[]
  // Omitted keeps the trip's current status.
  status?: TripStatus
  // The planned meals' recipe ids; omitted leaves them as they are.
  recipeIds?: string[]
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
  // null for an item that hasn't been bought (yet).
  price: number | null
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

// Prices are household-wide. lastPrice is null for a pinned item nobody has bought.
export interface TrackedItem {
  itemId: string
  itemName: string
  categoryName: string
  lastPrice: number | null
  recentPrices: number[]
  trend: 'up' | 'down' | 'flat'
  deltaFromPrevious: number | null
  // lastPrice/recentPrices are per item, or per pound for things bought by weight.
  priceUnit?: PriceUnit
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
  // false while the grid follows recent purchases; true once items were added/removed.
  trackedItemsCustomized: boolean
  // Sum of this month's trip budgets (null if none has one) and what those trips cost.
  monthBudget: number | null
  monthBudgetSpent: number
  // The last 12 calendar months, oldest first; empty months are zero.
  monthlySpend: MonthlySpend[]
}

export interface MonthlySpend {
  month: string // yyyy-MM
  total: number
  count: number
}

export interface PurchasePoint {
  date: string
  storeName: string
  // Per the history's priceUnit (per item, or per pound).
  price: number
  // Compared with the previous purchase even if that one is outside the range.
  deltaFromPrevious: number | null
  lineId: string
  tripId: string
  profileName: string
  quantity?: number
  unit?: QuantityUnit
  // What the whole line cost.
  lineTotal?: number
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
  // Most recent first. Every statistic covers only purchases between from and to.
  history: PurchasePoint[]
  purchaseCount: number
  from: string | null
  to: string | null
  // Span of all the item's purchases, whatever the range.
  firstDate: string | null
  lastDate: string | null
  // Prices are per this; purchases in the other kind of unit (counted vs weighed) are left out.
  priceUnit?: PriceUnit
  otherUnitCount?: number
  // Both kinds when the item was bought both ways (the default first), to switch between them.
  availableUnits?: { priceUnit: PriceUnit; count: number }[]
}

// --- Items portal ---

export interface CatalogItem {
  id: string
  name: string
  defaultCategoryId: string | null
  categoryName: string
  // Every trip line using the item (planned too) vs. only priced ones.
  lineCount: number
  purchaseCount: number
  lastPurchased: string | null
  averagePrice: number | null
  priceUnit?: PriceUnit
}

export interface SaveItemRequest {
  name: string
  defaultCategoryId: string | null
}

export interface ItemLine {
  id: string
  tripId: string
  tripName: string | null
  tripDate: string
  tripStatus: TripStatus
  profileId: string
  profileName: string
  // The line's own store (null = any); effectiveStoreName falls back to the trip's first store.
  storeName: string | null
  effectiveStoreName: string | null
  checked: boolean
  price: number | null
  estimate: number | null
  priceLocked: boolean
  priceLocksAt: string | null
  quantity?: number
  unit?: QuantityUnit
}

export interface SaveItemLineRequest {
  tripId: string
  storeName: string | null
  price: number | null
  // Omitted keeps the line's quantity (1 each for a new line).
  quantity?: number
  unit?: QuantityUnit
  // Required to change a locked line.
  confirmLocked?: boolean
}

export interface MergeResult {
  moved: number
  sourceDeleted: boolean
}

export interface HouseholdTrip {
  id: string
  name: string | null
  date: string
  status: TripStatus
  profileId: string
  profileName: string
  stores: string[]
}

export interface Settings {
  themeMode: 'system' | 'light' | 'dark'
  // Share-card group backgrounds, keyed "store:aldi" / "category:produce";
  // "#rrggbb" or "none". Household-wide. See trips/shareGroups.ts.
  groupColors: Record<string, string>
  chartScheme: ChartScheme
}

export type ChartScheme = 'fresh' | 'citrus' | 'berry'

export interface Health {
  service: string
  instanceId: string
  appVersion: string
  serverTime: string
  status: string
}

export type TrendsRange = '30d' | '90d' | '180d' | '365d' | 'all'

export interface TrendItem {
  itemId: string
  name: string
  category: string
  timesBought: number
  spent: number
  averagePrice: number
  lastBought: string
}

export interface RisingItem {
  itemId: string
  name: string
  category: string
  recentCount: number
  earlierCount: number
  // How many times as often as earlier in the period; null = wasn't bought earlier at all.
  factor: number | null
}

export interface FadingItem {
  itemId: string
  name: string
  category: string
  earlierCount: number
  lastBought: string
  weeksSince: number
}

export interface CategorySpend {
  category: string
  spent: number
  lines: number
}

// from/to are inclusive dates; recentFrom..to is the "lately" window, the rest of the period "earlier".
export interface Trends {
  range: TrendsRange
  from: string
  to: string
  recentFrom: string
  tripCount: number
  itemCount: number
  spent: number
  previousTripCount: number | null
  previousSpent: number | null
  enoughData: boolean
  mostBought: TrendItem[]
  biggestSpend: TrendItem[]
  rising: RisingItem[]
  fading: FadingItem[]
  categories: CategorySpend[]
  // Absent on servers that predate recipes.
  popularRecipes?: TrendRecipe[]
  quietRecipes?: QuietRecipe[]
}

export interface RecipeItem {
  itemId: string
  itemName: string
  categoryId: string | null
  categoryName: string
  // Free text for the cook ("2 cups"); trips don't use it.
  amount: string | null
  averagePrice: number | null
  priceUnit?: PriceUnit
}

export interface Recipe {
  id: string
  name: string
  description: string | null
  // 0 = no photo; otherwise it is at recipePhotoUrl(id, photoVersion).
  photoVersion: number
  items: RecipeItem[]
  estimatedCost: number | null
  tripCount: number
  lastPlanned: string | null
}

export interface RecipeItemInput {
  itemName: string
  categoryId?: string | null
  amount?: string | null
}

export interface RecipeInput {
  name: string
  description: string | null
  items: RecipeItemInput[]
}

export interface TrendRecipe {
  recipeId: string
  name: string
  photoVersion: number
  timesPlanned: number
  lastPlanned: string
}

export interface QuietRecipe {
  recipeId: string
  name: string
  photoVersion: number
  earlierCount: number
  lastPlanned: string
  weeksSince: number
}
