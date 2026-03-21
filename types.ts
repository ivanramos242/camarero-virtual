export type OrderStatus = 'pending' | 'cooking' | 'ready' | 'served';
export type OrderSource = 'voice' | 'manual';
export type SyncState = 'local' | 'mirrored' | 'mirror_failed';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  sortOrder?: number;
  allergens: string[];
  dietary: string[];
  available: boolean;
  ingredients: string[];
  imageUrl?: string | null;
}

export interface MenuMetadata {
  lastUpdatedAt: string | null;
  lastUpdatedBy: 'system' | 'admin' | 'legacy_import' | null;
}

export interface CartItem {
  id: string;
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
  timestamp: string;
}

export interface OrderLine {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  notes?: string;
  unitPrice: number;
  lineTotal: number;
}

export interface PersistedOrder {
  id: string;
  tableNumber: string;
  clientName: string;
  diners: number;
  source: OrderSource;
  status: OrderStatus;
  items: OrderLine[];
  totalPrice: number;
  createdAt: string;
  acceptedAt?: string;
  readyAt?: string;
  servedAt?: string;
  lastUpdatedAt: string;
  syncState: SyncState;
}

export interface CreateOrderItemInput {
  menuItemId: string;
  quantity: number;
  notes?: string;
}

export interface CreateOrderRequest {
  tableNumber: string;
  clientName?: string;
  diners: number;
  items: CreateOrderItemInput[];
  source?: OrderSource;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
}

export interface GeminiSessionTokenResponse {
  provider: 'gemini';
  token: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  model: string;
  apiVersion: 'v1alpha';
}

export interface OpenAiSessionTokenResponse {
  provider: 'openai';
  mode: 'unified';
  model: string;
  endpoint: string;
  voice: string;
}

export type SessionTokenResponse = GeminiSessionTokenResponse | OpenAiSessionTokenResponse;

export interface AppBranding {
  restaurantName: string;
  assistantName: string;
  kitchenName: string;
  tagline: string;
  supportManualOrdering: boolean;
  showDebugTools: boolean;
  voiceEnabled: boolean;
  voiceProvider: 'gemini' | 'openai' | 'none';
}

export interface SessionStatusResponse {
  authenticated: boolean;
  kitchenName: string;
}

export interface AdminSessionStatusResponse {
  authenticated: boolean;
  restaurantName: string;
}

export interface OrdersEventPayload {
  type: 'snapshot';
  orders: PersistedOrder[];
  tableNumber?: string;
}

export interface MenuEventPayload {
  type: 'snapshot';
  menu: MenuItem[];
}

export interface MenuItemInput {
  name: string;
  description?: string;
  price: number;
  category: string;
  sortOrder?: number;
  allergens?: string[];
  dietary?: string[];
  available?: boolean;
  ingredients?: string[];
  imageUrl?: string | null;
}

export interface CreateMenuItemRequest extends MenuItemInput {}

export interface UpdateMenuItemRequest extends Partial<MenuItemInput> {}

export interface UpdateMenuItemAvailabilityRequest {
  available: boolean;
}

export interface ReorderMenuItem {
  id: string;
  sortOrder: number;
}

export interface ReorderMenuRequest {
  items: ReorderMenuItem[];
}

export interface UploadImageResponse {
  imageUrl: string;
}

export interface AdminTable {
  id: string;
  number: string;
  label?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminTableRequest {
  number: string;
  label?: string;
}

export interface UpdateAdminTableRequest {
  number?: string;
  label?: string;
}

export interface UpdateAdminTableStatusRequest {
  active: boolean;
}

export interface PrintTableQrRequest {
  origin: string;
}

export interface TableQrResponse {
  table: AdminTable;
  qrSvg: string;
  qrUrl: string;
}

export interface PrintTablesQrRequest {
  origin: string;
  tableIds: string[];
}

export interface TablesQrBatchResponse {
  items: TableQrResponse[];
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LogMessage {
  role: 'assistant' | 'system' | 'error';
  text: string;
  timestamp: number;
}
