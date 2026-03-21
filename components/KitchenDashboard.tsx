import React, { useMemo, useState } from 'react';
import { ChefHat, Clock3, Loader2, LogOut, PackageCheck, RefreshCcw, SendHorizontal } from 'lucide-react';

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
  ready: 'Listo',
  served: 'Servido',
};

const nextActionByStatus: Partial<Record<OrderStatus, { label: string; status: OrderStatus }>> = {
  pending: { label: 'Aceptar pedido', status: 'cooking' },
  cooking: { label: 'Marcar listo', status: 'ready' },
  ready: { label: 'Marcar servido', status: 'served' },
};

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

  const stats = useMemo(() => {
    const activeOrders = orders.filter((order) => order.status !== 'served').length;
    const readyOrders = orders.filter((order) => order.status === 'ready').length;

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
      averageReadyMinutes,
    };
  }, [orders]);

  return (
    <div className="page-container py-4 sm:py-6">
      <section className="panel overflow-hidden">
        <header className="flex flex-col gap-4 border-b border-stone-200 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900 text-white">
                <ChefHat size={18} />
              </span>
              <div>
                <h1 className="text-lg font-semibold text-stone-900">{kitchenName}</h1>
                <p className="text-sm text-stone-500">{restaurantName}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
            >
              <RefreshCcw size={16} />
              Actualizar
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
            >
              <LogOut size={16} />
              Salir
            </button>
          </div>
        </header>

        <div className="grid gap-4 border-b border-stone-200 bg-stone-50 px-4 py-4 sm:px-6 md:grid-cols-3">
          <div>
            <p className="text-sm text-stone-500">Pedidos activos</p>
            <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.activeOrders}</p>
          </div>
          <div>
            <p className="text-sm text-stone-500">Listos para salir</p>
            <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.readyOrders}</p>
          </div>
          <div>
            <p className="text-sm text-stone-500">Media hasta listo</p>
            <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.averageReadyMinutes} min</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-stone-200 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilterMode(option.value)}
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  filterMode === option.value ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {errorMessage ? <p className="text-sm text-red-700">{errorMessage}</p> : null}
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <Loader2 size={16} className="animate-spin" />
              Cargando pedidos...
            </div>
          ) : null}

          {!isLoading && filteredOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center text-sm text-stone-500">
              No hay pedidos en esta vista.
            </div>
          ) : null}

          {filteredOrders.map((order) => {
            const nextAction = nextActionByStatus[order.status];
            const isUpdating = pendingOrderIds.includes(order.id);

            return (
              <article key={order.id} className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-stone-900">Mesa {order.tableNumber}</h2>
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">
                        {statusDescriptions[order.status]}
                      </span>
                      {order.syncState === 'mirror_failed' ? (
                        <span className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">Pendiente de réplica</span>
                      ) : null}
                    </div>

                    <p className="text-sm text-stone-500">
                      {order.clientName} · {order.diners} comensales ·{' '}
                      {new Date(order.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  <div className="w-full sm:w-auto">
                    {nextAction ? (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(order.id, nextAction.status)}
                        disabled={isUpdating}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:bg-stone-300"
                      >
                        {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                        {nextAction.label}
                      </button>
                    ) : (
                      <span className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                        <PackageCheck size={16} />
                        Pedido completado
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-stone-900">
                            {item.quantity}x {item.name}
                          </p>
                          {item.notes ? <p className="mt-1 text-xs text-stone-500">{item.notes}</p> : null}
                        </div>
                        <span className="text-sm text-stone-600">{item.lineTotal.toFixed(2)} €</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-stone-500">
                  <span className="inline-flex items-center gap-2">
                    <Clock3 size={16} />
                    Total {order.totalPrice.toFixed(2)} €
                  </span>
                  {order.acceptedAt ? (
                    <span>Aceptado {new Date(order.acceptedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  ) : null}
                  {order.readyAt ? (
                    <span>Listo {new Date(order.readyAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default KitchenDashboard;
