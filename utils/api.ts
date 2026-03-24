import type {
  AdminTable,
  AdminSettings,
  AdminSessionStatusResponse,
  AppBranding,
  CreateAdminTableRequest,
  CreateMenuItemRequest,
  CreateOrderRequest,
  MenuItem,
  MenuEventPayload,
  OrdersEventPayload,
  PrintTableQrRequest,
  PrintTablesQrRequest,
  PersistedOrder,
  ReorderMenuRequest,
  SessionStatusResponse,
  SessionTokenResponse,
  TableQrResponse,
  TablesQrBatchResponse,
  UploadImageResponse,
  VoiceDiagnosticsResponse,
  UpdateAdminTableRequest,
  UpdateAdminTableStatusRequest,
  UpdateAdminSettingsRequest,
  UpdateMenuItemAvailabilityRequest,
  UpdateMenuItemRequest,
  UpdateOrderStatusRequest,
} from '../types';

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = 'La solicitud no se pudo completar.';

    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      if (response.statusText) {
        message = response.statusText;
      }
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function fetchPublicConfig() {
  return request<AppBranding>('/api/config', {
    method: 'GET',
  });
}

export async function fetchMenuFromApi() {
  return request<MenuItem[]>('/api/menu', {
    method: 'GET',
  });
}

export async function fetchAdminMenuFromApi() {
  return request<MenuItem[]>('/api/admin/menu', {
    method: 'GET',
  });
}

export async function fetchAdminTablesFromApi() {
  return request<AdminTable[]>('/api/admin/tables', {
    method: 'GET',
  });
}

export async function fetchAdminSettingsFromApi() {
  return request<AdminSettings>('/api/admin/settings', {
    method: 'GET',
  });
}

export async function updateAdminSettingsOnApi(payload: UpdateAdminSettingsRequest) {
  return request<AdminSettings>('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function fetchOrdersFromApi(tableNumber?: string) {
  const query = tableNumber ? `?table=${encodeURIComponent(tableNumber)}` : '';
  return request<PersistedOrder[]>(`/api/orders${query}`, {
    method: 'GET',
  });
}

export async function fetchAdminOrdersFromApi() {
  return request<PersistedOrder[]>('/api/admin/orders', {
    method: 'GET',
  });
}

export async function createOrderOnApi(payload: CreateOrderRequest) {
  return request<PersistedOrder>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateOrderStatusOnApi(orderId: string, payload: UpdateOrderStatusRequest) {
  return request<PersistedOrder>(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function fetchKitchenSession() {
  return request<SessionStatusResponse>('/api/auth/session', {
    method: 'GET',
  });
}

export async function fetchAdminSession() {
  return request<AdminSessionStatusResponse>('/api/admin/auth/session', {
    method: 'GET',
  });
}

export async function loginKitchen(password: string) {
  return request<void>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function loginAdmin(password: string) {
  return request<void>('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function logoutKitchen() {
  return request<void>('/api/auth/logout', {
    method: 'POST',
  });
}

export async function logoutAdmin() {
  return request<void>('/api/admin/auth/logout', {
    method: 'POST',
  });
}

export async function createAdminMenuItemOnApi(payload: CreateMenuItemRequest) {
  return request<MenuItem[]>('/api/admin/menu/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createAdminTableOnApi(payload: CreateAdminTableRequest) {
  return request<AdminTable[]>('/api/admin/tables', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminTableOnApi(tableId: string, payload: UpdateAdminTableRequest) {
  return request<AdminTable[]>(`/api/admin/tables/${encodeURIComponent(tableId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminTableStatusOnApi(tableId: string, payload: UpdateAdminTableStatusRequest) {
  return request<AdminTable[]>(`/api/admin/tables/${encodeURIComponent(tableId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminTableOnApi(tableId: string) {
  return request<AdminTable[]>(`/api/admin/tables/${encodeURIComponent(tableId)}`, {
    method: 'DELETE',
  });
}

export async function fetchAdminTableQrFromApi(tableId: string, payload: PrintTableQrRequest) {
  const query = `?origin=${encodeURIComponent(payload.origin)}`;
  return request<TableQrResponse>(`/api/admin/tables/${encodeURIComponent(tableId)}/qr${query}`, {
    method: 'GET',
  });
}

export async function fetchAdminTablesQrBatchFromApi(payload: PrintTablesQrRequest) {
  return request<TablesQrBatchResponse>('/api/admin/tables/print-batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminMenuItemOnApi(itemId: string, payload: UpdateMenuItemRequest) {
  return request<MenuItem[]>(`/api/admin/menu/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminMenuItemAvailabilityOnApi(itemId: string, payload: UpdateMenuItemAvailabilityRequest) {
  return request<MenuItem[]>(`/api/admin/menu/items/${encodeURIComponent(itemId)}/availability`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminMenuItemOnApi(itemId: string) {
  return request<MenuItem[]>(`/api/admin/menu/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  });
}

export async function reorderAdminMenuOnApi(payload: ReorderMenuRequest) {
  return request<MenuItem[]>('/api/admin/menu/reorder', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function uploadAdminImageOnApi(file: File) {
  const formData = new FormData();
  formData.append('image', file);

  return request<UploadImageResponse>('/api/admin/uploads/image', {
    method: 'POST',
    body: formData,
  });
}

export async function createVoiceSessionToken() {
  return request<SessionTokenResponse>('/api/session/token', {
    method: 'POST',
  });
}

export async function fetchVoiceDiagnostics() {
  return request<VoiceDiagnosticsResponse>('/api/debug/voice', {
    method: 'GET',
  });
}

export async function createOpenAiRealtimeAnswer(endpoint: string, sdpOffer: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
    },
    body: sdpOffer,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'No se pudo abrir la sesion de OpenAI.');
  }

  return response.text();
}

export function createOrdersEventSource(tableNumber?: string) {
  const query = tableNumber ? `?table=${encodeURIComponent(tableNumber)}` : '';
  return new EventSource(`/api/orders/events${query}`);
}

export function createMenuEventSource(scope: 'public' | 'admin' = 'public') {
  const query = scope === 'admin' ? '?scope=admin' : '';
  return new EventSource(`/api/menu/events${query}`);
}

export function parseOrdersEvent(rawValue: string) {
  return JSON.parse(rawValue) as OrdersEventPayload;
}

export function parseMenuEvent(rawValue: string) {
  return JSON.parse(rawValue) as MenuEventPayload;
}
