import crypto from 'node:crypto';

import type {
  CreateOrderRequest,
  MenuItem,
  OrderLine,
  OrderStatus,
  PersistedOrder,
  SyncState,
} from '../types.js';
import { fetchCsvRows } from './csv.js';
import { serverConfig } from './config.js';
import { getAdminMenu, getMenu } from './menu.js';
import { appStore } from './store.js';

class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const statusOrder = new Map<OrderStatus, number>([
  ['pending', 0],
  ['cooking', 1],
  ['ready', 2],
  ['served', 3],
]);

const formatMirrorTime = (value: string) =>
  new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const normaliseText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const sortOrders = (orders: PersistedOrder[]) =>
  [...orders].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

const mapLegacyStatus = (statusValue: string | undefined): OrderStatus => {
  const status = (statusValue ?? 'pending').trim().toLowerCase();

  if (status === 'aceptado' || status === 'cooking') {
    return 'cooking';
  }

  if (status === 'listo' || status === 'ready') {
    return 'ready';
  }

  if (status === 'entregado' || status === 'served') {
    return 'served';
  }

  return 'pending';
};

const mapLegacyMirrorStatus = (status: OrderStatus) => {
  switch (status) {
    case 'cooking':
      return 'aceptado';
    case 'ready':
      return 'listo';
    case 'served':
      return 'entregado';
    default:
      return 'pending';
  }
};

const buildSnapshotLine = (menuItem: MenuItem, quantity: number, notes?: string): OrderLine => ({
  id: crypto.randomUUID(),
  menuItemId: menuItem.id,
  name: menuItem.name,
  quantity,
  notes: notes?.trim() || undefined,
  unitPrice: menuItem.price,
  lineTotal: Number((menuItem.price * quantity).toFixed(2)),
});

const matchLegacyMenuItem = (menu: MenuItem[], requestedName: string) => {
  const normalisedName = normaliseText(requestedName);
  return menu.find((item) => normaliseText(item.name) === normalisedName) ?? null;
};

async function persistOrderSnapshot(order: PersistedOrder) {
  const nextStore = await appStore.update((currentStore) => ({
    ...currentStore,
    orders: sortOrders([order, ...currentStore.orders]),
  }));

  appStore.notifyOrdersChanged(nextStore.orders);
}

async function replaceStoredOrder(orderId: string, mapper: (currentOrder: PersistedOrder) => PersistedOrder) {
  let nextOrder: PersistedOrder | undefined;

  const nextStore = await appStore.update((currentStore) => {
    const orders = currentStore.orders.map((order) => {
      if (order.id !== orderId) {
        return order;
      }

      nextOrder = mapper(order);
      return nextOrder;
    });

    return {
      ...currentStore,
      orders: sortOrders(orders),
    };
  });

  if (!nextOrder) {
    throw new ServiceError('Pedido no encontrado.', 404);
  }

  appStore.notifyOrdersChanged(nextStore.orders);
  return nextOrder;
}

async function mirrorOrderToWebhook(order: PersistedOrder): Promise<SyncState> {
  if (!serverConfig.n8nWebhookUrl) {
    return 'local';
  }

  const payload = {
    Numero_pedido: order.id,
    numero_mesa: order.tableNumber,
    Pedido: order.items.map((item) => `${item.quantity}x ${item.name}`).join(', '),
    hora_pedido: formatMirrorTime(order.createdAt),
    hora_aceptado: order.acceptedAt ? formatMirrorTime(order.acceptedAt) : '',
    hora_entrega: order.readyAt ? formatMirrorTime(order.readyAt) : order.servedAt ? formatMirrorTime(order.servedAt) : '',
    estado: mapLegacyMirrorStatus(order.status),
    notas_especiales: order.items.map((item) => item.notes).filter(Boolean).join('. '),
    comensales: order.diners,
    total_pedido: order.totalPrice,
    email_valoracion: order.customerEmail || '',
    acepta_valoracion_email: order.reviewConsent,
    pedido_estructurado: order,
  };

  const response = await fetch(serverConfig.n8nWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`El webhook devolvió ${response.status}.`);
  }

  return 'mirrored';
}

async function setMirrorState(orderId: string, syncState: SyncState) {
  return replaceStoredOrder(orderId, (order) => ({
    ...order,
    syncState,
    lastUpdatedAt: new Date().toISOString(),
  }));
}

export async function seedLegacyOrdersFromSheetIfNeeded() {
  if (!serverConfig.legacyOrdersCsvUrl) {
    return;
  }

  const currentStore = await appStore.read();
  if (currentStore.orders.length > 0) {
    return;
  }

  try {
    const [rows, menu] = await Promise.all([fetchCsvRows(serverConfig.legacyOrdersCsvUrl), getMenu()]);
    const deduplicatedOrders = new Map<string, PersistedOrder>();

    rows.forEach((row) => {
      const id = row.numero_pedido?.trim();
      if (!id) {
        return;
      }

      const createdAt = row.hora_pedido
        ? `${new Date().toISOString().slice(0, 10)}T${row.hora_pedido}:00`
        : new Date().toISOString();

      const items = (row.pedido ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .map((entry) => {
          const match = entry.match(/^(\d+)\s*x\s+(.+)$/i);
          if (!match) {
            return null;
          }

          const quantity = Number.parseInt(match[1], 10);
          const name = match[2].trim();
          const menuItem = matchLegacyMenuItem(menu, name);

          return {
            id: crypto.randomUUID(),
            menuItemId: menuItem?.id ?? name,
            name,
            quantity,
            notes: row.notas_especiales || undefined,
            unitPrice: menuItem?.price ?? 0,
            lineTotal: Number(((menuItem?.price ?? 0) * quantity).toFixed(2)),
          } satisfies OrderLine;
        })
        .filter((item) => item !== null) as OrderLine[];

      if (items.length === 0) {
        return;
      }

      const status = mapLegacyStatus(row.estado);

      deduplicatedOrders.set(id, {
        id,
        tableNumber: row.numero_mesa || row.número_mesa || '?',
        clientName: row.cliente || 'Cliente',
        diners: Number.parseInt(row.comensales || '1', 10) || 1,
        reviewConsent: false,
        source: 'manual',
        status,
        items,
        totalPrice: Number.parseFloat(row.total_pedido || `${items.reduce((sum, item) => sum + item.lineTotal, 0)}`),
        createdAt,
        acceptedAt: row.hora_aceptado ? `${new Date().toISOString().slice(0, 10)}T${row.hora_aceptado}:00` : undefined,
        readyAt: status === 'ready' && row.hora_entrega ? `${new Date().toISOString().slice(0, 10)}T${row.hora_entrega}:00` : undefined,
        servedAt: status === 'served' && row.hora_entrega ? `${new Date().toISOString().slice(0, 10)}T${row.hora_entrega}:00` : undefined,
        lastUpdatedAt: new Date().toISOString(),
        syncState: 'mirrored',
      });
    });

    if (deduplicatedOrders.size === 0) {
      return;
    }

    const seededOrders = sortOrders(Array.from(deduplicatedOrders.values()));
    await appStore.update((currentStoreSnapshot) => ({
      ...currentStoreSnapshot,
      orders: seededOrders,
    }));
    appStore.notifyOrdersChanged(seededOrders);
  } catch (error) {
    console.error('[orders] No se pudieron importar pedidos legados:', error);
  }
}

export async function listOrders(tableNumber?: string) {
  const { orders } = await appStore.read();

  if (!tableNumber) {
    return sortOrders(orders);
  }

  return sortOrders(orders.filter((order) => order.tableNumber === tableNumber.trim()));
}

export async function createOrder(input: CreateOrderRequest) {
  const menu = await getAdminMenu();
  const menuById = new Map(menu.map((item) => [item.id, item]));

  const items = input.items.map((itemInput) => {
    const menuItem = menuById.get(itemInput.menuItemId);
    if (!menuItem) {
      throw new ServiceError(`El plato ${itemInput.menuItemId} no existe en carta.`, 400);
    }

    if (!menuItem.available) {
      throw new ServiceError(`El plato ${menuItem.name} no está disponible ahora mismo.`, 400);
    }

    return buildSnapshotLine(menuItem, itemInput.quantity, itemInput.notes);
  });

  if (items.length === 0) {
    throw new ServiceError('El pedido debe incluir al menos un plato.', 400);
  }

  const now = new Date().toISOString();
  const wantsReviewEmail = Boolean(input.reviewConsent);
  const trimmedCustomerEmail = input.customerEmail?.trim().toLowerCase() || '';
  const order: PersistedOrder = {
    id: crypto.randomUUID(),
    tableNumber: input.tableNumber.trim(),
    clientName: input.clientName?.trim() || 'Cliente',
    diners: input.diners,
    customerEmail: wantsReviewEmail && trimmedCustomerEmail ? trimmedCustomerEmail : undefined,
    reviewConsent: wantsReviewEmail && Boolean(trimmedCustomerEmail),
    source: input.source ?? 'manual',
    status: 'pending',
    items,
    totalPrice: Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)),
    createdAt: now,
    lastUpdatedAt: now,
    syncState: 'local',
  };

  await persistOrderSnapshot(order);

  try {
    const syncState = await mirrorOrderToWebhook(order);
    if (syncState !== order.syncState) {
      return await setMirrorState(order.id, syncState);
    }
  } catch (error) {
    console.error('[orders] No se pudo replicar el pedido en el webhook:', error);
    return await setMirrorState(order.id, 'mirror_failed');
  }

  return order;
}

export async function updateOrderStatus(orderId: string, nextStatus: OrderStatus) {
  const updatedOrder = await replaceStoredOrder(orderId, (currentOrder) => {
    const currentRank = statusOrder.get(currentOrder.status) ?? 0;
    const nextRank = statusOrder.get(nextStatus) ?? 0;

    if (nextRank < currentRank) {
      throw new ServiceError('No se puede mover el pedido a un estado anterior.', 400);
    }

    const now = new Date().toISOString();
    const nextOrder: PersistedOrder = {
      ...currentOrder,
      status: nextStatus,
      lastUpdatedAt: now,
      syncState: currentOrder.syncState === 'mirrored' ? 'mirrored' : 'local',
    };

    if (nextStatus === 'cooking' && !nextOrder.acceptedAt) {
      nextOrder.acceptedAt = now;
    }

    if (nextStatus === 'ready' && !nextOrder.readyAt) {
      nextOrder.readyAt = now;
    }

    if (nextStatus === 'served') {
      nextOrder.readyAt ??= now;
      nextOrder.servedAt = now;
    }

    return nextOrder;
  });

  try {
    const syncState = await mirrorOrderToWebhook(updatedOrder);
    if (syncState !== updatedOrder.syncState) {
      return await setMirrorState(updatedOrder.id, syncState);
    }
  } catch (error) {
    console.error('[orders] No se pudo replicar el estado en el webhook:', error);
    return await setMirrorState(updatedOrder.id, 'mirror_failed');
  }

  return updatedOrder;
}

export async function clearServedOrders() {
  const nextStore = await appStore.update((currentStore) => ({
    ...currentStore,
    orders: currentStore.orders.filter((order) => order.status !== 'served'),
  }));

  appStore.notifyOrdersChanged(nextStore.orders);
  return sortOrders(nextStore.orders);
}

export function toServiceError(error: unknown) {
  if (error instanceof ServiceError) {
    return error;
  }

  return new ServiceError('Se produjo un error inesperado en el servidor.', 500);
}
