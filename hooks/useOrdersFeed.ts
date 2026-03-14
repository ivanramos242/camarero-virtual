import { useCallback, useEffect, useState } from 'react';

import type { PersistedOrder } from '../types';
import { createOrdersEventSource, fetchOrdersFromApi, parseOrdersEvent } from '../utils/api';

export function useOrdersFeed(tableNumber?: string, enabled = true) {
  const [orders, setOrders] = useState<PersistedOrder[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    try {
      const snapshot = await fetchOrdersFromApi(tableNumber);
      setOrders(snapshot);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar los pedidos.');
    } finally {
      setIsLoading(false);
    }
  }, [enabled, tableNumber]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let closed = false;
    const eventSource = createOrdersEventSource(tableNumber);
    const pollId = window.setInterval(() => {
      void refresh();
    }, 15_000);

    void refresh();

    eventSource.onmessage = (event) => {
      if (closed) {
        return;
      }

      const payload = parseOrdersEvent(event.data);
      setOrders(payload.orders);
      setError(null);
      setIsLoading(false);
    };

    eventSource.onerror = () => {
      if (closed) {
        return;
      }

      setError((currentError) => currentError ?? 'La conexión en tiempo real se ha interrumpido. La app seguirá actualizando en segundo plano.');
    };

    return () => {
      closed = true;
      window.clearInterval(pollId);
      eventSource.close();
    };
  }, [enabled, refresh, tableNumber]);

  return {
    orders,
    setOrders,
    isLoading,
    error,
    refresh,
  };
}
