import React, { useCallback, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChefHat, Loader2, Shield } from 'lucide-react';

import KitchenDashboard from '../components/KitchenDashboard';
import { useOrdersFeed } from '../hooks/useOrdersFeed';
import type { AppBranding, OrderStatus as OrderState } from '../types';
import { clearServedOrdersOnApi, updateOrderStatusOnApi } from '../utils/api';

interface LoginPageProps {
  authenticated: boolean;
  branding: AppBranding;
  errorMessage: string | null;
  isLoading: boolean;
  onLogin: (password: string) => Promise<void>;
}

export function KitchenLoginPage({ authenticated, branding, errorMessage, isLoading, onLogin }: LoginPageProps) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (authenticated) {
    return <Navigate replace to="/kitchen" />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      await onLogin(password);
      navigate('/kitchen');
    } catch (requestError) {
      setSubmitError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar sesion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page-container flex min-h-screen items-center justify-center py-10">
      <section className="panel w-full max-w-md overflow-hidden">
        <div className="border-b border-stone-200 px-6 py-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            <ArrowLeft size={16} />
            Volver al inicio
          </button>
        </div>

        <div className="border-b border-stone-200 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-stone-900 text-white">
              <Shield size={18} />
            </span>
            <div>
              <p className="text-sm text-stone-500">{branding.restaurantName}</p>
              <h1 className="text-lg font-semibold text-stone-900">Acceso a cocina</h1>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700">Contrasena del personal</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-amber-600"
              placeholder="Introduce la contrasena"
            />
          </label>

          {submitError || errorMessage ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitError || errorMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || isLoading || password.trim().length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:bg-stone-300"
          >
            {(isSubmitting || isLoading) ? <Loader2 size={16} className="animate-spin" /> : null}
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}

interface KitchenPageProps {
  branding: AppBranding;
  onLogout: () => Promise<void>;
}

export function KitchenPage({ branding, onLogout }: KitchenPageProps) {
  const navigate = useNavigate();
  const { orders, setOrders, isLoading, error, refresh } = useOrdersFeed();
  const [pendingOrderIds, setPendingOrderIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isClearingServed, setIsClearingServed] = useState(false);

  const handleUpdateStatus = useCallback(
    async (orderId: string, status: OrderState) => {
      const previousOrders = orders;

      setPendingOrderIds((previousIds) => [...previousIds, orderId]);
      setActionError(null);
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status,
                lastUpdatedAt: new Date().toISOString(),
              }
            : order,
        ),
      );

      try {
        const updatedOrder = await updateOrderStatusOnApi(orderId, { status });
        setOrders((currentOrders) => currentOrders.map((order) => (order.id === orderId ? updatedOrder : order)));
      } catch (requestError) {
        setOrders(previousOrders);
        setActionError(requestError instanceof Error ? requestError.message : 'No se pudo actualizar el pedido.');
      } finally {
        setPendingOrderIds((previousIds) => previousIds.filter((id) => id !== orderId));
      }
    },
    [orders, setOrders],
  );

  const handleLogout = useCallback(async () => {
    await onLogout();
    navigate('/kitchen/login');
  }, [navigate, onLogout]);

  const handleClearServed = useCallback(async () => {
    if (isClearingServed) {
      return;
    }

    const shouldContinue = window.confirm('Se vaciaran los pedidos entregados del historial de cocina. Esta accion no se puede deshacer.');
    if (!shouldContinue) {
      return;
    }

    try {
      setIsClearingServed(true);
      setActionError(null);
      const remainingOrders = await clearServedOrdersOnApi();
      setOrders(remainingOrders);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'No se pudieron vaciar los entregados.');
    } finally {
      setIsClearingServed(false);
    }
  }, [isClearingServed, setOrders]);

  return (
    <KitchenDashboard
      orders={orders}
      restaurantName={branding.restaurantName}
      kitchenName={branding.kitchenName}
      isLoading={isLoading}
      errorMessage={actionError || error}
      pendingOrderIds={pendingOrderIds}
      isClearingServed={isClearingServed}
      onClearServed={() => {
        void handleClearServed();
      }}
      onUpdateStatus={(orderId, status) => {
        void handleUpdateStatus(orderId, status);
      }}
      onLogout={() => {
        void handleLogout();
      }}
      onRefresh={() => {
        setActionError(null);
        void refresh();
      }}
    />
  );
}

export function KitchenPageFallback() {
  return (
    <main className="page-container flex min-h-screen items-center justify-center py-10">
      <div className="inline-flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
        <Loader2 size={16} className="animate-spin" />
        Cargando modulo de cocina...
      </div>
    </main>
  );
}

export function DiningHomeFallback() {
  return (
    <main className="page-container flex min-h-screen items-center justify-center py-10">
      <div className="inline-flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
        <Loader2 size={16} className="animate-spin" />
        Cargando...
      </div>
    </main>
  );
}
