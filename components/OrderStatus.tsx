import React from 'react';
import { ChefHat, CircleAlert, Clock3, HandPlatter, PackageCheck } from 'lucide-react';

import type { PersistedOrder } from '../types';

interface OrderStatusProps {
  orders: PersistedOrder[];
  tableNumber: string;
}

const statusMap = {
  pending: {
    label: 'Recibido',
    icon: Clock3,
    className: 'bg-stone-100 text-stone-700',
  },
  cooking: {
    label: 'En cocina',
    icon: ChefHat,
    className: 'bg-amber-50 text-amber-800',
  },
  ready: {
    label: 'Listo',
    icon: PackageCheck,
    className: 'bg-emerald-50 text-emerald-700',
  },
  served: {
    label: 'Servido',
    icon: HandPlatter,
    className: 'bg-emerald-100 text-emerald-800',
  },
} as const;

const syncLabels = {
  local: 'Solo local',
  mirrored: 'Sincronizado',
  mirror_failed: 'Pendiente de réplica',
} as const;

const OrderStatus: React.FC<OrderStatusProps> = ({ orders, tableNumber }) => {
  const myOrders = orders.filter((order) => order.tableNumber === tableNumber);

  if (myOrders.length === 0) {
    return null;
  }

  return (
    <section className="panel">
      <div className="border-b border-stone-200 px-5 py-4">
        <h2 className="text-base font-semibold text-stone-900">Estado de la mesa</h2>
        <p className="mt-1 text-sm text-stone-500">Aquí verás cómo avanza cada pedido confirmado.</p>
      </div>

      <div className="scrollbar-thin max-h-[360px] space-y-3 overflow-y-auto px-5 py-4">
        {myOrders.map((order) => {
          const status = statusMap[order.status];
          const StatusIcon = status.icon;

          return (
            <article key={order.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900">Pedido {order.id.slice(0, 8)}</h3>
                  <p className="mt-1 text-xs text-stone-500">
                    {new Date(order.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {order.clientName}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${status.className}`}>
                    <StatusIcon size={14} />
                    {status.label}
                  </span>

                  <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600">
                    <CircleAlert size={14} />
                    {syncLabels[order.syncState]}
                  </span>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-stone-800">
                        <span className="font-semibold">{item.quantity}x</span> {item.name}
                      </p>
                      {item.notes ? <p className="mt-1 text-xs text-stone-500">{item.notes}</p> : null}
                    </div>
                    <span className="shrink-0 text-stone-600">{item.lineTotal.toFixed(2)} €</span>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default OrderStatus;
