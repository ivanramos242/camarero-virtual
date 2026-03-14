import React from 'react';
import { Loader2, Minus, Plus, Receipt, Trash2 } from 'lucide-react';

import type { CartItem } from '../types';

interface OrderSummaryProps {
  items: CartItem[];
  total: number;
  tableNumber: string;
  dinersCount: number;
  clientName: string;
  onClientNameChange: (value: string) => void;
  onDinersChange: (value: number) => void;
  onConfirm: () => void;
  onRemoveItem: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  isSending?: boolean;
  errorMessage?: string | null;
  successMessage?: string | null;
}

const OrderSummary: React.FC<OrderSummaryProps> = ({
  items,
  total,
  tableNumber,
  dinersCount,
  clientName,
  onClientNameChange,
  onDinersChange,
  onConfirm,
  onRemoveItem,
  onUpdateQuantity,
  isSending = false,
  errorMessage,
  successMessage,
}) => {
  return (
    <section className="panel sticky top-6 flex flex-col overflow-hidden">
      <div className="border-b border-stone-200 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-900 text-white">
              <Receipt size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-stone-900">Pedido actual</h2>
              <p className="text-sm text-stone-500">Mesa {tableNumber}</p>
            </div>
          </div>
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
            {items.reduce((sum, item) => sum + item.quantity, 0)} uds.
          </span>
        </div>
      </div>

      <div className="space-y-4 border-b border-stone-200 px-5 py-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-stone-700">Nombre del cliente</span>
          <input
            value={clientName}
            onChange={(event) => onClientNameChange(event.target.value)}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-600"
            placeholder="Cliente"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-stone-700">Comensales</span>
          <input
            type="number"
            min={1}
            max={24}
            value={dinersCount}
            onChange={(event) => onDinersChange(Math.max(1, Number(event.target.value) || 1))}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-600"
          />
        </label>
      </div>

      <div className="scrollbar-thin max-h-[340px] space-y-3 overflow-y-auto px-5 py-4">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
            Todavía no hay platos en la comanda. Puedes pedir por voz o añadir desde la carta.
          </div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-stone-900">{item.menuItem.name}</h3>
                  {item.notes ? <p className="mt-1 text-xs text-stone-500">{item.notes}</p> : null}
                </div>
                <span className="shrink-0 text-sm font-medium text-stone-700">
                  {(item.menuItem.price * item.quantity).toFixed(2)} €
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="inline-flex items-center rounded-lg border border-stone-300">
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                    disabled={isSending}
                    className="px-2 py-1 text-stone-600 transition hover:bg-stone-100"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="min-w-10 border-x border-stone-300 px-3 py-1 text-center text-sm font-medium text-stone-900">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                    disabled={isSending}
                    className="px-2 py-1 text-stone-600 transition hover:bg-stone-100"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  disabled={isSending}
                  className="rounded-md p-2 text-stone-400 transition hover:bg-stone-100 hover:text-red-600"
                  title="Eliminar línea"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="space-y-3 border-t border-stone-200 bg-stone-50 px-5 py-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-stone-500">Total estimado</span>
          <strong className="text-lg text-stone-900">{total.toFixed(2)} €</strong>
        </div>

        {errorMessage ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
        {successMessage ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>
        ) : null}

        <button
          type="button"
          onClick={onConfirm}
          disabled={items.length === 0 || isSending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:bg-stone-300"
        >
          {isSending ? <Loader2 size={16} className="animate-spin" /> : null}
          <span>{isSending ? 'Enviando pedido...' : 'Confirmar pedido'}</span>
        </button>
      </div>
    </section>
  );
};

export default OrderSummary;
