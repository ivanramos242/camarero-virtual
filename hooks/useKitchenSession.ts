import { useCallback, useEffect, useState } from 'react';

import { fetchKitchenSession, loginKitchen, logoutKitchen } from '../utils/api';

export function useKitchenSession() {
  const [authenticated, setAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const session = await fetchKitchenSession();
      setAuthenticated(session.authenticated);
      setError(null);
      return session;
    } catch (requestError) {
      setAuthenticated(false);
      setError(requestError instanceof Error ? requestError.message : 'No se pudo comprobar la sesión.');
      throw requestError;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (password: string) => {
      await loginKitchen(password);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await logoutKitchen();
    setAuthenticated(false);
    setError(null);
  }, []);

  return {
    authenticated,
    isLoading,
    error,
    login,
    logout,
    refresh,
  };
}
