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
  voiceAliases?: string[];
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
  requestId?: string;
  tableNumber: string;
  clientName: string;
  diners: number;
  customerEmail?: string;
  reviewConsent: boolean;
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
  requestId?: string;
  tableNumber: string;
  clientName?: string;
  diners: number;
  customerEmail?: string;
  reviewConsent?: boolean;
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
  showWifiPopup: boolean;
  wifiSsid: string;
  wifiPassword: string;
}

export interface AdminSettings {
  showWifiPopup: boolean;
  wifiSsid: string;
  wifiPassword: string;
}

export interface UpdateAdminSettingsRequest {
  showWifiPopup: boolean;
  wifiSsid: string;
  wifiPassword: string;
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
  voiceAliases?: string[];
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
export type VoiceTurnState = 'idle' | 'recording' | 'processing' | 'speaking' | 'error';

export interface LogMessage {
  role: 'assistant' | 'system' | 'error';
  text: string;
  timestamp: number;
}

export interface VoiceDiagnosticsResponse {
  provider: 'gemini' | 'openai' | 'none';
  geminiConfigured: boolean;
  openAiConfigured: boolean;
  configuredModel?: string;
  tokenCheck: {
    ok: boolean;
    message: string;
  };
  liveCheck: {
    ok: boolean;
    message: string;
  };
}

export interface VoiceMatchCandidate {
  menuItemId: string;
  name: string;
  confidence: number;
  score: number;
  matchedOn: string;
}

export interface VoiceTraceEntry {
  id: string;
  timestamp: string;
  tableNumber: string;
  transcript: string;
  assistantMessage: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result?: {
      success?: boolean;
      message?: string;
      error?: string;
      reason?: string;
      requiresClarification?: boolean;
      candidates?: VoiceMatchCandidate[];
    };
  }>;
  resolution: {
    action: 'add' | 'remove' | 'confirm' | 'unknown';
    requiresClarification: boolean;
    fallbackUsed: boolean;
    mutatedCart: boolean;
    confirmationPending: boolean;
    reason?: string;
    candidates: VoiceMatchCandidate[];
  };
}
