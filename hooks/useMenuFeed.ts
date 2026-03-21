import { useCallback, useEffect, useState } from 'react';

import type { MenuItem } from '../types';
import { createMenuEventSource, fetchAdminMenuFromApi, fetchMenuFromApi, parseMenuEvent } from '../utils/api';

export function useMenuFeed(enabled = true, scope: 'public' | 'admin' = 'public') {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    try {
      const snapshot = scope === 'admin' ? await fetchAdminMenuFromApi() : await fetchMenuFromApi();
      setMenu(snapshot);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la carta.');
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let closed = false;
    const eventSource = createMenuEventSource(scope);
    const pollId = window.setInterval(() => {
      void refresh();
    }, 15_000);

    void refresh();

    eventSource.onmessage = (event) => {
      if (closed) {
        return;
      }

      const payload = parseMenuEvent(event.data);
      setMenu(payload.menu);
      setError(null);
      setIsLoading(false);
    };

    eventSource.onerror = () => {
      if (closed) {
        return;
      }

      setError((currentError) => currentError ?? 'La carta en tiempo real se ha interrumpido. Se seguira refrescando en segundo plano.');
    };

    return () => {
      closed = true;
      window.clearInterval(pollId);
      eventSource.close();
    };
  }, [enabled, refresh, scope]);

  return {
    menu,
    setMenu,
    isLoading,
    error,
    refresh,
  };
}
