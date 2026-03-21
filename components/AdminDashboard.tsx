import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Copy,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import type { CreateMenuItemRequest, MenuItem, PersistedOrder, UpdateMenuItemRequest } from '../types';

interface AdminDashboardProps {
  restaurantName: string;
  menu: MenuItem[];
  orders: PersistedOrder[];
  menuLoading: boolean;
  ordersLoading: boolean;
  menuError?: string | null;
  ordersError?: string | null;
  actionError?: string | null;
  actionSuccess?: string | null;
  isSaving: boolean;
  isUploadingImage: boolean;
  onSave: (itemId: string | null, payload: CreateMenuItemRequest | UpdateMenuItemRequest) => Promise<void>;
  onDelete: (itemId: string) => Promise<void>;
  onDuplicate: (item: MenuItem) => Promise<void>;
  onToggleAvailability: (itemId: string, available: boolean) => Promise<void>;
  onMoveItem: (itemId: string, direction: 'up' | 'down') => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
  onRefreshMenu: () => void;
  onRefreshOrders: () => void;
  onLogout: () => void;
}

interface MenuFormState {
  name: string;
  description: string;
  price: string;
  category: string;
  imageUrl: string;
  ingredients: string;
  allergens: string;
  dietary: string;
  available: boolean;
}

const emptyFormState: MenuFormState = {
  name: '',
  description: '',
  price: '',
  category: '',
  imageUrl: '',
  ingredients: '',
  allergens: '',
  dietary: '',
  available: true,
};

const orderStatusLabel: Record<PersistedOrder['status'], string> = {
  pending: 'Pendiente',
  cooking: 'En cocina',
  ready: 'Listo',
  served: 'Servido',
};

const toFormState = (item: MenuItem): MenuFormState => ({
  name: item.name,
  description: item.description,
  price: item.price.toFixed(2),
  category: item.category,
  imageUrl: item.imageUrl ?? '',
  ingredients: item.ingredients.join(', '),
  allergens: item.allergens.join(', '),
  dietary: item.dietary.join(', '),
  available: item.available,
});

const toList = (rawValue: string) =>
  rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const getPayloadFromForm = (formState: MenuFormState): CreateMenuItemRequest => ({
  name: formState.name.trim(),
  description: formState.description.trim(),
  price: Number(formState.price),
  category: formState.category.trim(),
  imageUrl: formState.imageUrl.trim() || null,
  ingredients: toList(formState.ingredients),
  allergens: toList(formState.allergens),
  dietary: toList(formState.dietary),
  available: formState.available,
});

const AdminDashboard: React.FC<AdminDashboardProps> = ({
  restaurantName,
  menu,
  orders,
  menuLoading,
  ordersLoading,
  menuError,
  ordersError,
  actionError,
  actionSuccess,
  isSaving,
  isUploadingImage,
  onSave,
  onDelete,
  onDuplicate,
  onToggleAvailability,
  onMoveItem,
  onUploadImage,
  onRefreshMenu,
  onRefreshOrders,
  onLogout,
}) => {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [formState, setFormState] = useState<MenuFormState>(emptyFormState);

  useEffect(() => {
    if (!selectedItemId) {
      setFormState(emptyFormState);
      return;
    }

    const selectedItem = menu.find((item) => item.id === selectedItemId);
    if (!selectedItem) {
      setSelectedItemId(null);
      setFormState(emptyFormState);
      return;
    }

    setFormState(toFormState(selectedItem));
  }, [menu, selectedItemId]);

  const categories = useMemo(
    () => Array.from(new Set<string>(menu.map((item) => item.category))).sort((left, right) => left.localeCompare(right, 'es')),
    [menu],
  );

  const groupedMenu = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();

    menu.forEach((item) => {
      const currentGroup = groups.get(item.category) ?? [];
      currentGroup.push(item);
      groups.set(item.category, currentGroup);
    });

    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'es'))
      .map(([category, items]) => ({
        category,
        items: [...items].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)),
      }));
  }, [menu]);

  const stats = useMemo(() => {
    const activeOrders = orders.filter((order) => order.status !== 'served').length;
    const visibleItems = menu.filter((item) => item.available).length;
    const hiddenItems = menu.length - visibleItems;

    return {
      activeOrders,
      visibleItems,
      hiddenItems,
    };
  }, [menu, orders]);

  const recentOrders = useMemo(() => orders.slice(0, 8), [orders]);
  const selectedItem = selectedItemId ? menu.find((item) => item.id === selectedItemId) ?? null : null;
  const canSubmit =
    formState.name.trim().length > 0 && formState.category.trim().length > 0 && formState.price.trim().length > 0;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(selectedItemId, getPayloadFromForm(formState));

    if (!selectedItemId) {
      setFormState(emptyFormState);
    }
  };

  return (
    <div className="page-container py-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-6">
          <section className="panel overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-stone-200 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900 text-white">
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <h1 className="text-lg font-semibold text-stone-900">Administracion</h1>
                    <p className="text-sm text-stone-500">{restaurantName}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onRefreshMenu}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
                >
                  <RefreshCcw size={16} />
                  Carta
                </button>
                <button
                  type="button"
                  onClick={onRefreshOrders}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
                >
                  <ClipboardList size={16} />
                  Pedidos
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
                >
                  <LogOut size={16} />
                  Salir
                </button>
              </div>
            </div>

            <div className="grid gap-4 border-b border-stone-200 bg-stone-50 px-6 py-4 md:grid-cols-3">
              <div>
                <p className="text-sm text-stone-500">Pedidos activos</p>
                <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.activeOrders}</p>
              </div>
              <div>
                <p className="text-sm text-stone-500">Platos visibles</p>
                <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.visibleItems}</p>
              </div>
              <div>
                <p className="text-sm text-stone-500">Ocultos o agotados</p>
                <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.hiddenItems}</p>
              </div>
            </div>

            {(menuError || ordersError || actionError || actionSuccess) ? (
              <div className="space-y-2 px-6 py-4 text-sm">
                {menuError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{menuError}</p> : null}
                {ordersError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{ordersError}</p> : null}
                {actionError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{actionError}</p> : null}
                {actionSuccess ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">{actionSuccess}</p> : null}
              </div>
            ) : null}
          </section>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5">
              <div>
                <h2 className="text-base font-semibold text-stone-900">Carta</h2>
                <p className="mt-1 text-sm text-stone-500">Edita precios, textos, categorias y disponibilidad en tiempo real.</p>
              </div>
              {menuLoading ? (
                <div className="inline-flex items-center gap-2 text-sm text-stone-500">
                  <Loader2 size={16} className="animate-spin" />
                  Actualizando
                </div>
              ) : null}
            </div>

            <div className="space-y-5 px-6 py-5">
              {groupedMenu.length === 0 && !menuLoading ? (
                <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm text-stone-500">
                  Todavia no hay platos guardados.
                </div>
              ) : null}

              {groupedMenu.map((group) => (
                <div key={group.category} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-stone-900">{group.category}</h3>
                    <span className="text-xs text-stone-500">{group.items.length} platos</span>
                  </div>

                  <div className="space-y-3">
                    {group.items.map((item, index) => (
                      <article key={item.id} className="rounded-xl border border-stone-200 bg-white p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-stone-900">{item.name}</p>
                              <span
                                className={`rounded-md px-2 py-1 text-xs font-medium ${
                                  item.available ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'
                                }`}
                              >
                                {item.available ? 'Visible' : 'Oculto'}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-stone-500">{item.description || 'Sin descripcion.'}</p>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-500">
                              <span>{item.price.toFixed(2)} EUR</span>
                              <span>Ingredientes: {item.ingredients.length > 0 ? item.ingredients.join(', ') : 'Sin definir'}</span>
                              <span>Alergenos: {item.allergens.length > 0 ? item.allergens.join(', ') : 'Sin definir'}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void onMoveItem(item.id, 'up')}
                              disabled={index === 0 || isSaving}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-400"
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void onMoveItem(item.id, 'down')}
                              disabled={index === group.items.length - 1 || isSaving}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-400"
                            >
                              <ArrowDown size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedItemId(item.id);
                              }}
                              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
                            >
                              <Pencil size={15} />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDuplicate(item)}
                              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
                            >
                              <Copy size={15} />
                              Duplicar
                            </button>
                            <button
                              type="button"
                              onClick={() => void onToggleAvailability(item.id, !item.available)}
                              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50"
                            >
                              {item.available ? 'Ocultar' : 'Mostrar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDelete(item.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-700 transition hover:bg-red-50"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5">
              <div>
                <h2 className="text-base font-semibold text-stone-900">Pedidos recientes</h2>
                <p className="mt-1 text-sm text-stone-500">Vista operativa para revisar mesas y detectar bloqueos.</p>
              </div>
              {ordersLoading ? (
                <div className="inline-flex items-center gap-2 text-sm text-stone-500">
                  <Loader2 size={16} className="animate-spin" />
                  Actualizando
                </div>
              ) : null}
            </div>

            <div className="space-y-3 px-6 py-5">
              {recentOrders.length === 0 && !ordersLoading ? (
                <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm text-stone-500">
                  No hay pedidos todavia.
                </div>
              ) : null}

              {recentOrders.map((order) => (
                <article key={order.id} className="rounded-xl border border-stone-200 bg-white px-4 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-stone-900">Mesa {order.tableNumber}</p>
                        <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">
                          {orderStatusLabel[order.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-stone-500">
                        {order.clientName} · {order.diners} comensales · {order.totalPrice.toFixed(2)} EUR
                      </p>
                    </div>
                    <p className="text-xs text-stone-500">
                      {new Date(order.createdAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-500">
                    {order.items.map((item) => (
                      <span key={item.id} className="rounded-md bg-stone-100 px-2 py-1">
                        {item.quantity}x {item.name}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="space-y-6">
          <section className="panel overflow-hidden">
            <div className="border-b border-stone-200 px-6 py-5">
              <h2 className="text-base font-semibold text-stone-900">{selectedItem ? 'Editar plato' : 'Nuevo plato'}</h2>
              <p className="mt-1 text-sm text-stone-500">
                {selectedItem ? 'Actualiza los datos y guarda sin salir del panel.' : 'Crea un plato nuevo y asignalo a una categoria.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Nombre</span>
                <input
                  value={formState.name}
                  onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                  placeholder="Ej. Tarta de queso"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Descripcion</span>
                <textarea
                  rows={3}
                  value={formState.description}
                  onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                  placeholder="Describe el plato en una linea clara."
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-stone-700">Precio</span>
                  <input
                    inputMode="decimal"
                    value={formState.price}
                    onChange={(event) => setFormState((current) => ({ ...current, price: event.target.value }))}
                    className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                    placeholder="12.50"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-stone-700">Categoria</span>
                  <input
                    list="menu-categories"
                    value={formState.category}
                    onChange={(event) => setFormState((current) => ({ ...current, category: event.target.value }))}
                    className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                    placeholder="Entrantes"
                  />
                  <datalist id="menu-categories">
                    {categories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Imagen URL</span>
                <input
                  value={formState.imageUrl}
                  onChange={(event) => setFormState((current) => ({ ...current, imageUrl: event.target.value }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                  placeholder="https://..."
                />
              </label>

              <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-stone-800">Subir imagen desde archivo</p>
                    <p className="text-xs text-stone-500">JPG, PNG, WEBP o GIF. Maximo 5 MB.</p>
                  </div>
                  {isUploadingImage ? (
                    <span className="inline-flex items-center gap-2 text-xs text-stone-500">
                      <Loader2 size={14} className="animate-spin" />
                      Subiendo
                    </span>
                  ) : null}
                </div>

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      return;
                    }

                    void onUploadImage(file).then((imageUrl) => {
                      setFormState((current) => ({ ...current, imageUrl }));
                    });
                    event.currentTarget.value = '';
                  }}
                  className="block w-full text-sm text-stone-600 file:mr-4 file:rounded-lg file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                />

                {formState.imageUrl ? (
                  <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                    <img src={formState.imageUrl} alt="Vista previa del plato" className="h-44 w-full object-cover" />
                  </div>
                ) : null}
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Ingredientes</span>
                <input
                  value={formState.ingredients}
                  onChange={(event) => setFormState((current) => ({ ...current, ingredients: event.target.value }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                  placeholder="tomate, mozzarella, albahaca"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Alergenos</span>
                <input
                  value={formState.allergens}
                  onChange={(event) => setFormState((current) => ({ ...current, allergens: event.target.value }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                  placeholder="gluten, lacteos"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Etiquetas dietarias</span>
                <input
                  value={formState.dietary}
                  onChange={(event) => setFormState((current) => ({ ...current, dietary: event.target.value }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                  placeholder="vegano, sin gluten"
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
                <div>
                  <p className="text-sm font-medium text-stone-800">Disponible en carta</p>
                  <p className="text-xs text-stone-500">Si lo desactivas, desaparece de la vista del cliente.</p>
                </div>
                <input
                  type="checkbox"
                  checked={formState.available}
                  onChange={(event) => setFormState((current) => ({ ...current, available: event.target.checked }))}
                  className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600"
                />
              </label>

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={!canSubmit || isSaving}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:bg-stone-300"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  {selectedItem ? 'Guardar cambios' : 'Crear plato'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedItemId(null);
                    setFormState(emptyFormState);
                  }}
                  className="inline-flex items-center justify-center rounded-lg border border-stone-300 px-4 py-3 text-sm text-stone-700 transition hover:bg-stone-50"
                >
                  Limpiar
                </button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default AdminDashboard;
