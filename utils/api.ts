import type {
  AppBranding,
  CreateOrderRequest,
  MenuItem,
  OrdersEventPayload,
  PersistedOrder,
  SessionStatusResponse,
  SessionTokenResponse,
  UpdateOrderStatusRequest,
} from '../types';

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
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

export async function fetchOrdersFromApi(tableNumber?: string) {
  const query = tableNumber ? `?table=${encodeURIComponent(tableNumber)}` : '';
  return request<PersistedOrder[]>(`/api/orders${query}`, {
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

export async function loginKitchen(password: string) {
  return request<void>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function logoutKitchen() {
  return request<void>('/api/auth/logout', {
    method: 'POST',
  });
}

export async function createVoiceSessionToken() {
  return request<SessionTokenResponse>('/api/session/token', {
    method: 'POST',
  });
}

export function createOrdersEventSource(tableNumber?: string) {
  const query = tableNumber ? `?table=${encodeURIComponent(tableNumber)}` : '';
  return new EventSource(`/api/orders/events${query}`);
}

export function parseOrdersEvent(rawValue: string) {
  return JSON.parse(rawValue) as OrdersEventPayload;
}
