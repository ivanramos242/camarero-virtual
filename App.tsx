import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ChefHat,
  Loader2,
  Mic,
  MicOff,
  QrCode,
  RefreshCcw,
  Shield,
  Store,
  TerminalSquare,
} from 'lucide-react';

import KitchenDashboard from './components/KitchenDashboard';
import MenuExplorer from './components/MenuExplorer';
import OrderStatus from './components/OrderStatus';
import OrderSummary from './components/OrderSummary';
import Visualizer from './components/Visualizer';
import { useKitchenSession } from './hooks/useKitchenSession';
import { useLiveSession } from './hooks/useLiveSession';
import { useOrdersFeed } from './hooks/useOrdersFeed';
import type { AppBranding, CartItem, MenuItem, OrderStatus as OrderState, PersistedOrder } from './types';
import {
  createOrderOnApi,
  createVoiceSessionToken,
  fetchMenuFromApi,
  fetchPublicConfig,
  updateOrderStatusOnApi,
} from './utils/api';

const defaultBranding: AppBranding = {
  restaurantName: 'Camarero Virtual',
  assistantName: 'Ramiro',
  kitchenName: 'Cocina',
  tagline: 'Pedidos por voz y carta digital',
  supportManualOrdering: true,
  showDebugTools: false,
  voiceEnabled: false,
  voiceProvider: 'none',
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

function upsertOrder(orderList: PersistedOrder[], nextOrder: PersistedOrder) {
  return [nextOrder, ...orderList.filter((order) => order.id !== nextOrder.id)];
}

function App() {
  const [branding, setBranding] = useState<AppBranding>(defaultBranding);
  const [configError, setConfigError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  const kitchenSession = useKitchenSession();

  const loadConfig = useCallback(async () => {
    try {
      const config = await fetchPublicConfig();
      setBranding(config);
      setConfigError(null);
    } catch (requestError) {
      setConfigError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la configuracion publica.');
    }
  }, []);

  const loadMenu = useCallback(async () => {
    try {
      setMenuLoading(true);
      const items = await fetchMenuFromApi();
      setMenu(items);
      setMenuError(null);
    } catch (requestError) {
      setMenuError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la carta.');
    } finally {
      setMenuLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadMenu();
  }, [loadConfig, loadMenu]);

  return (
    <div className="app-shell">
      <Routes>
        <Route
          path="/"
          element={<HomePage authenticated={kitchenSession.authenticated} branding={branding} configError={configError} />}
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
              refreshMenu={loadMenu}
            />
          }
        />
        <Route
          path="/kitchen/login"
          element={
            <KitchenLoginPage
              authenticated={kitchenSession.authenticated}
              branding={branding}
              errorMessage={kitchenSession.error}
              isLoading={kitchenSession.isLoading}
              onLogin={kitchenSession.login}
            />
          }
        />
        <Route
          path="/kitchen"
          element={
            <ProtectedKitchenRoute authenticated={kitchenSession.authenticated} isLoading={kitchenSession.isLoading}>
              <KitchenPage branding={branding} onLogout={kitchenSession.logout} />
            </ProtectedKitchenRoute>
          }
        />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </div>
  );
}

interface HomePageProps {
  authenticated: boolean;
  branding: AppBranding;
  configError: string | null;
}

function HomePage({ authenticated, branding, configError }: HomePageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const legacyTable = searchParams.get('mesa')?.trim();
  const [tableNumber, setTableNumber] = useState(legacyTable || '1');

  if (legacyTable) {
    return <Navigate replace to={`/mesa/${encodeURIComponent(legacyTable)}`} />;
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTable = tableNumber.trim() || '1';
    navigate(`/mesa/${encodeURIComponent(nextTable)}`);
  };

  return (
    <main className="page-container flex min-h-screen items-center py-10">
      <div className="grid w-full gap-6 lg:grid-cols-[1.25fr_0.95fr]">
        <section className="panel overflow-hidden">
          <div className="border-b border-stone-200 px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-stone-900 text-white">
                <Store size={18} />
              </span>
              <div>
                <p className="text-sm font-medium text-stone-500">{branding.restaurantName}</p>
                <h1 className="text-xl font-semibold text-stone-900">{branding.tagline}</h1>
              </div>
            </div>
          </div>

          <div className="space-y-5 px-6 py-6">
            <p className="max-w-2xl text-sm leading-6 text-stone-600">
              Esta version ya funciona con backend propio para pedidos, estado de cocina y sesiones protegidas. El acceso
              mas comodo para clientes es entrar por una URL directa de mesa o desde un QR.
            </p>

            {configError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {configError}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="panel-muted max-w-md space-y-4 p-4">
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

        <section className="space-y-4">
          <article className="panel p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
                <ChefHat size={18} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-stone-900">Acceso cocina</h2>
                <p className="text-sm text-stone-500">Panel protegido con sesion de personal.</p>
              </div>
            </div>

            <div className="mt-5">
              <Link
                to={authenticated ? '/kitchen' : '/kitchen/login'}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
              >
                <Shield size={16} />
                {authenticated ? 'Entrar al panel de cocina' : 'Ir al login de cocina'}
              </Link>
            </div>
          </article>

          <article className="panel p-5">
            <h2 className="text-base font-semibold text-stone-900">Estado del sistema</h2>
            <div className="mt-4 space-y-3 text-sm text-stone-600">
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
        </section>
      </div>
    </main>
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
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [clientName, setClientName] = useState('Cliente');
  const [dinersCount, setDinersCount] = useState(1);
  const [draftClientName, setDraftClientName] = useState('');
  const [draftDinersCount, setDraftDinersCount] = useState(2);
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
      setIsSessionModalOpen(true);
      return;
    }

    try {
      const parsedSession = JSON.parse(savedSession) as { clientName?: string; dinersCount?: number };

      if (parsedSession.clientName?.trim()) {
        setClientName(parsedSession.clientName.trim());
        setDraftClientName(parsedSession.clientName.trim());
      }

      if (typeof parsedSession.dinersCount === 'number' && parsedSession.dinersCount >= 1) {
        const nextDinersCount = Math.max(1, parsedSession.dinersCount);
        setDinersCount(nextDinersCount);
        setDraftDinersCount(nextDinersCount);
      }

      setIsSessionModalOpen(false);
    } catch {
      window.sessionStorage.removeItem(storageKey);
      setIsSessionModalOpen(true);
    }
  }, [tableNumber]);

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

    if (!trimmedName || !tableNumber) {
      return;
    }

    const nextDinersCount = Math.max(1, draftDinersCount);

    setClientName(trimmedName);
    setDinersCount(nextDinersCount);
    setIsSessionModalOpen(false);

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(
        getSessionDetailsStorageKey(tableNumber),
        JSON.stringify({
          clientName: trimmedName,
          dinersCount: nextDinersCount,
        }),
      );
    }
  }, [draftClientName, draftDinersCount, tableNumber]);

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
          }),
        );
      }
    },
    [dinersCount, tableNumber],
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
          }),
        );
      }
    },
    [clientName, tableNumber],
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
    [cartItems, setOrders, tableNumber],
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

  const latestVoiceError = useMemo(() => {
    const latestError = [...voiceSession.logs].reverse().find((log) => log.role === 'error');
    return latestError?.text ?? null;
  }, [voiceSession.logs]);

  const viewTabs = useMemo(() => {
    const tabs: Array<{ value: DiningView; label: string; icon: typeof Mic }> = [];

    if (debugEnabled) {
      tabs.push({ value: 'debug', label: 'Debug', icon: TerminalSquare });
    }

    return tabs;
  }, [debugEnabled]);

  return (
    <div className="page-container py-5">
      <SessionDetailsModal
        clientName={draftClientName}
        dinersCount={draftDinersCount}
        isOpen={isSessionModalOpen}
        onClientNameChange={setDraftClientName}
        onDinersChange={setDraftDinersCount}
        onConfirm={handleSessionDetailsSubmit}
      />

      <header className="panel mb-6 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-stone-200 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex h-11 w-11 items-center justify-center rounded-lg bg-stone-900 text-white">
              <ChefHat size={18} />
            </Link>
            <div>
              <p className="text-sm text-stone-500">{branding.restaurantName}</p>
              <h1 className="text-lg font-semibold text-stone-900">Mesa {tableNumber}</h1>
            </div>
          </div>

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
        </div>

        {(configError || menuError || ordersError) ? (
          <div className="space-y-2 bg-amber-50 px-6 py-4 text-sm text-amber-900">
            {configError ? <p>{configError}</p> : null}
            {menuError ? <p>{menuError}</p> : null}
            {ordersError ? <p>{ordersError}</p> : null}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6">
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
                  isMuted={voiceSession.isMuted}
                  onConnect={voiceSession.connect}
                  onDisconnect={voiceSession.disconnect}
                  onToggleMute={() => voiceSession.setIsMuted((previousState) => !previousState)}
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
            </>
          ) : null}

          {activeView === 'debug' && debugEnabled ? <DebugPanel logs={voiceSession.logs} /> : null}
        </section>

        <aside className="space-y-6">
          <OrderSummary
            items={cartItems}
            total={totalPrice}
            tableNumber={tableNumber}
            dinersCount={dinersCount}
            clientName={clientName}
            onClientNameChange={handleClientNameChange}
            onDinersChange={handleDinersChange}
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
    </div>
  );
}

interface SessionDetailsModalProps {
  clientName: string;
  dinersCount: number;
  isOpen: boolean;
  onClientNameChange: (value: string) => void;
  onDinersChange: (value: number) => void;
  onConfirm: () => void;
}

function SessionDetailsModal({
  clientName,
  dinersCount,
  isOpen,
  onClientNameChange,
  onDinersChange,
  onConfirm,
}: SessionDetailsModalProps) {
  if (!isOpen) {
    return null;
  }

  const dinersOptions = [1, 2, 3, 4, 5, 6, 7];
  const canContinue = clientName.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl shadow-stone-950/10">
        <div className="border-b border-stone-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-stone-900">Nueva sesi&oacute;n</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Antes de empezar, necesitamos el nombre del cliente y cu&aacute;ntos comensales hay en la mesa.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6">
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
            <div className="grid grid-cols-4 gap-2">
              {dinersOptions.map((option) => {
                const isSelected = dinersCount === option;
                const label = option === 7 ? '7+' : String(option);

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
        </div>

        <div className="border-t border-stone-200 bg-stone-50 px-6 py-4">
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
  isMuted: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
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
  isMuted,
  onConnect,
  onDisconnect,
  onToggleMute,
  showDebug,
  volumeLevel,
}: AssistantPanelProps) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-stone-200 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-stone-900">{assistantName}</h2>
            <p className="mt-1 text-sm text-stone-500">Puedes pedir por voz, corregir platos y confirmar sin tocar la carta.</p>
          </div>

          <span
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              status === 'connected'
                ? 'bg-emerald-50 text-emerald-700'
                : status === 'connecting'
                  ? 'bg-amber-50 text-amber-800'
                  : status === 'error'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-stone-100 text-stone-700'
            }`}
          >
            {status === 'connected' ? 'Activo' : status === 'connecting' ? 'Conectando' : status === 'error' ? 'Error' : 'En espera'}
          </span>
        </div>
      </div>

      <div className="space-y-5 px-6 py-6">
        <div className="panel-muted p-5">
          {status === 'connecting' ? (
            <div className="flex items-center gap-3 text-sm text-stone-600">
              <Loader2 size={16} className="animate-spin" />
              Abriendo sesion de voz...
            </div>
          ) : status === 'connected' ? (
            <div className="space-y-4">
              <Visualizer isActive={!isMuted} volume={volumeLevel} />
              <div className="space-y-2 text-sm text-stone-600">
                <p>Sesion lista. Habla con naturalidad y usa la carta manual si quieres ajustar algo rapido.</p>
                {lastAssistantMessage ? (
                  <p className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-stone-800">{lastAssistantMessage}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-stone-600">
              <p>La carta y la cocina siguen funcionando aunque no uses voz.</p>
              {disabled ? <p className="rounded-lg bg-amber-50 px-4 py-3 text-amber-900">{disabledMessage}</p> : null}
              {latestError ? <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{latestError}</p> : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(status === 'disconnected' || status === 'error') ? (
            <button
              type="button"
              onClick={onConnect}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:bg-stone-300"
            >
              <Mic size={16} />
              Iniciar voz
            </button>
          ) : null}

          {status === 'connected' ? (
            <>
              <button
                type="button"
                onClick={onToggleMute}
                className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-3 text-sm text-stone-800 transition hover:bg-stone-50"
              >
                {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                {isMuted ? 'Activar micro' : 'Silenciar'}
              </button>

              <button
                type="button"
                onClick={onDisconnect}
                className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-3 text-sm text-stone-800 transition hover:bg-stone-50"
              >
                Cerrar sesion
              </button>
            </>
          ) : null}
        </div>

        {showDebug && logs.length > 0 ? (
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            Ultimo evento: {logs[logs.length - 1]?.text}
          </div>
        ) : null}
      </div>
    </section>
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

interface KitchenLoginPageProps {
  authenticated: boolean;
  branding: AppBranding;
  errorMessage: string | null;
  isLoading: boolean;
  onLogin: (password: string) => Promise<void>;
}

function KitchenLoginPage({ authenticated, branding, errorMessage, isLoading, onLogin }: KitchenLoginPageProps) {
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

function KitchenPage({ branding, onLogout }: { branding: AppBranding; onLogout: () => Promise<void> }) {
  const navigate = useNavigate();
  const { orders, setOrders, isLoading, error, refresh } = useOrdersFeed();
  const [pendingOrderIds, setPendingOrderIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

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

  return (
    <KitchenDashboard
      orders={orders}
      restaurantName={branding.restaurantName}
      kitchenName={branding.kitchenName}
      isLoading={isLoading}
      errorMessage={actionError || error}
      pendingOrderIds={pendingOrderIds}
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

export default App;
