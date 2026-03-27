import React, { useMemo, useState } from 'react';
import {
  BadgeCheck,
  ChefHat,
  CircleAlert,
  Clock3,
  Loader2,
  LogOut,
  Mail,
  PackageCheck,
  ReceiptText,
  RefreshCcw,
  SendHorizontal,
  Soup,
  Table2,
  TriangleAlert,
  Users,
} from 'lucide-react';

import type { OrderStatus, PersistedOrder } from '../types';

interface KitchenDashboardProps {
  orders: PersistedOrder[];
  restaurantName: string;
  kitchenName: string;
  isLoading: boolean;
  errorMessage?: string | null;
  pendingOrderIds: string[];
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onLogout: () => void;
  onRefresh: () => void;
}

const filterOptions = [
  { value: 'active', label: 'Activos' },
  { value: 'completed', label: 'Completados' },
] as const;

const statusDescriptions: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  cooking: 'En cocina',
  ready: 'Listo para salir',
  served: 'Entregado',
};

const nextActionByStatus: Partial<Record<OrderStatus, { label: string; status: OrderStatus }>> = {
  pending: { label: 'Confirmar pedido', status: 'cooking' },
  cooking: { label: 'Marcar listo', status: 'ready' },
  ready: { label: 'Confirmar salida', status: 'served' },
};

const statusStyles: Record<
  OrderStatus,
  {
    badge: string;
    card: string;
    column: string;
    columnCount: string;
    strip: string;
    action: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }
> = {
  pending: {
    badge: 'border-amber-300 bg-amber-100 text-amber-950',
    card: 'border-amber-200 bg-white',
    column: 'border-amber-200 bg-amber-50/60',
    columnCount: 'text-amber-800',
    strip: 'bg-amber-500',
    action: 'bg-amber-600 hover:bg-amber-700',
    icon: CircleAlert,
  },
  cooking: {
    badge: 'border-orange-300 bg-orange-100 text-orange-950',
    card: 'border-orange-200 bg-white',
    column: 'border-orange-200 bg-orange-50/60',
    columnCount: 'text-orange-800',
    strip: 'bg-orange-500',
    action: 'bg-orange-600 hover:bg-orange-700',
    icon: Soup,
  },
  ready: {
    badge: 'border-emerald-300 bg-emerald-100 text-emerald-950',
    card: 'border-emerald-200 bg-white',
    column: 'border-emerald-200 bg-emerald-50/60',
    columnCount: 'text-emerald-800',
    strip: 'bg-emerald-500',
    action: 'bg-emerald-600 hover:bg-emerald-700',
    icon: BadgeCheck,
  },
  served: {
    badge: 'border-stone-300 bg-stone-100 text-stone-700',
    card: 'border-stone-200 bg-white',
    column: 'border-stone-300 bg-stone-100/80',
    columnCount: 'text-stone-700',
    strip: 'bg-stone-400',
    action: 'bg-stone-500 hover:bg-stone-600',
    icon: PackageCheck,
  },
};

const boardColumns: Array<{ status: OrderStatus; label: string }> = [
  { status: 'pending', label: 'Pendiente' },
  { status: 'cooking', label: 'En cocina' },
  { status: 'ready', label: 'Listo' },
  { status: 'served', label: 'Entregado' },
];

const priorityThresholds = {
  warning: 12,
  urgent: 20,
};

function getOrderAgeMinutes(createdAt: string) {
  return Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
}

function getOrderPriority(order: PersistedOrder) {
  const ageMinutes = getOrderAgeMinutes(order.createdAt);

  if (order.status === 'served') {
    return {
      ageMinutes,
      label: 'Cerrado',
      tone: 'border-stone-200 bg-stone-100 text-stone-700',
      cardRing: '',
      icon: PackageCheck,
    };
  }

  if (ageMinutes >= priorityThresholds.urgent) {
    return {
      ageMinutes,
      label: 'Urgente',
      tone: 'border-red-300 bg-red-100 text-red-800',
      cardRing: 'ring-2 ring-red-200',
      icon: TriangleAlert,
    };
  }

  if (ageMinutes >= priorityThresholds.warning) {
    return {
      ageMinutes,
      label: 'Atencion',
      tone: 'border-amber-300 bg-amber-100 text-amber-900',
      cardRing: 'ring-2 ring-amber-200',
      icon: Clock3,
    };
  }

  return {
    ageMinutes,
    label: 'En tiempo',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    cardRing: '',
    icon: Clock3,
  };
}

function formatTime(value?: string) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function orderSortValue(order: PersistedOrder) {
  if (order.status === 'served') {
    return new Date(order.createdAt).getTime();
  }

  return getOrderAgeMinutes(order.createdAt) * -1;
}

const KitchenDashboard: React.FC<KitchenDashboardProps> = ({
  orders,
  restaurantName,
  kitchenName,
  isLoading,
  errorMessage,
  pendingOrderIds,
  onUpdateStatus,
  onLogout,
  onRefresh,
}) => {
  const [filterMode, setFilterMode] = useState<(typeof filterOptions)[number]['value']>('active');

  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (filterMode === 'active') {
          return order.status !== 'served';
        }

        return order.status === 'served';
      }),
    [filterMode, orders],
  );

  const groupedOrders = useMemo(
    () =>
      boardColumns.map((column) => ({
        ...column,
        orders: filteredOrders
          .filter((order) => order.status === column.status)
          .sort((left, right) => orderSortValue(left) - orderSortValue(right)),
      })),
    [filteredOrders],
  );

  const stats = useMemo(() => {
    const activeOrders = orders.filter((order) => order.status !== 'served').length;
    const readyOrders = orders.filter((order) => order.status === 'ready').length;
    const pendingOrders = orders.filter((order) => order.status === 'pending').length;

    const finishedOrders = orders.filter((order) => order.readyAt || order.servedAt);
    const averageReadyMinutes =
      finishedOrders.length === 0
        ? 0
        : Math.round(
            finishedOrders.reduce((sum, order) => {
              const endDate = order.readyAt ?? order.servedAt ?? order.createdAt;
              return sum + (new Date(endDate).getTime() - new Date(order.createdAt).getTime()) / 60000;
            }, 0) / finishedOrders.length,
          );

    return {
      activeOrders,
      readyOrders,
      pendingOrders,
      averageReadyMinutes,
    };
  }, [orders]);

  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-xl border border-stone-300 bg-stone-50 shadow-sm">
          <header className="flex flex-col gap-4 border-b border-stone-300 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-stone-900 text-white">
                <ChefHat size={18} />
              </span>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-stone-950">{kitchenName}</h1>
                <p className="text-sm text-stone-600">{restaurantName}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
              >
                <RefreshCcw size={16} />
                Actualizar
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
              >
                <LogOut size={16} />
                Salir
              </button>
            </div>
          </header>

          <div className="grid gap-px border-b border-stone-300 bg-stone-300 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-stone-50 px-4 py-4 sm:px-6">
              <p className="text-sm text-stone-500">Activos</p>
              <p className="mt-1 text-3xl font-semibold text-stone-950">{stats.activeOrders}</p>
            </div>
            <div className="bg-stone-50 px-4 py-4 sm:px-6">
              <p className="text-sm text-stone-500">Pendientes de confirmar</p>
              <p className="mt-1 text-3xl font-semibold text-amber-700">{stats.pendingOrders}</p>
            </div>
            <div className="bg-stone-50 px-4 py-4 sm:px-6">
              <p className="text-sm text-stone-500">Listos para salir</p>
              <p className="mt-1 text-3xl font-semibold text-emerald-700">{stats.readyOrders}</p>
            </div>
            <div className="bg-stone-50 px-4 py-4 sm:px-6">
              <p className="text-sm text-stone-500">Media hasta listo</p>
              <p className="mt-1 text-3xl font-semibold text-stone-950">{stats.averageReadyMinutes} min</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-b border-stone-300 bg-white px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilterMode(option.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    filterMode === option.value
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 text-sm">
              <span className="text-stone-500">Tablero por estado con scroll horizontal entre columnas.</span>
              {errorMessage ? <span className="text-red-700">{errorMessage}</span> : null}
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {isLoading ? (
              <div className="flex min-h-[320px] items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white text-sm text-stone-500">
                <Loader2 size={16} className="animate-spin" />
                Cargando pedidos...
              </div>
            ) : null}

            {!isLoading && filteredOrders.length === 0 ? (
              <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white px-4 text-center text-sm text-stone-500">
                No hay pedidos en esta vista.
              </div>
            ) : null}

            {!isLoading && filteredOrders.length > 0 ? (
              <div className="overflow-x-auto pb-3">
                <div className="flex min-h-[calc(100vh-290px)] snap-x snap-mandatory items-stretch gap-4 pr-2">
                  {groupedOrders.map((column) => {
                    const style = statusStyles[column.status];
                    const ColumnIcon = style.icon;

                    return (
                      <section
                        key={column.status}
                        className={`flex min-h-full w-[min(90vw,440px)] min-w-[320px] snap-start flex-col rounded-xl border ${style.column}`}
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-4">
                          <div className="flex items-center gap-3">
                            <span className={`flex h-9 w-9 items-center justify-center rounded-lg border ${style.badge}`}>
                              <ColumnIcon size={16} />
                            </span>
                            <div>
                              <h2 className="text-base font-semibold text-stone-950">{column.label}</h2>
                              <p className="text-sm text-stone-600">
                                {column.orders.length} {column.orders.length === 1 ? 'pedido' : 'pedidos'}
                              </p>
                            </div>
                          </div>
                          <span className={`text-2xl font-semibold ${style.columnCount}`}>{column.orders.length}</span>
                        </div>

                        <div className="flex-1 space-y-4 overflow-y-auto p-4">
                          {column.orders.length === 0 ? (
                            <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white/70 px-4 text-center text-sm text-stone-500">
                              Sin pedidos en esta columna.
                            </div>
                          ) : null}

                          {column.orders.map((order) => {
                            const nextAction = nextActionByStatus[order.status];
                            const isUpdating = pendingOrderIds.includes(order.id);
                            const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
                            const priority = getOrderPriority(order);
                            const PriorityIcon = priority.icon;

                            return (
                              <article
                                key={order.id}
                                className={`overflow-hidden rounded-xl border ${style.card} shadow-sm ${priority.cardRing}`}
                              >
                                <div className={`h-2 w-full ${style.strip}`} />

                                <div className="flex items-start justify-between gap-3 px-4 py-4">
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="text-lg font-semibold text-stone-950">Mesa {order.tableNumber}</h3>
                                      <span
                                        className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-medium ${style.badge}`}
                                      >
                                        <ColumnIcon size={14} />
                                        {statusDescriptions[order.status]}
                                      </span>
                                      <span
                                        className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-medium ${priority.tone}`}
                                      >
                                        <PriorityIcon size={14} />
                                        {priority.label}
                                      </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 text-sm text-stone-600">
                                      <span className="inline-flex items-center gap-1.5">
                                        <ReceiptText size={15} />
                                        #{order.id.slice(0, 8)}
                                      </span>
                                      <span className="inline-flex items-center gap-1.5">
                                        <Users size={15} />
                                        {order.diners} comensales
                                      </span>
                                      <span className="inline-flex items-center gap-1.5">
                                        <Table2 size={15} />
                                        {itemCount} platos
                                      </span>
                                    </div>
                                  </div>

                                  {order.syncState === 'mirror_failed' ? (
                                    <span className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                                      Error sync
                                    </span>
                                  ) : null}
                                </div>

                                <div className="grid gap-px border-y border-stone-200 bg-stone-200 sm:grid-cols-2">
                                  <div className="space-y-1 bg-white px-4 py-3">
                                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-stone-500">Cliente</p>
                                    <p className="text-sm font-medium text-stone-900">{order.clientName || 'Sin nombre'}</p>
                                  </div>
                                  <div className="space-y-1 bg-white px-4 py-3">
                                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-stone-500">Entrada</p>
                                    <p className="text-sm font-medium text-stone-900">{formatDateTime(order.createdAt)}</p>
                                  </div>
                                  <div className="space-y-1 bg-white px-4 py-3">
                                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-stone-500">Canal</p>
                                    <p className="text-sm font-medium text-stone-900">{order.source === 'voice' ? 'Voz' : 'Manual'}</p>
                                  </div>
                                  <div className="space-y-1 bg-white px-4 py-3">
                                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-stone-500">Importe</p>
                                    <p className="text-sm font-medium text-stone-900">{order.totalPrice.toFixed(2)} €</p>
                                  </div>
                                </div>

                                <div className="border-b border-stone-200 bg-white px-4 py-3">
                                  <div className="flex flex-wrap gap-3 text-sm text-stone-600">
                                    {order.customerEmail ? (
                                      <span className="inline-flex items-center gap-1.5">
                                        <Mail size={15} />
                                        {order.customerEmail}
                                      </span>
                                    ) : null}
                                    <span className="inline-flex items-center gap-1.5">
                                      <Clock3 size={15} />
                                      Pedido {formatTime(order.createdAt)}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 font-medium text-stone-800">
                                      {priority.ageMinutes} min abiertos
                                    </span>
                                    {order.acceptedAt ? <span>Aceptado {formatTime(order.acceptedAt)}</span> : null}
                                    {order.readyAt ? <span>Listo {formatTime(order.readyAt)}</span> : null}
                                    {order.servedAt ? <span>Entregado {formatTime(order.servedAt)}</span> : null}
                                  </div>
                                </div>

                                <div className="bg-stone-50 px-4 py-4">
                                  <div className="space-y-3">
                                    {order.items.map((item) => (
                                      <div key={item.id} className="rounded-lg border border-stone-200 bg-white px-4 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="space-y-1">
                                            <p className="text-base font-semibold text-stone-950">
                                              {item.quantity}x {item.name}
                                            </p>
                                            {item.notes ? (
                                              <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                                                Nota: {item.notes}
                                              </p>
                                            ) : (
                                              <p className="text-xs text-stone-400">Sin observaciones</p>
                                            )}
                                          </div>
                                          <span className="shrink-0 text-sm font-medium text-stone-700">
                                            {item.lineTotal.toFixed(2)} €
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="border-t border-stone-200 bg-white px-4 py-4">
                                  {nextAction ? (
                                    <button
                                      type="button"
                                      onClick={() => onUpdateStatus(order.id, nextAction.status)}
                                      disabled={isUpdating}
                                      className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-stone-300 ${style.action}`}
                                    >
                                      {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                                      {nextAction.label}
                                    </button>
                                  ) : (
                                    <div className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-sm font-medium text-stone-700">
                                      <PackageCheck size={16} />
                                      Pedido completado
                                    </div>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
};

export default KitchenDashboard;
