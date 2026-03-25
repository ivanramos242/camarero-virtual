import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  AlertCircle,
  ClipboardList,
  ChefHat,
  Copy,
  Loader2,
  Mic,
  QrCode,
  RefreshCcw,
  Shield,
  Store,
  TerminalSquare,
  X,
} from 'lucide-react';

import MenuExplorer from './components/MenuExplorer';
import OrderStatus from './components/OrderStatus';
import OrderSummary from './components/OrderSummary';
import { useAdminSession } from './hooks/useAdminSession';
import { useMenuFeed } from './hooks/useMenuFeed';
import { useKitchenSession } from './hooks/useKitchenSession';
import { useLiveSession } from './hooks/useLiveSession';
import { useOrdersFeed } from './hooks/useOrdersFeed';
import type {
  AppBranding,
  CartItem,
  MenuItem,
  PersistedOrder,
} from './types';

const FRONTEND_BUILD_ID = 'ptt-v2-no-explicit-vad';
console.info('[voice-ui] frontend build', FRONTEND_BUILD_ID);
import {
  createOrderOnApi,
  createVoiceSessionToken,
  fetchPublicConfig,
} from './utils/api';

const LazyKitchenPage = lazy(async () => {
  const module = await import('./routes/KitchenRoutes');
  return { default: module.KitchenPage };
});

const LazyKitchenLoginPage = lazy(async () => {
  const module = await import('./routes/KitchenRoutes');
  return { default: module.KitchenLoginPage };
});

const LazyAdminPage = lazy(async () => {
  const module = await import('./routes/AdminRoutes');
  return { default: module.AdminPage };
});

const LazyAdminLoginPage = lazy(async () => {
  const module = await import('./routes/AdminRoutes');
  return { default: module.AdminLoginPage };
});

const LazyAdminTablePrintPage = lazy(async () => {
  const module = await import('./routes/AdminRoutes');
  return { default: module.AdminTablePrintPage };
});

const LazyAdminTablesBatchPrintPage = lazy(async () => {
  const module = await import('./routes/AdminRoutes');
  return { default: module.AdminTablesBatchPrintPage };
});

function RouteModuleFallback({ message }: { message: string }) {
  return (
    <main className="page-container flex min-h-screen items-center justify-center py-10">
      <div className="inline-flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
        <Loader2 size={16} className="animate-spin" />
        {message}
      </div>
    </main>
  );
}

const defaultBranding: AppBranding = {
  restaurantName: 'Camarero Virtual',
  assistantName: 'Ramiro',
  kitchenName: 'Cocina',
  tagline: 'Pedidos por voz y carta digital',
  supportManualOrdering: true,
  showDebugTools: false,
  voiceEnabled: false,
  voiceProvider: 'none',
  showWifiPopup: false,
  wifiSsid: '',
  wifiPassword: '',
};

type DiningView = 'main' | 'debug';

function createCartId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `cart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSessionDetailsStorageKey(tableNumber: string) {
  return `dining-session:${tableNumber || 'unknown'}`;
}

function isValidReviewEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function upsertOrder(orderList: PersistedOrder[], nextOrder: PersistedOrder) {
  return [nextOrder, ...orderList.filter((order) => order.id !== nextOrder.id)];
}

function App() {
  const [branding, setBranding] = useState<AppBranding>(defaultBranding);
  const [configError, setConfigError] = useState<string | null>(null);
  const { menu, isLoading: menuLoading, error: menuError, refresh: refreshMenu } = useMenuFeed();
  const kitchenSession = useKitchenSession();
  const adminSession = useAdminSession();

  const loadConfig = useCallback(async () => {
    try {
      const config = await fetchPublicConfig();
      setBranding(config);
      setConfigError(null);
    } catch (requestError) {
      setConfigError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la configuracion publica.');
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  return (
    <div className="app-shell">
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              authenticated={kitchenSession.authenticated}
              adminAuthenticated={adminSession.authenticated}
              branding={branding}
              configError={configError}
            />
          }
        />
        <Route
          path="/mesa/:tableNumber"
          element={
            <DiningPage
              branding={branding}
              configError={configError}
              menu={menu}
              menuError={menuError}
              menuLoading={menuLoading}
              refreshMenu={refreshMenu}
            />
          }
        />
        <Route
          path="/kitchen/login"
          element={
            <Suspense fallback={<RouteModuleFallback message="Cargando modulo de cocina..." />}>
              <LazyKitchenLoginPage
                authenticated={kitchenSession.authenticated}
                branding={branding}
                errorMessage={kitchenSession.error}
                isLoading={kitchenSession.isLoading}
                onLogin={kitchenSession.login}
              />
            </Suspense>
          }
        />
        <Route
          path="/kitchen"
          element={
            <ProtectedKitchenRoute authenticated={kitchenSession.authenticated} isLoading={kitchenSession.isLoading}>
              <Suspense fallback={<RouteModuleFallback message="Cargando modulo de cocina..." />}>
                <LazyKitchenPage branding={branding} onLogout={kitchenSession.logout} />
              </Suspense>
            </ProtectedKitchenRoute>
          }
        />
        <Route
          path="/admin/login"
          element={
            <Suspense fallback={<RouteModuleFallback message="Cargando modulo de administracion..." />}>
              <LazyAdminLoginPage
                authenticated={adminSession.authenticated}
                branding={branding}
                errorMessage={adminSession.error}
                isLoading={adminSession.isLoading}
                onLogin={adminSession.login}
              />
            </Suspense>
          }
        />
        <Route
          path="/admin/tables/print"
          element={
            <ProtectedAdminRoute authenticated={adminSession.authenticated} isLoading={adminSession.isLoading}>
              <Suspense fallback={<RouteModuleFallback message="Cargando modulo de administracion..." />}>
                <LazyAdminTablesBatchPrintPage branding={branding} />
              </Suspense>
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/admin/tables/:tableId/print"
          element={
            <ProtectedAdminRoute authenticated={adminSession.authenticated} isLoading={adminSession.isLoading}>
              <Suspense fallback={<RouteModuleFallback message="Cargando modulo de administracion..." />}>
                <LazyAdminTablePrintPage branding={branding} />
              </Suspense>
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedAdminRoute authenticated={adminSession.authenticated} isLoading={adminSession.isLoading}>
              <Suspense fallback={<RouteModuleFallback message="Cargando modulo de administracion..." />}>
                <LazyAdminPage branding={branding} onLogout={adminSession.logout} />
              </Suspense>
            </ProtectedAdminRoute>
          }
        />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </div>
  );
}

interface HomePageProps {
  authenticated: boolean;
  adminAuthenticated: boolean;
  branding: AppBranding;
  configError: string | null;
}

function HomePage({ authenticated, adminAuthenticated, branding, configError }: HomePageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const legacyTable = searchParams.get('mesa')?.trim();
  const [tableNumber, setTableNumber] = useState(legacyTable || '1');
  const [isAccessPanelOpen, setIsAccessPanelOpen] = useState(false);

  useEffect(() => {
    if (!isAccessPanelOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isAccessPanelOpen]);

  if (legacyTable) {
    return <Navigate replace to={`/mesa/${encodeURIComponent(legacyTable)}`} />;
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTable = tableNumber.trim() || '1';
    navigate(`/mesa/${encodeURIComponent(nextTable)}`);
  };

  return (
    <>
      <main className="page-container flex min-h-screen items-center justify-center py-10">
        <section className="panel w-full max-w-xl overflow-hidden">
          <div className="border-b border-stone-200 px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-stone-900 text-white">
                <Store size={18} />
              </span>
              <div>
                <p className="text-sm font-medium text-stone-500">{branding.restaurantName}</p>
                <h1 className="text-xl font-semibold text-stone-900">Abrir experiencia de mesa</h1>
              </div>
            </div>
          </div>

          <div className="space-y-5 px-6 py-6">
            <p className="text-sm leading-6 text-stone-600">
              Introduce el numero de mesa para abrir la experiencia del cliente y empezar a pedir.
            </p>

            {configError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {configError}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="panel-muted space-y-4 p-4">
              <div className="space-y-2">
                <label htmlFor="table-number" className="text-sm font-medium text-stone-700">
                  Numero de mesa
                </label>
                <input
                  id="table-number"
                  value={tableNumber}
                  onChange={(event) => setTableNumber(event.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-amber-600"
                  placeholder="1"
                />
              </div>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black"
              >
                <QrCode size={16} />
                Abrir experiencia de mesa
              </button>
            </form>
          </div>
        </section>
      </main>

      <button
        type="button"
        onClick={() => setIsAccessPanelOpen(true)}
        className="fixed bottom-5 right-5 inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50"
      >
        <Shield size={16} />
        Administracion
      </button>

      <AccessPanelModal
        authenticated={authenticated}
        adminAuthenticated={adminAuthenticated}
        branding={branding}
        isOpen={isAccessPanelOpen}
        onClose={() => setIsAccessPanelOpen(false)}
      />
    </>
  );
}

interface AccessPanelModalProps {
  authenticated: boolean;
  adminAuthenticated: boolean;
  branding: AppBranding;
  isOpen: boolean;
  onClose: () => void;
}

function AccessPanelModal({ authenticated, adminAuthenticated, branding, isOpen, onClose }: AccessPanelModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-stone-950/35 p-4 sm:p-5" onClick={onClose}>
      <section
        className="panel w-full max-w-md overflow-hidden"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-stone-500">{branding.restaurantName}</p>
            <h2 className="text-base font-semibold text-stone-900">Accesos internos</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <article className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
                <ChefHat size={18} />
              </span>
              <div>
                <h3 className="text-base font-semibold text-stone-900">Acceso cocina</h3>
                <p className="text-sm text-stone-500">Panel protegido con sesion de personal.</p>
              </div>
            </div>

            <Link
              to={authenticated ? '/kitchen' : '/kitchen/login'}
              onClick={onClose}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
            >
              <Shield size={16} />
              Ir al login de cocina
            </Link>
          </article>

          <article className="space-y-3 border-t border-stone-200 pt-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
                <ClipboardList size={18} />
              </span>
              <div>
                <h3 className="text-base font-semibold text-stone-900">Administracion</h3>
                <p className="text-sm text-stone-500">Gestiona carta y revisa pedidos en tiempo real.</p>
              </div>
            </div>

            <Link
              to={adminAuthenticated ? '/admin' : '/admin/login'}
              onClick={onClose}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
            >
              <ClipboardList size={16} />
              Entrar a administracion
            </Link>
          </article>

          <article className="space-y-3 border-t border-stone-200 pt-5">
            <h3 className="text-base font-semibold text-stone-900">Estado del sistema</h3>
            <div className="space-y-3 text-sm text-stone-600">
              <div className="flex items-start justify-between gap-3">
                <span>Pedidos y estados</span>
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Backend propio</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span>Asistente de voz</span>
                <span
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    branding.voiceEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-700'
                  }`}
                >
                  {branding.voiceEnabled ? 'Disponible' : 'Manual'}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span>Entrada de cliente</span>
                <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">Ruta por mesa</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

interface DiningPageProps {
  branding: AppBranding;
  configError: string | null;
  menu: MenuItem[];
  menuError: string | null;
  menuLoading: boolean;
  refreshMenu: () => Promise<void>;
}

function DiningPage({ branding, configError, menu, menuError, menuLoading, refreshMenu }: DiningPageProps) {
  const { tableNumber = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [activeView, setActiveView] = useState<DiningView>('main');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [clientName, setClientName] = useState('Cliente');
  const [dinersCount, setDinersCount] = useState(1);
  const [customerEmail, setCustomerEmail] = useState('');
  const [reviewConsent, setReviewConsent] = useState(false);
  const [draftClientName, setDraftClientName] = useState('');
  const [draftDinersCount, setDraftDinersCount] = useState(2);
  const [draftCustomerEmail, setDraftCustomerEmail] = useState('');
  const [draftReviewConsent, setDraftReviewConsent] = useState(false);
  const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const debugEnabled = branding.showDebugTools || import.meta.env.DEV || searchParams.get('debug') === '1';
  const menuReady = !menuLoading && !menuError && menu.length > 0;

  const { orders, setOrders, isLoading: ordersLoading, error: ordersError, refresh: refreshOrders } = useOrdersFeed(
    tableNumber,
    Boolean(tableNumber),
  );

  useEffect(() => {
    if (!debugEnabled && activeView === 'debug') {
      setActiveView('main');
    }
  }, [activeView, debugEnabled]);

  useEffect(() => {
    if (!submitSuccess) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSubmitSuccess(null);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [submitSuccess]);

  useEffect(() => {
    if (typeof window === 'undefined' || !tableNumber) {
      return;
    }

    const storageKey = getSessionDetailsStorageKey(tableNumber);
    const savedSession = window.sessionStorage.getItem(storageKey);

    if (!savedSession) {
      if (branding.showWifiPopup && branding.wifiSsid.trim()) {
        setIsWifiModalOpen(true);
        setIsSessionModalOpen(false);
      } else {
        setIsSessionModalOpen(true);
      }
      return;
    }

    try {
      const parsedSession = JSON.parse(savedSession) as {
        clientName?: string;
        dinersCount?: number;
        customerEmail?: string;
        reviewConsent?: boolean;
      };

      if (parsedSession.clientName?.trim()) {
        setClientName(parsedSession.clientName.trim());
        setDraftClientName(parsedSession.clientName.trim());
      }

      if (typeof parsedSession.dinersCount === 'number' && parsedSession.dinersCount >= 1) {
        const nextDinersCount = Math.max(1, parsedSession.dinersCount);
        setDinersCount(nextDinersCount);
        setDraftDinersCount(nextDinersCount);
      }

      if (typeof parsedSession.reviewConsent === 'boolean') {
        setReviewConsent(parsedSession.reviewConsent);
        setDraftReviewConsent(parsedSession.reviewConsent);
      }

      if (parsedSession.customerEmail?.trim()) {
        const nextEmail = parsedSession.customerEmail.trim().toLowerCase();
        setCustomerEmail(nextEmail);
        setDraftCustomerEmail(nextEmail);
      }

      setIsSessionModalOpen(false);
    } catch {
      window.sessionStorage.removeItem(storageKey);
      if (branding.showWifiPopup && branding.wifiSsid.trim()) {
        setIsWifiModalOpen(true);
        setIsSessionModalOpen(false);
      } else {
        setIsSessionModalOpen(true);
      }
    }
  }, [branding.showWifiPopup, branding.wifiSsid, tableNumber]);

  const handleAddToCart = useCallback((item: MenuItem, quantity: number, notes?: string) => {
    setCartItems((previousItems) => {
      const normalisedNotes = (notes || '').trim().toLowerCase();
      const existingIndex = previousItems.findIndex(
        (cartItem) =>
          cartItem.menuItem.id === item.id && (cartItem.notes || '').trim().toLowerCase() === normalisedNotes,
      );

      if (existingIndex >= 0) {
        const nextItems = [...previousItems];
        nextItems[existingIndex] = {
          ...nextItems[existingIndex],
          quantity: nextItems[existingIndex].quantity + quantity,
        };
        return nextItems;
      }

      return [
        ...previousItems,
        {
          id: createCartId(),
          menuItem: item,
          quantity,
          notes,
          timestamp: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const handleRemoveItem = useCallback((itemId: string) => {
    setCartItems((previousItems) => previousItems.filter((item) => item.id !== itemId));
  }, []);

  const handleUpdateQuantity = useCallback((itemId: string, quantity: number) => {
    setCartItems((previousItems) =>
      previousItems
        .map((item) => (item.id === itemId ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0),
    );
  }, []);

  const handleRemoveFromOrder = useCallback((itemName: string) => {
    const targetName = itemName.trim().toLowerCase();

    setCartItems((previousItems) => {
      const targetIndex = previousItems.findIndex((item) => item.menuItem.name.toLowerCase().includes(targetName));

      if (targetIndex === -1) {
        return previousItems;
      }

      return previousItems.flatMap((item, index) => {
        if (index !== targetIndex) {
          return item;
        }

        if (item.quantity <= 1) {
          return [];
        }

        return [{ ...item, quantity: item.quantity - 1 }];
      });
    });
  }, []);

  const handleSetDiners = useCallback((count: number, name?: string) => {
    setDinersCount(Math.max(1, count));

    if (name) {
      setClientName(name);
    }
  }, []);

  const handleSessionDetailsSubmit = useCallback(() => {
    const trimmedName = draftClientName.trim();
    const trimmedEmail = draftCustomerEmail.trim().toLowerCase();

    if (!trimmedName || !tableNumber) {
      return;
    }

    if (draftReviewConsent && !isValidReviewEmail(trimmedEmail)) {
      return;
    }

    const nextDinersCount = Math.max(1, draftDinersCount);
    const nextReviewConsent = draftReviewConsent && Boolean(trimmedEmail);

    setClientName(trimmedName);
    setDinersCount(nextDinersCount);
    setCustomerEmail(nextReviewConsent ? trimmedEmail : '');
    setReviewConsent(nextReviewConsent);
    setIsSessionModalOpen(false);

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(
        getSessionDetailsStorageKey(tableNumber),
        JSON.stringify({
          clientName: trimmedName,
          dinersCount: nextDinersCount,
          customerEmail: nextReviewConsent ? trimmedEmail : '',
          reviewConsent: nextReviewConsent,
        }),
      );
    }
  }, [draftClientName, draftCustomerEmail, draftDinersCount, draftReviewConsent, tableNumber]);

  const handleClientNameChange = useCallback(
    (value: string) => {
      setClientName(value);
      setDraftClientName(value);

      if (typeof window !== 'undefined' && tableNumber && value.trim()) {
        window.sessionStorage.setItem(
          getSessionDetailsStorageKey(tableNumber),
          JSON.stringify({
            clientName: value.trim(),
            dinersCount,
            customerEmail: reviewConsent ? customerEmail : '',
            reviewConsent,
          }),
        );
      }
    },
    [customerEmail, dinersCount, reviewConsent, tableNumber],
  );

  const handleDinersChange = useCallback(
    (value: number) => {
      const nextValue = Math.max(1, value);
      setDinersCount(nextValue);
      setDraftDinersCount(nextValue);

      if (typeof window !== 'undefined' && tableNumber) {
        window.sessionStorage.setItem(
          getSessionDetailsStorageKey(tableNumber),
          JSON.stringify({
            clientName: clientName.trim() || 'Cliente',
            dinersCount: nextValue,
            customerEmail: reviewConsent ? customerEmail : '',
            reviewConsent,
          }),
        );
      }
    },
    [clientName, customerEmail, reviewConsent, tableNumber],
  );

  const handleConfirmOrder = useCallback(
    async (nextDiners: number, nextClientName: string, itemsOverride?: CartItem[]) => {
      const itemsToSubmit = itemsOverride ?? cartItems;

      if (itemsToSubmit.length === 0) {
        setSubmitError('No hay platos en el pedido actual.');
        return false;
      }

      if (!tableNumber) {
        setSubmitError('La mesa no es valida.');
        return false;
      }

      try {
        setIsSending(true);
        setSubmitError(null);
        setSubmitSuccess(null);

        const createdOrder = await createOrderOnApi({
          tableNumber,
          clientName: nextClientName.trim() || 'Cliente',
          diners: Math.max(1, nextDiners),
          customerEmail: reviewConsent ? customerEmail.trim().toLowerCase() : '',
          reviewConsent,
          source: itemsOverride ? 'voice' : 'manual',
          items: itemsToSubmit.map((item) => ({
            menuItemId: item.menuItem.id,
            quantity: item.quantity,
            notes: item.notes,
          })),
        });

        setOrders((previousOrders) => upsertOrder(previousOrders, createdOrder));
        setCartItems([]);
        setSubmitSuccess(`Pedido ${createdOrder.id.slice(0, 8)} enviado a cocina.`);
        return true;
      } catch (requestError) {
        setSubmitError(requestError instanceof Error ? requestError.message : 'No se pudo enviar el pedido.');
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [cartItems, customerEmail, reviewConsent, setOrders, tableNumber],
  );

  const voiceSession = useLiveSession({
    branding,
    tableNumber,
    menu,
    createSessionToken: createVoiceSessionToken,
    onAddToCart: handleAddToCart,
    onRemoveFromOrder: handleRemoveFromOrder,
    onConfirmOrder: handleConfirmOrder,
    onSetDiners: handleSetDiners,
    cartItems,
    dinersCount,
    clientName,
  });

  const totalPrice = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0),
    [cartItems],
  );
  const cartUnits = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);

  const latestVoiceError = useMemo(() => {
    const latestError = [...voiceSession.logs].reverse().find((log) => log.role === 'error');
    return latestError?.text ?? null;
  }, [voiceSession.logs]);

  useEffect(() => {
    if (!isSessionModalOpen && !isCartOpen && !isWifiModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCartOpen, isSessionModalOpen, isWifiModalOpen]);

  const viewTabs = useMemo(() => {
    const tabs: Array<{ value: DiningView; label: string; icon: typeof Mic }> = [];

    if (debugEnabled) {
      tabs.push({ value: 'debug', label: 'Debug', icon: TerminalSquare });
    }

    return tabs;
  }, [debugEnabled]);

  return (
    <div className="page-container py-5">
      <WifiAccessModal
        isOpen={isWifiModalOpen}
        ssid={branding.wifiSsid}
        password={branding.wifiPassword}
        onClose={() => {
          setIsWifiModalOpen(false);
          setIsSessionModalOpen(true);
        }}
      />
      <SessionDetailsModal
        clientName={draftClientName}
        dinersCount={draftDinersCount}
        customerEmail={draftCustomerEmail}
        reviewConsent={draftReviewConsent}
        isOpen={isSessionModalOpen}
        onClientNameChange={setDraftClientName}
        onDinersChange={setDraftDinersCount}
        onCustomerEmailChange={setDraftCustomerEmail}
        onReviewConsentChange={setDraftReviewConsent}
        onConfirm={handleSessionDetailsSubmit}
      />

      <header className="panel mb-4 overflow-hidden sm:mb-6">
        <div className="flex flex-col gap-4 border-b border-stone-200 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex h-11 w-11 items-center justify-center rounded-lg bg-stone-900 text-white">
              <ChefHat size={18} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-stone-900">{branding.assistantName} - Mesa {tableNumber}</h1>
            </div>
          </div>

          {viewTabs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {viewTabs.map((tab) => {
                const Icon = tab.icon;

                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setActiveView(tab.value)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                      activeView === tab.value ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    <Icon size={15} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {(configError || menuError || ordersError) ? (
          <div className="space-y-2 bg-amber-50 px-4 py-4 text-sm text-amber-900 sm:px-6">
            {configError ? <p>{configError}</p> : null}
            {menuError ? <p>{menuError}</p> : null}
            {ordersError ? <p>{ordersError}</p> : null}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-6">
          {activeView === 'main' ? (
            <>
              {branding.voiceEnabled ? (
                <AssistantPanel
                  assistantName={branding.assistantName}
                  disabled={!menuReady}
                  disabledMessage={menuLoading ? 'Cargando carta para la sesion de voz...' : menuError || 'No hay carta disponible.'}
                  lastAssistantMessage={voiceSession.lastAssistantMessage}
                  latestError={latestVoiceError}
                  logs={voiceSession.logs}
                  status={voiceSession.status}
                  turnState={voiceSession.turnState}
                  onBeginPressToTalk={voiceSession.beginPressToTalk}
                  onEndPressToTalk={voiceSession.endPressToTalk}
                  onDisconnect={voiceSession.disconnect}
                  showDebug={debugEnabled}
                  volumeLevel={voiceSession.volumeLevel}
                />
              ) : null}

              <MenuPanel
                menu={menu}
                menuError={menuError}
                menuLoading={menuLoading}
                onAddItem={handleAddToCart}
                onRetry={refreshMenu}
              />

              {ordersLoading ? (
                <section className="panel flex items-center gap-3 px-4 py-4 text-sm text-stone-500 sm:px-5 lg:hidden">
                  <Loader2 size={16} className="animate-spin" />
                  Cargando pedidos de la mesa...
                </section>
              ) : null}

              <div className="lg:hidden">
                <OrderStatus orders={orders} tableNumber={tableNumber} />
              </div>
            </>
          ) : null}

          {activeView === 'debug' && debugEnabled ? <DebugPanel logs={voiceSession.logs} /> : null}
        </section>

        <aside className="hidden space-y-6 lg:block">
          <OrderSummary
            items={cartItems}
            total={totalPrice}
            tableNumber={tableNumber}
            onConfirm={() => {
              void handleConfirmOrder(dinersCount, clientName);
            }}
            onRemoveItem={handleRemoveItem}
            onUpdateQuantity={handleUpdateQuantity}
            isSending={isSending}
            errorMessage={submitError}
            successMessage={submitSuccess}
          />

          {ordersLoading ? (
            <section className="panel flex items-center gap-3 px-5 py-4 text-sm text-stone-500">
              <Loader2 size={16} className="animate-spin" />
              Cargando pedidos de la mesa...
            </section>
          ) : null}

          <OrderStatus orders={orders} tableNumber={tableNumber} />

          {orders.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                void refreshOrders();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2.5 text-sm text-stone-700 transition hover:bg-stone-50"
            >
              <RefreshCcw size={16} />
              Actualizar estado
            </button>
          ) : null}
        </aside>
      </div>

      <div className="h-56 lg:h-40" />

      <button
        type="button"
        onClick={() => setIsCartOpen(true)}
        className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-40 inline-flex min-h-14 items-center justify-between rounded-xl bg-stone-900 px-4 py-3 text-left text-white shadow-lg shadow-stone-950/20 lg:hidden"
      >
        <span>
          <span className="block text-xs text-stone-300">Pedido actual</span>
          <span className="mt-1 block text-sm font-medium">{cartUnits > 0 ? `${cartUnits} platos en la comanda` : 'Aun no has anadido platos'}</span>
        </span>
        <span className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold">{totalPrice.toFixed(2)} EUR</span>
      </button>

      {isCartOpen ? (
        <div className="fixed inset-0 z-50 bg-stone-950/40 lg:hidden" onClick={() => setIsCartOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl bg-[var(--bg)] px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-stone-300" />
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <p className="text-sm font-semibold text-stone-900">Resumen del pedido</p>
                <p className="text-xs text-stone-500">Revisa la comanda antes de enviarla.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCartOpen(false)}
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
              >
                Cerrar
              </button>
            </div>
            <OrderSummary
              items={cartItems}
              total={totalPrice}
              tableNumber={tableNumber}
              onConfirm={() => {
                void handleConfirmOrder(dinersCount, clientName).then((success) => {
                  if (success) {
                    setIsCartOpen(false);
                  }
                });
              }}
              onRemoveItem={handleRemoveItem}
              onUpdateQuantity={handleUpdateQuantity}
              isSending={isSending}
              errorMessage={submitError}
              successMessage={submitSuccess}
              className="max-h-[calc(88vh-72px)]"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface SessionDetailsModalProps {
  clientName: string;
  dinersCount: number;
  customerEmail: string;
  reviewConsent: boolean;
  isOpen: boolean;
  onClientNameChange: (value: string) => void;
  onDinersChange: (value: number) => void;
  onCustomerEmailChange: (value: string) => void;
  onReviewConsentChange: (value: boolean) => void;
  onConfirm: () => void;
}

interface WifiAccessModalProps {
  isOpen: boolean;
  ssid: string;
  password: string;
  onClose: () => void;
}

function WifiAccessModal({ isOpen, ssid, password, onClose }: WifiAccessModalProps) {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');

  if (!isOpen) {
    return null;
  }

  const handleCopyPassword = async () => {
    if (!password) {
      return;
    }

    try {
      await navigator.clipboard.writeText(password);
      setCopyState('success');
    } catch {
      setCopyState('error');
    }

    window.setTimeout(() => {
      setCopyState('idle');
    }, 2000);
  };

  return (
    <div className="modal-backdrop-enter fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 px-3 py-[max(12px,env(safe-area-inset-bottom))] sm:items-center sm:px-4 sm:py-6">
      <div className="modal-surface-enter w-full max-w-md overflow-hidden rounded-t-3xl border border-stone-200 bg-white shadow-xl shadow-stone-950/10 sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-5 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">Wi-Fi del restaurante</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Te dejamos la red y la contrasena antes de empezar.
            </p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">Red</p>
            <p className="mt-2 min-w-0 truncate text-sm font-semibold text-stone-900">{ssid}</p>
          </div>

          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">Contrasena</p>
                <p className="mt-2 min-w-0 truncate text-sm font-semibold text-stone-900">{password || 'Sin contrasena'}</p>
              </div>
              {password ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyPassword();
                  }}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-stone-100"
                >
                  <Copy size={14} />
                  Copiar
                </button>
              ) : null}
            </div>
            {copyState === 'success' ? <p className="mt-3 text-xs font-medium text-emerald-700">Contrasena copiada.</p> : null}
            {copyState === 'error' ? <p className="mt-3 text-xs font-medium text-red-700">No se pudo copiar automaticamente.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionDetailsModal({
  clientName,
  dinersCount,
  customerEmail,
  reviewConsent,
  isOpen,
  onClientNameChange,
  onDinersChange,
  onCustomerEmailChange,
  onReviewConsentChange,
  onConfirm,
}: SessionDetailsModalProps) {
  if (!isOpen) {
    return null;
  }

  const dinersOptions = [1, 2, 3, 4, 5, 6, 7, 8];
  const trimmedEmail = customerEmail.trim();
  const hasValidReviewEmail = isValidReviewEmail(trimmedEmail);
  const canContinue = clientName.trim().length > 0 && (!reviewConsent || hasValidReviewEmail);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 px-3 py-[max(12px,env(safe-area-inset-bottom))] sm:items-center sm:px-4 sm:py-6">
      <div className="w-full max-w-md overflow-hidden rounded-t-3xl border border-stone-200 bg-white shadow-xl shadow-stone-950/10 sm:rounded-xl">
        <div className="border-b border-stone-200 px-5 py-5 sm:px-6">
          <h2 className="text-lg font-semibold text-stone-900">Nueva sesi&oacute;n</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Antes de empezar, necesitamos el nombre del cliente y cu&aacute;ntos comensales hay en la mesa.
          </p>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700">Nombre</span>
            <input
              autoFocus
              value={clientName}
              onChange={(event) => onClientNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canContinue) {
                  event.preventDefault();
                  onConfirm();
                }
              }}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
              placeholder="Ej. Marta"
            />
          </label>

          <div className="space-y-2">
            <span className="text-sm font-medium text-stone-700">Comensales</span>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-4">
              {dinersOptions.map((option) => {
                const isSelected = dinersCount === option;
                const label = option === 8 ? '8+' : String(option);

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onDinersChange(option)}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                      isSelected
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={reviewConsent}
                onChange={(event) => onReviewConsentChange(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-stone-900">Quiero recibir un email para valorar mi experiencia</span>
                <span className="mt-1 block text-xs leading-5 text-stone-500">
                  Es opcional y solo se usara para enviarte esa valoracion, no para promociones.
                </span>
              </span>
            </label>

            {reviewConsent ? (
              <div className="mt-4 space-y-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-stone-700">Email</span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={customerEmail}
                    onChange={(event) => onCustomerEmailChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && canContinue) {
                        event.preventDefault();
                        onConfirm();
                      }
                    }}
                    className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                    placeholder="tu@email.com"
                  />
                </label>
                {!hasValidReviewEmail && trimmedEmail ? (
                  <p className="text-xs text-red-700">Introduce un email valido para poder recibir la valoracion.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canContinue}
            className="inline-flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

interface AssistantPanelProps {
  assistantName: string;
  disabled: boolean;
  disabledMessage: string;
  lastAssistantMessage: string;
  latestError: string | null;
  logs: { role: 'assistant' | 'system' | 'error'; text: string; timestamp: number }[];
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  turnState: 'idle' | 'recording' | 'processing' | 'speaking' | 'error';
  onBeginPressToTalk: () => void;
  onEndPressToTalk: () => void;
  onDisconnect: () => void;
  showDebug: boolean;
  volumeLevel: number;
}

function AssistantPanel({
  assistantName,
  disabled,
  disabledMessage,
  lastAssistantMessage,
  latestError,
  logs,
  status,
  turnState,
  onBeginPressToTalk,
  onEndPressToTalk,
  onDisconnect,
  showDebug,
  volumeLevel,
}: AssistantPanelProps) {
  const isConnecting = status === 'connecting';
  const isListening = turnState === 'recording';
  const isProcessing = turnState === 'processing' || isConnecting;
  const isSpeaking = turnState === 'speaking';
  const hasIssue = disabled || status === 'error' || turnState === 'error' || Boolean(latestError);
  const isTurnLocked = isProcessing || isSpeaking;
  const isInteractive = !disabled && !isTurnLocked;
  const micEnergy = Math.max(0.12, Math.min(volumeLevel, 1));
  const visualEnergy = isListening ? micEnergy : isSpeaking ? 0.42 : isProcessing ? 0.2 : 0.08;
  const pressLabel = isListening
    ? 'Grabando. Suelta para enviar.'
    : isProcessing
      ? 'Ramiro esta pensando. Espera su respuesta.'
      : isSpeaking
        ? 'Ramiro esta hablando. Espera a que termine.'
        : hasIssue
          ? disabledMessage || latestError || 'La sesion de voz no esta disponible.'
          : 'Mantener pulsado para hablar con Ramiro.';
  const accessibilityLabel = `${assistantName}. ${pressLabel}`;
  const orbLabel = hasIssue
    ? 'Reintenta'
    : isListening
      ? 'hablando'
      : isProcessing
        ? 'Pensando espera'
        : isSpeaking
          ? 'espera y escucha'
          : 'Mantén y habla';
  const orbState = hasIssue
    ? 'error'
    : isListening
      ? 'listening'
      : isProcessing
        ? 'processing'
        : isSpeaking
          ? 'speaking'
          : 'idle';
  const orbStyle = {
    '--voice-energy': visualEnergy.toFixed(3),
    '--voice-mic-scale': (1 + micEnergy * 0.22).toFixed(3),
    '--voice-speaking-scale': (1 + visualEnergy * 0.14).toFixed(3),
  } as React.CSSProperties;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom)+84px,14vh)] z-30 flex justify-center px-4 lg:bottom-[16vh]">
      <div className="pointer-events-auto relative">
        <button
          type="button"
          aria-label={accessibilityLabel}
          title={pressLabel}
          disabled={!isInteractive}
          data-state={orbState}
          onSelect={(event) => event.preventDefault()}
          onSelectStart={(event) => event.preventDefault()}
          onDoubleClick={() => {
            if (status === 'connected') {
              onDisconnect();
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            void onBeginPressToTalk();
          }}
          onPointerUp={(event) => {
            event.preventDefault();
            onEndPressToTalk();
          }}
          onPointerCancel={() => onEndPressToTalk()}
          onPointerLeave={(event) => {
            if (event.buttons === 1) {
              onEndPressToTalk();
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
          className="voice-orb group relative inline-flex h-[96px] w-[96px] touch-none items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-transform duration-200 ease-out hover:scale-[1.04] focus-visible:scale-[1.04] disabled:cursor-not-allowed lg:h-[104px] lg:w-[104px]"
          style={orbStyle}
        >
          <span className="voice-orb__shadow" aria-hidden="true" />
          <span className="voice-orb__ghost" aria-hidden="true" />
          <span className="voice-orb__glow" aria-hidden="true" />

          <span className="voice-orb__processing-orbit" aria-hidden="true" />

          <span className="voice-orb__listening-inner" aria-hidden="true" />
          <span className="voice-orb__listening-wave voice-orb__listening-wave--a" aria-hidden="true" />
          <span className="voice-orb__listening-wave voice-orb__listening-wave--b" aria-hidden="true" />
          <span className="voice-orb__listening-blur" aria-hidden="true" />

          <span className="voice-orb__speaking-ring" aria-hidden="true" />
          <span className="voice-orb__speaking-pulse voice-orb__speaking-pulse--a" aria-hidden="true" />
          <span className="voice-orb__speaking-pulse voice-orb__speaking-pulse--b" aria-hidden="true" />

          <span className="voice-orb__button-face" aria-hidden="true">
            <span className="voice-orb__button-edge" />
            <span className="voice-orb__button-core">
              <span className="voice-orb__button-stack">
                <Mic size={32} strokeWidth={2.35} />
                <span className="voice-orb__button-label">{orbLabel}</span>
              </span>
            </span>
          </span>

          <span className="sr-only">
            {showDebug && logs.length > 0 ? `Ultimo evento: ${logs[logs.length - 1]?.text}. ` : ''}
            {hasIssue ? `Incidencia: ${disabledMessage || latestError || 'Sesion no disponible'}. ` : ''}
            {status === 'connected' ? 'Doble toque para cerrar la sesion de voz.' : ''}
          </span>
        </button>
      </div>
    </div>
  );
}

interface MenuPanelProps {
  menu: MenuItem[];
  menuError: string | null;
  menuLoading: boolean;
  onAddItem: (item: MenuItem, quantity: number, notes?: string) => void;
  onRetry: () => Promise<void>;
}

function MenuPanel({ menu, menuError, menuLoading, onAddItem, onRetry }: MenuPanelProps) {
  if (menuLoading) {
    return (
      <section className="panel flex items-center gap-3 px-6 py-5 text-sm text-stone-500">
        <Loader2 size={16} className="animate-spin" />
        Cargando carta...
      </section>
    );
  }

  if (menuError) {
    return (
      <section className="panel px-6 py-5">
        <div className="flex items-start gap-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5" />
          <div className="space-y-3">
            <p>{menuError}</p>
            <button
              type="button"
              onClick={() => {
                void onRetry();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2.5 text-sm text-stone-700 transition hover:bg-stone-50"
            >
              <RefreshCcw size={16} />
              Reintentar
            </button>
          </div>
        </div>
      </section>
    );
  }

  return <MenuExplorer menu={menu} onAddItem={(item) => onAddItem(item, 1)} />;
}

function DebugPanel({ logs }: { logs: { role: 'assistant' | 'system' | 'error'; text: string; timestamp: number }[] }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-stone-200 px-6 py-5">
        <h2 className="text-base font-semibold text-stone-900">Debug de voz</h2>
      </div>

      <div className="scrollbar-thin max-h-[460px] space-y-2 overflow-y-auto bg-stone-950 px-4 py-4 font-mono text-xs text-stone-300">
        {logs.length === 0 ? <p className="text-stone-500">Todavia no hay eventos.</p> : null}
        {logs.map((log) => (
          <div key={`${log.timestamp}-${log.text}`} className="rounded-md border border-stone-800 px-3 py-2">
            <p className="text-stone-500">{new Date(log.timestamp).toLocaleTimeString('es-ES')}</p>
            <p
              className={`mt-1 ${
                log.role === 'error' ? 'text-red-300' : log.role === 'system' ? 'text-emerald-300' : 'text-stone-200'
              }`}
            >
              {log.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProtectedKitchenRoute({
  authenticated,
  children,
  isLoading,
}: {
  authenticated: boolean;
  children: React.ReactNode;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <main className="page-container flex min-h-screen items-center justify-center py-10">
        <div className="inline-flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
          <Loader2 size={16} className="animate-spin" />
          Comprobando acceso a cocina...
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return <Navigate replace to="/kitchen/login" />;
  }

  return <>{children}</>;
}

function ProtectedAdminRoute({
  authenticated,
  children,
  isLoading,
}: {
  authenticated: boolean;
  children: React.ReactNode;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <main className="page-container flex min-h-screen items-center justify-center py-10">
        <div className="inline-flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
          <Loader2 size={16} className="animate-spin" />
          Comprobando acceso a administracion...
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return <Navigate replace to="/admin/login" />;
  }

  return <>{children}</>;
}

export default App;

