import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Loader2 } from 'lucide-react';

import AdminDashboard from '../components/AdminDashboard';
import { useMenuFeed } from '../hooks/useMenuFeed';
import { useOrdersFeed } from '../hooks/useOrdersFeed';
import type {
  AdminSettings,
  AdminTable,
  AppBranding,
  CreateAdminTableRequest,
  CreateMenuItemRequest,
  MenuItem,
  ReorderMenuRequest,
  TableQrResponse,
  TablesQrBatchResponse,
  UpdateAdminSettingsRequest,
} from '../types';
import {
  createAdminMenuItemOnApi,
  createAdminTableOnApi,
  deleteAdminMenuItemOnApi,
  deleteAdminTableOnApi,
  fetchAdminSettingsFromApi,
  fetchAdminTableQrFromApi,
  fetchAdminTablesFromApi,
  fetchAdminTablesQrBatchFromApi,
  reorderAdminMenuOnApi,
  updateAdminSettingsOnApi,
  updateAdminMenuItemAvailabilityOnApi,
  updateAdminMenuItemOnApi,
  updateAdminTableOnApi,
  updateAdminTableStatusOnApi,
  uploadAdminImageOnApi,
} from '../utils/api';

interface AdminLoginPageProps {
  authenticated: boolean;
  branding: AppBranding;
  errorMessage: string | null;
  isLoading: boolean;
  onLogin: (password: string) => Promise<void>;
}

export function AdminLoginPage({ authenticated, branding, errorMessage, isLoading, onLogin }: AdminLoginPageProps) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (authenticated) {
    return <Navigate replace to="/admin" />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      await onLogin(password);
      navigate('/admin');
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
              <ClipboardList size={18} />
            </span>
            <div>
              <p className="text-sm text-stone-500">{branding.restaurantName}</p>
              <h1 className="text-lg font-semibold text-stone-900">Acceso a administracion</h1>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700">Contrasena admin</span>
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

interface AdminPageProps {
  branding: AppBranding;
  onLogout: () => Promise<void>;
}

export function AdminPage({ branding, onLogout }: AdminPageProps) {
  const navigate = useNavigate();
  const {
    menu,
    setMenu,
    isLoading: menuLoading,
    error: menuError,
    refresh: refreshMenu,
  } = useMenuFeed(true, 'admin');
  const { orders, isLoading: ordersLoading, error: ordersError, refresh: refreshOrders } = useOrdersFeed();
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [settings, setSettings] = useState<AdminSettings>({ showWifiPopup: branding.showWifiPopup, wifiSsid: branding.wifiSsid, wifiPassword: branding.wifiPassword });
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSavingTable, setIsSavingTable] = useState(false);
  const [qrPreview, setQrPreview] = useState<TableQrResponse | null>(null);
  const [qrPreviewLoading, setQrPreviewLoading] = useState(false);
  const [qrPreviewError, setQrPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!actionSuccess) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActionSuccess(null);
    }, 3500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [actionSuccess]);

  const refreshTables = useCallback(async () => {
    try {
      setTablesLoading(true);
      const nextTables = await fetchAdminTablesFromApi();
      setTables(nextTables);
      setTablesError(null);
    } catch (requestError) {
      setTablesError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las mesas.');
    } finally {
      setTablesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTables();
  }, [refreshTables]);

  const refreshSettings = useCallback(async () => {
    try {
      setSettingsLoading(true);
      const nextSettings = await fetchAdminSettingsFromApi();
      setSettings(nextSettings);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las opciones.');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const withMenuAction = useCallback(
    async (action: () => Promise<MenuItem[]>, successMessage: string) => {
      try {
        setIsSaving(true);
        setActionError(null);
        const nextMenu = await action();
        setMenu(nextMenu);
        setActionSuccess(successMessage);
      } catch (requestError) {
        setActionError(requestError instanceof Error ? requestError.message : 'No se pudo guardar el cambio.');
      } finally {
        setIsSaving(false);
      }
    },
    [setMenu],
  );

  const handleSave = useCallback(
    async (itemId: string | null, payload: CreateMenuItemRequest) => {
      await withMenuAction(
        () => (itemId ? updateAdminMenuItemOnApi(itemId, payload) : createAdminMenuItemOnApi(payload)),
        itemId ? 'Plato actualizado.' : 'Plato creado.',
      );
    },
    [withMenuAction],
  );

  const handleDelete = useCallback(async (itemId: string) => {
    await withMenuAction(() => deleteAdminMenuItemOnApi(itemId), 'Plato eliminado.');
  }, [withMenuAction]);

  const handleDuplicate = useCallback(
    async (item: MenuItem) => {
      const payload: CreateMenuItemRequest = {
        name: `${item.name} copia`,
        description: item.description,
        price: item.price,
        category: item.category,
        imageUrl: item.imageUrl ?? null,
        ingredients: item.ingredients,
        allergens: item.allergens,
        dietary: item.dietary,
        available: item.available,
      };

      await withMenuAction(() => createAdminMenuItemOnApi(payload), 'Plato duplicado.');
    },
    [withMenuAction],
  );

  const handleToggleAvailability = useCallback(
    async (itemId: string, available: boolean) => {
      await withMenuAction(
        () => updateAdminMenuItemAvailabilityOnApi(itemId, { available }),
        available ? 'Plato visible en carta.' : 'Plato ocultado de la carta.',
      );
    },
    [withMenuAction],
  );

  const handleMoveItem = useCallback(
    async (itemId: string, direction: 'up' | 'down') => {
      const currentItem = menu.find((item) => item.id === itemId);
      if (!currentItem) {
        return;
      }

      const sameCategoryItems = menu
        .filter((item) => item.category === currentItem.category)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
      const currentIndex = sameCategoryItems.findIndex((item) => item.id === itemId);
      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      const swapTarget = sameCategoryItems[nextIndex];

      if (currentIndex === -1 || !swapTarget) {
        return;
      }

      const reordered = [...sameCategoryItems];
      reordered[currentIndex] = swapTarget;
      reordered[nextIndex] = currentItem;

      const payload: ReorderMenuRequest = {
        items: reordered.map((item, index) => ({
          id: item.id,
          sortOrder: index,
        })),
      };

      await withMenuAction(() => reorderAdminMenuOnApi(payload), 'Orden de carta actualizado.');
    },
    [menu, withMenuAction],
  );

  const handleUploadImage = useCallback(async (file: File) => {
    try {
      setIsUploadingImage(true);
      setActionError(null);
      const { imageUrl } = await uploadAdminImageOnApi(file);
      setActionSuccess('Imagen subida correctamente.');
      return imageUrl;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'No se pudo subir la imagen.';
      setActionError(message);
      throw requestError;
    } finally {
      setIsUploadingImage(false);
    }
  }, []);

  const handleSaveSettings = useCallback(async (payload: UpdateAdminSettingsRequest) => {
    try {
      setIsSavingSettings(true);
      setActionError(null);
      const nextSettings = await updateAdminSettingsOnApi(payload);
      setSettings(nextSettings);
      setActionSuccess('Opciones actualizadas.');
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'No se pudieron guardar las opciones.');
    } finally {
      setIsSavingSettings(false);
    }
  }, []);

  const withTableAction = useCallback(async (action: () => Promise<AdminTable[]>, successMessage: string) => {
    try {
      setIsSavingTable(true);
      setActionError(null);
      const nextTables = await action();
      setTables(nextTables);
      setActionSuccess(successMessage);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'No se pudo guardar la mesa.');
    } finally {
      setIsSavingTable(false);
    }
  }, []);

  const handleSaveTable = useCallback(async (tableId: string | null, payload: CreateAdminTableRequest) => {
    await withTableAction(
      () => (tableId ? updateAdminTableOnApi(tableId, payload) : createAdminTableOnApi(payload)),
      tableId ? 'Mesa actualizada.' : 'Mesa creada.',
    );
  }, [withTableAction]);

  const handleDeleteTable = useCallback(async (tableId: string) => {
    await withTableAction(() => deleteAdminTableOnApi(tableId), 'Mesa eliminada.');
  }, [withTableAction]);

  const handleToggleTableStatus = useCallback(async (tableId: string, active: boolean) => {
    await withTableAction(() => updateAdminTableStatusOnApi(tableId, { active }), active ? 'Mesa activada.' : 'Mesa desactivada.');
  }, [withTableAction]);

  const handlePreviewQr = useCallback(async (tableId: string) => {
    try {
      setQrPreviewLoading(true);
      setQrPreview(null);
      setQrPreviewError(null);
      const preview = await fetchAdminTableQrFromApi(tableId, { origin: window.location.origin });
      setQrPreview(preview);
    } catch (requestError) {
      setQrPreviewError(requestError instanceof Error ? requestError.message : 'No se pudo generar el QR.');
    } finally {
      setQrPreviewLoading(false);
    }
  }, []);

  const handlePrintQr = useCallback((tableId: string) => {
    navigate(`/admin/tables/${encodeURIComponent(tableId)}/print`);
  }, [navigate]);

  const handlePrintSelectedQrs = useCallback((tableIds: string[]) => {
    if (tableIds.length === 0) {
      setActionError('Selecciona al menos una mesa para imprimir.');
      return;
    }

    const query = new URLSearchParams();
    query.set('ids', tableIds.join(','));
    navigate(`/admin/tables/print?${query.toString()}`);
  }, [navigate]);

  const handleLogout = useCallback(async () => {
    await onLogout();
    navigate('/admin/login');
  }, [navigate, onLogout]);

  return (
    <AdminDashboard
      restaurantName={branding.restaurantName}
      menu={menu}
      orders={orders}
      tables={tables}
      settings={settings}
      menuLoading={menuLoading}
      ordersLoading={ordersLoading}
      tablesLoading={tablesLoading}
      settingsLoading={settingsLoading}
      menuError={menuError}
      ordersError={ordersError}
      tablesError={tablesError}
      actionError={actionError}
      actionSuccess={actionSuccess}
      isSaving={isSaving}
      isSavingSettings={isSavingSettings}
      isUploadingImage={isUploadingImage}
      isSavingTable={isSavingTable}
      qrPreview={qrPreview}
      qrPreviewLoading={qrPreviewLoading}
      qrPreviewError={qrPreviewError}
      onSave={(itemId, payload) => handleSave(itemId, payload as CreateMenuItemRequest)}
      onDelete={handleDelete}
      onDuplicate={handleDuplicate}
      onToggleAvailability={handleToggleAvailability}
      onMoveItem={handleMoveItem}
      onUploadImage={handleUploadImage}
      onSaveSettings={handleSaveSettings}
      onSaveTable={(tableId, payload) => handleSaveTable(tableId, payload as CreateAdminTableRequest)}
      onDeleteTable={handleDeleteTable}
      onToggleTableStatus={handleToggleTableStatus}
      onPreviewQr={handlePreviewQr}
      onPrintQr={handlePrintQr}
      onPrintSelectedQrs={handlePrintSelectedQrs}
      onCloseQrPreview={() => {
        setQrPreview(null);
        setQrPreviewError(null);
      }}
      onRefreshMenu={() => {
        setActionError(null);
        void refreshMenu();
      }}
      onRefreshTables={() => {
        setActionError(null);
        void refreshTables();
      }}
      onRefreshSettings={() => {
        setActionError(null);
        void refreshSettings();
      }}
      onRefreshOrders={() => {
        setActionError(null);
        void refreshOrders();
      }}
      onLogout={() => {
        void handleLogout();
      }}
    />
  );
}

interface PrintPageProps {
  branding: AppBranding;
}

export function AdminTablePrintPage({ branding }: PrintPageProps) {
  const navigate = useNavigate();
  const { tableId = '' } = useParams();
  const [payload, setPayload] = useState<TableQrResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        const nextPayload = await fetchAdminTableQrFromApi(tableId, { origin: window.location.origin });
        if (cancelled) {
          return;
        }
        setPayload(nextPayload);
        setError(null);
      } catch (requestError) {
        if (cancelled) {
          return;
        }
        setError(requestError instanceof Error ? requestError.message : 'No se pudo generar el QR.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [tableId]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.print();
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [payload]);

  return (
    <main className="page-container min-h-screen py-10 print:min-h-0 print:py-0">
      <div className="print:hidden mb-6 flex items-center gap-3">
        <button type="button" onClick={() => navigate('/admin')} className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 transition hover:bg-stone-50">
          Volver
        </button>
        <button type="button" onClick={() => window.print()} disabled={!payload} className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white transition hover:bg-black disabled:bg-stone-300">
          Imprimir
        </button>
      </div>

      <section className="panel mx-auto w-full max-w-xl overflow-hidden print:max-w-none print:border-0">
        {isLoading ? <div className="flex items-center gap-2 px-6 py-8 text-sm text-stone-500"><Loader2 size={16} className="animate-spin" />Generando ficha imprimible...</div> : null}
        {error ? <div className="px-6 py-8 text-sm text-red-700">{error}</div> : null}
        {payload ? (
          <div className="space-y-6 px-8 py-10 text-center">
            <p className="text-sm font-medium text-stone-500">{branding.restaurantName}</p>
            <h1 className="text-4xl font-semibold text-stone-900">Mesa {payload.table.number}</h1>
            <p className="text-sm text-stone-500">{payload.table.label || 'Escanea para abrir la mesa'}</p>
            <div className="mx-auto flex w-fit items-center justify-center rounded-xl border border-stone-200 bg-white p-4" dangerouslySetInnerHTML={{ __html: payload.qrSvg }} />
            <p className="break-all text-xs text-stone-500">{payload.qrUrl}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function AdminTablesBatchPrintPage({ branding }: PrintPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState<TablesQrBatchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ids = useMemo(
    () =>
      (searchParams.get('ids') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    [searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        const nextPayload = await fetchAdminTablesQrBatchFromApi({ origin: window.location.origin, tableIds: ids });
        if (cancelled) {
          return;
        }
        setPayload(nextPayload);
        setError(null);
      } catch (requestError) {
        if (cancelled) {
          return;
        }
        setError(requestError instanceof Error ? requestError.message : 'No se pudieron generar los QRs.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  useEffect(() => {
    if (!payload || payload.items.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.print();
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [payload]);

  return (
    <main className="page-container min-h-screen py-10 print:min-h-0 print:py-0">
      <div className="print:hidden mb-6 flex items-center gap-3">
        <button type="button" onClick={() => navigate('/admin')} className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 transition hover:bg-stone-50">
          Volver
        </button>
        <button type="button" onClick={() => window.print()} disabled={!payload || payload.items.length === 0} className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white transition hover:bg-black disabled:bg-stone-300">
          Imprimir lote
        </button>
      </div>

      {isLoading ? <div className="flex items-center gap-2 text-sm text-stone-500"><Loader2 size={16} className="animate-spin" />Generando lote imprimible...</div> : null}
      {error ? <div className="text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-6 print:block">
        {payload?.items.map((item) => (
          <section key={item.table.id} className="panel mx-auto w-full max-w-xl overflow-hidden print:mb-6 print:max-w-none print:break-after-page print:border-0">
            <div className="space-y-6 px-8 py-10 text-center">
              <p className="text-sm font-medium text-stone-500">{branding.restaurantName}</p>
              <h1 className="text-4xl font-semibold text-stone-900">Mesa {item.table.number}</h1>
              <p className="text-sm text-stone-500">{item.table.label || 'Escanea para abrir la mesa'}</p>
              <div className="mx-auto flex w-fit items-center justify-center rounded-xl border border-stone-200 bg-white p-4" dangerouslySetInnerHTML={{ __html: item.qrSvg }} />
              <p className="break-all text-xs text-stone-500">{item.qrUrl}</p>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

export function AdminPageFallback() {
  return (
    <main className="page-container flex min-h-screen items-center justify-center py-10">
      <div className="inline-flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
        <Loader2 size={16} className="animate-spin" />
        Cargando modulo de administracion...
      </div>
    </main>
  );
}
