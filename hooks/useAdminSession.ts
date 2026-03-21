import { useCallback, useEffect, useState } from 'react';

import { fetchAdminSession, loginAdmin, logoutAdmin } from '../utils/api';

export function useAdminSession() {
  const [authenticated, setAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const session = await fetchAdminSession();
      setAuthenticated(session.authenticated);
      setError(null);
      return session;
    } catch (requestError) {
      setAuthenticated(false);
      setError(requestError instanceof Error ? requestError.message : 'No se pudo comprobar la sesion.');
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
      await loginAdmin(password);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await logoutAdmin();
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
