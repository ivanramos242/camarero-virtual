export type OrderStatus = 'pending' | 'cooking' | 'ready' | 'served';
export type OrderSource = 'voice' | 'manual';
export type SyncState = 'local' | 'mirrored' | 'mirror_failed';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  allergens: string[];
  dietary: string[];
  available: boolean;
  ingredients: string[];
  imageUrl?: string | null;
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

export interface SessionTokenResponse {
  token: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  model: string;
  apiVersion: 'v1alpha';
}

export interface AppBranding {
  restaurantName: string;
  assistantName: string;
  kitchenName: string;
  tagline: string;
  supportManualOrdering: boolean;
  showDebugTools: boolean;
  voiceEnabled: boolean;
}

export interface SessionStatusResponse {
  authenticated: boolean;
  kitchenName: string;
}

export interface OrdersEventPayload {
  type: 'snapshot';
  orders: PersistedOrder[];
  tableNumber?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LogMessage {
  role: 'assistant' | 'system' | 'error';
  text: string;
  timestamp: number;
}
