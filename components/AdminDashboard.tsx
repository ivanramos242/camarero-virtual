
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Copy, Eye, Loader2, LogOut, Pencil, Plus, Printer, QrCode, RefreshCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import type { AdminSettings, AdminTable, CreateAdminTableRequest, CreateMenuItemRequest, MenuItem, PersistedOrder, TableQrResponse, UpdateAdminSettingsRequest, UpdateAdminTableRequest, UpdateMenuItemRequest, VoiceTraceEntry } from '../types';

type MenuForm = { name: string; description: string; price: string; category: string; imageUrl: string; ingredients: string; allergens: string; dietary: string; voiceAliases: string; available: boolean };
type TableForm = { number: string; label: string };
type SettingsForm = { showWifiPopup: boolean; wifiSsid: string; wifiPassword: string };
type AdminSection = 'menu' | 'tables' | 'orders' | 'settings';

interface Props {
  restaurantName: string;
  menu: MenuItem[];
  orders: PersistedOrder[];
  tables: AdminTable[];
  settings: AdminSettings;
  voiceTraces: VoiceTraceEntry[];
  menuLoading: boolean;
  ordersLoading: boolean;
  tablesLoading: boolean;
  settingsLoading: boolean;
  voiceTracesLoading: boolean;
  menuError?: string | null;
  ordersError?: string | null;
  tablesError?: string | null;
  voiceTracesError?: string | null;
  actionError?: string | null;
  actionSuccess?: string | null;
  isSaving: boolean;
  isSavingSettings: boolean;
  isUploadingImage: boolean;
  isSavingTable: boolean;
  qrPreview: TableQrResponse | null;
  qrPreviewLoading: boolean;
  qrPreviewError?: string | null;
  onSave: (itemId: string | null, payload: CreateMenuItemRequest | UpdateMenuItemRequest) => Promise<void>;
  onDelete: (itemId: string) => Promise<void>;
  onDuplicate: (item: MenuItem) => Promise<void>;
  onToggleAvailability: (itemId: string, available: boolean) => Promise<void>;
  onMoveItem: (itemId: string, direction: 'up' | 'down') => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
  onSaveSettings: (payload: UpdateAdminSettingsRequest) => Promise<void>;
  onRefreshMenu: () => void;
  onRefreshOrders: () => void;
  onRefreshTables: () => void;
  onRefreshSettings: () => void;
  onRefreshVoiceTraces: () => void;
  onSaveTable: (tableId: string | null, payload: CreateAdminTableRequest | UpdateAdminTableRequest) => Promise<void>;
  onDeleteTable: (tableId: string) => Promise<void>;
  onToggleTableStatus: (tableId: string, active: boolean) => Promise<void>;
  onPreviewQr: (tableId: string) => Promise<void>;
  onPrintQr: (tableId: string) => void;
  onPrintSelectedQrs: (tableIds: string[]) => void;
  onCloseQrPreview: () => void;
  onLogout: () => void;
}

const emptyMenu: MenuForm = { name: '', description: '', price: '', category: '', imageUrl: '', ingredients: '', allergens: '', dietary: '', voiceAliases: '', available: true };
const emptyTable: TableForm = { number: '', label: '' };
const emptySettings: SettingsForm = { showWifiPopup: false, wifiSsid: '', wifiPassword: '' };
const orderLabel: Record<PersistedOrder['status'], string> = { pending: 'Pendiente', cooking: 'En cocina', ready: 'Listo', served: 'Servido' };
const toList = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);
const toMenuPayload = (form: MenuForm): CreateMenuItemRequest => ({ name: form.name.trim(), description: form.description.trim(), price: Number(form.price), category: form.category.trim(), imageUrl: form.imageUrl.trim() || null, ingredients: toList(form.ingredients), allergens: toList(form.allergens), dietary: toList(form.dietary), voiceAliases: toList(form.voiceAliases), available: form.available });
const toTablePayload = (form: TableForm): CreateAdminTableRequest => ({ number: form.number.trim(), label: form.label.trim() || undefined });

export default function AdminDashboard(props: Props) {
  const [activeSection, setActiveSection] = useState<AdminSection>('menu');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [menuForm, setMenuForm] = useState<MenuForm>(emptyMenu);
  const [tableForm, setTableForm] = useState<TableForm>(emptyTable);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(emptySettings);
  const [menuSearch, setMenuSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);

  useEffect(() => {
    const item = props.menu.find((entry) => entry.id === selectedItemId);
    setMenuForm(item ? { name: item.name, description: item.description, price: item.price.toFixed(2), category: item.category, imageUrl: item.imageUrl ?? '', ingredients: item.ingredients.join(', '), allergens: item.allergens.join(', '), dietary: item.dietary.join(', '), voiceAliases: (item.voiceAliases ?? []).join(', '), available: item.available } : emptyMenu);
  }, [props.menu, selectedItemId]);

  useEffect(() => {
    const table = props.tables.find((entry) => entry.id === selectedTableId);
    setTableForm(table ? { number: table.number, label: table.label ?? '' } : emptyTable);
  }, [props.tables, selectedTableId]);

  useEffect(() => {
    setSettingsForm({
      showWifiPopup: props.settings.showWifiPopup,
      wifiSsid: props.settings.wifiSsid,
      wifiPassword: props.settings.wifiPassword,
    });
  }, [props.settings]);

  useEffect(() => {
    if (selectedItemId) setActiveSection('menu');
  }, [selectedItemId]);

  useEffect(() => {
    if (selectedTableId) setActiveSection('tables');
  }, [selectedTableId]);

  const categories = useMemo(() => Array.from(new Set<string>(props.menu.map((item) => item.category))).sort((a, b) => a.localeCompare(b, 'es')), [props.menu]);
  const groupedMenu = useMemo(() => Array.from(props.menu.reduce((map, item) => map.set(item.category, [...(map.get(item.category) ?? []), item]), new Map<string, MenuItem[]>()).entries()).sort(([a], [b]) => a.localeCompare(b, 'es')), [props.menu]);
  const filteredGroupedMenu = useMemo(() => {
    const search = menuSearch.trim().toLowerCase();
    if (!search) {
      return groupedMenu;
    }

    return groupedMenu
      .map(([category, items]) => [
        category,
        items.filter((item) =>
          [
            item.name,
            item.description,
            item.category,
            item.ingredients.join(' '),
            (item.voiceAliases ?? []).join(' '),
            item.allergens.join(' '),
            item.dietary.join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(search),
        ),
      ] as [string, MenuItem[]])
      .filter(([, items]) => items.length > 0);
  }, [groupedMenu, menuSearch]);
  const filteredTables = useMemo(() => {
    const search = tableSearch.trim().toLowerCase();
    return search ? props.tables.filter((table) => table.number.toLowerCase().includes(search) || (table.label ?? '').toLowerCase().includes(search)) : props.tables;
  }, [props.tables, tableSearch]);

  useEffect(() => {
    setSelectedTableIds((current) => current.filter((id) => props.tables.some((table) => table.id === id)));
  }, [props.tables]);

  const stats = {
    activeOrders: props.orders.filter((order) => order.status !== 'served').length,
    visibleItems: props.menu.filter((item) => item.available).length,
    hiddenItems: props.menu.filter((item) => !item.available).length,
    activeTables: props.tables.filter((table) => table.active).length,
  };

  const navItems: Array<{ id: AdminSection; label: string; helper: string; icon: React.ReactNode }> = [
    { id: 'menu', label: 'Carta', helper: `${props.menu.length} platos`, icon: <Plus size={16} /> },
    { id: 'tables', label: 'Mesas y QR', helper: `${props.tables.length} mesas`, icon: <QrCode size={16} /> },
    { id: 'orders', label: 'Pedidos', helper: `${stats.activeOrders} activos`, icon: <ClipboardList size={16} /> },
    { id: 'settings', label: 'Opciones', helper: 'Wi-Fi y experiencia', icon: <Pencil size={16} /> },
  ];

  const recentOrders = props.orders.slice(0, 8);

  return (
    <>
      <div className="page-container py-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[248px_minmax(0,1fr)_360px]">
          <aside className="hidden space-y-6 2xl:sticky 2xl:top-6 2xl:block 2xl:self-start">
            <section className="panel overflow-hidden">
              <div className="border-b border-stone-200 px-5 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-900 text-white shadow-sm">
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Panel admin</p>
                    <h1 className="mt-1 text-lg font-semibold text-stone-900">Administracion</h1>
                    <p className="text-sm text-stone-500">{props.restaurantName}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2 px-3 py-3">
                {navItems.map((item) => (
                  <SidebarNavButton key={item.id} active={activeSection === item.id} icon={item.icon} label={item.label} helper={item.helper} onClick={() => setActiveSection(item.id)} />
                ))}
              </div>
              <div className="grid gap-3 border-t border-stone-200 bg-stone-50 px-4 py-4">
                <StatCard label="Pedidos activos" value={stats.activeOrders} tone="amber" />
                <StatCard label="Platos visibles" value={stats.visibleItems} />
                <StatCard label="Mesas activas" value={stats.activeTables} />
                <StatCard label="Ocultos" value={stats.hiddenItems} tone="muted" />
              </div>
              <div className="border-t border-stone-200 px-4 py-4">
                <button type="button" onClick={props.onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
                  <LogOut size={16} />
                  Salir del panel
                </button>
              </div>
            </section>
          </aside>

          <section className="space-y-6">
            <section className="panel overflow-hidden 2xl:hidden">
              <div className="border-b border-stone-200 px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-900 text-white shadow-sm">
                    <ShieldCheck size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Panel admin</p>
                    <h1 className="truncate text-lg font-semibold text-stone-900">{props.restaurantName}</h1>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto px-3 py-3 scrollbar-thin">
                {navItems.map((item) => (
                  <MobileNavButton key={item.id} active={activeSection === item.id} icon={item.icon} label={item.label} onClick={() => setActiveSection(item.id)} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-stone-200 bg-stone-50 px-4 py-4">
                <StatCard label="Pedidos activos" value={stats.activeOrders} tone="amber" compact />
                <StatCard label="Platos visibles" value={stats.visibleItems} compact />
                <StatCard label="Mesas activas" value={stats.activeTables} compact />
                <StatCard label="Ocultos" value={stats.hiddenItems} tone="muted" compact />
              </div>
              <div className="border-t border-stone-200 px-4 py-4">
                <button type="button" onClick={props.onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
                  <LogOut size={16} />
                  Salir del panel
                </button>
              </div>
            </section>
            <section className="panel overflow-hidden">
              <div className="border-b border-stone-200 px-4 py-4 sm:px-6 sm:py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-sm text-stone-500">Gestion</p>
                    <h2 className="mt-1 text-xl font-semibold text-stone-900 sm:text-2xl">
                      {activeSection === 'menu' ? 'Carta y platos' : activeSection === 'tables' ? 'Mesas y codigos QR' : activeSection === 'orders' ? 'Pedidos recientes' : 'Opciones del cliente'}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm text-stone-500">
                      {activeSection === 'menu' ? 'Organiza los platos, edita su informacion y controla la visibilidad de la carta.' : activeSection === 'tables' ? 'Gestiona mesas activas, imprime lotes de QR y revisa cada codigo antes de usarlo.' : activeSection === 'orders' ? 'Consulta el estado del servicio y revisa rapidamente los ultimos pedidos.' : 'Controla el pop-up de Wi-Fi y los datos que vera el cliente al entrar a la mesa.'}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                    {activeSection === 'menu' ? <ToolbarButton icon={<RefreshCcw size={16} />} label="Actualizar carta" onClick={props.onRefreshMenu} /> : null}
                    {activeSection === 'tables' ? <ToolbarButton icon={<RefreshCcw size={16} />} label="Actualizar mesas" onClick={props.onRefreshTables} /> : null}
                    {activeSection === 'orders' ? <ToolbarButton icon={<RefreshCcw size={16} />} label="Actualizar pedidos" onClick={props.onRefreshOrders} /> : null}
                    {activeSection === 'settings' ? <ToolbarButton icon={<RefreshCcw size={16} />} label="Actualizar opciones" onClick={props.onRefreshSettings} /> : null}
                    {activeSection === 'tables' ? <button type="button" onClick={() => props.onPrintSelectedQrs(selectedTableIds)} disabled={selectedTableIds.length === 0} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-400">Imprimir seleccion</button> : null}
                    {activeSection === 'menu' ? <button type="button" onClick={() => { setSelectedItemId(null); setMenuForm(emptyMenu); }} className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black">Nuevo plato</button> : null}
                    {activeSection === 'tables' ? <button type="button" onClick={() => { setSelectedTableId(null); setTableForm(emptyTable); }} className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black">Nueva mesa</button> : null}
                  </div>
                </div>
              </div>
              <Messages values={[props.menuError, props.ordersError, props.tablesError, props.actionError, props.actionSuccess]} />
            </section>
            {activeSection === 'menu' ? (
              <section className="panel overflow-hidden">
                <div className="flex flex-col gap-4 border-b border-stone-200 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-stone-900">Listado de platos</h3>
                    <p className="mt-1 text-sm text-stone-500">Busca rapido, revisa el estado y entra a editar solo cuando haga falta.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} placeholder="Buscar plato, categoria o ingrediente" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600 sm:w-72" />
                    {props.menuLoading ? <InlineLoader /> : null}
                  </div>
                </div>
                <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-5">
                  {groupedMenu.length === 0 && !props.menuLoading ? <EmptyState text="Todavia no hay platos guardados." /> : null}
                  {groupedMenu.length > 0 && filteredGroupedMenu.length === 0 && !props.menuLoading ? <EmptyState text="No hay platos que coincidan con la busqueda." /> : null}
                  {filteredGroupedMenu.map(([category, items]) => (
                    <div key={category} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                      <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-4 sm:px-5">
                        <div>
                          <h3 className="text-sm font-semibold text-stone-900">{category}</h3>
                          <p className="mt-1 text-xs text-stone-500">{items.length} platos en esta categoria</p>
                        </div>
                        <span className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">{items.length}</span>
                      </div>
                      <div className="divide-y divide-stone-200">
                        {[...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((item, index) => (
                          <article key={item.id} className="px-4 py-4 sm:px-5">
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                              <div className="flex min-w-0 flex-1 gap-4">
                                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
                                  {item.imageUrl ? (
                                    <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="px-3 text-center text-xs text-stone-400">Sin imagen</span>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-stone-900">{item.name}</p>
                                    <Badge active={item.available} activeLabel="Visible" inactiveLabel="Oculto" />
                                    <span className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs font-medium text-stone-700">{item.price.toFixed(2)} EUR</span>
                                  </div>
                                  <p className="mt-1 text-sm leading-6 text-stone-500">{item.description || 'Sin descripcion.'}</p>

                                  <div className="mt-3 grid gap-2 text-xs text-stone-500 sm:grid-cols-2">
                                    <InfoRow label="Ingredientes" value={item.ingredients.length ? item.ingredients.join(', ') : 'Sin definir'} />
                                    <InfoRow label="Alergenos" value={item.allergens.length ? item.allergens.join(', ') : 'Sin definir'} />
                                    <InfoRow label="Etiquetas" value={item.dietary.length ? item.dietary.join(', ') : 'Sin definir'} />
                                    <InfoRow label="Alias voz" value={item.voiceAliases?.length ? item.voiceAliases.join(', ') : 'Sin definir'} />
                                    <InfoRow label="Orden" value={`${(item.sortOrder ?? index) + 1}`} />
                                  </div>
                                </div>
                              </div>

                              <div className="grid gap-2 sm:grid-cols-3 xl:w-[252px] xl:grid-cols-2">
                                <SquareButton icon={<ArrowUp size={16} />} disabled={index === 0 || props.isSaving} onClick={() => void props.onMoveItem(item.id, 'up')} />
                                <SquareButton icon={<ArrowDown size={16} />} disabled={index === items.length - 1 || props.isSaving} onClick={() => void props.onMoveItem(item.id, 'down')} />
                                <ActionButton icon={<Pencil size={15} />} label="Editar" onClick={() => setSelectedItemId(item.id)} />
                                <ActionButton icon={<Copy size={15} />} label="Duplicar" onClick={() => void props.onDuplicate(item)} />
                                <ActionButton label={item.available ? 'Ocultar' : 'Mostrar'} onClick={() => void props.onToggleAvailability(item.id, !item.available)} />
                                <IconDangerButton icon={<Trash2 size={15} />} onClick={() => void props.onDelete(item.id)} />
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {activeSection === 'tables' ? (
              <section className="panel overflow-hidden">
                <div className="flex flex-col gap-4 border-b border-stone-200 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-stone-900">Listado de mesas</h3>
                    <p className="mt-1 text-sm text-stone-500">Busca, imprime y gestiona cada QR desde una sola vista.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Buscar mesa" className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600 sm:w-48" />
                    {props.tablesLoading ? <InlineLoader /> : null}
                  </div>
                </div>
                <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
                  {filteredTables.length > 0 ? <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={filteredTables.every((table) => selectedTableIds.includes(table.id)) && filteredTables.length > 0} onChange={(event) => setSelectedTableIds(event.target.checked ? Array.from(new Set([...selectedTableIds, ...filteredTables.map((table) => table.id)])) : selectedTableIds.filter((id) => !filteredTables.some((table) => table.id === id)))} className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600" />Seleccionar mesas visibles</label> : null}
                  {filteredTables.length === 0 && !props.tablesLoading ? <EmptyState text="Todavia no hay mesas creadas." /> : null}
                  {filteredTables.map((table) => (
                    <article key={table.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm shadow-stone-100/50">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex items-start gap-3">
                          <input type="checkbox" checked={selectedTableIds.includes(table.id)} onChange={(event) => setSelectedTableIds((current) => event.target.checked ? [...current, table.id] : current.filter((id) => id !== table.id))} className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600" />
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-stone-900">Mesa {table.number}</p>
                              <Badge active={table.active} />
                            </div>
                            <p className="mt-1 text-sm text-stone-500">{table.label || 'Sin alias interno.'}</p>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                          <ActionButton icon={<Pencil size={15} />} label="Editar" onClick={() => setSelectedTableId(table.id)} />
                          <ActionButton icon={<Eye size={15} />} label="Ver QR" onClick={() => void props.onPreviewQr(table.id)} />
                          <ActionButton icon={<Printer size={15} />} label="Imprimir QR" onClick={() => props.onPrintQr(table.id)} />
                          <ActionButton label={table.active ? 'Desactivar' : 'Activar'} onClick={() => void props.onToggleTableStatus(table.id, !table.active)} />
                          <IconDangerButton icon={<Trash2 size={15} />} onClick={() => void props.onDeleteTable(table.id)} />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeSection === 'orders' ? (
              <section className="panel overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-stone-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
                  <div>
                    <h3 className="text-base font-semibold text-stone-900">Actividad reciente</h3>
                    <p className="mt-1 text-sm text-stone-500">Una vista limpia para controlar el ritmo de sala y cocina.</p>
                  </div>
                  {props.ordersLoading ? <InlineLoader /> : null}
                </div>
                <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
                  {recentOrders.length === 0 && !props.ordersLoading ? <EmptyState text="No hay pedidos todavia." /> : null}
                  {recentOrders.map((order) => (
                    <article key={order.id} className="rounded-xl border border-stone-200 bg-white px-4 py-4 shadow-sm shadow-stone-100/50">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-stone-900">Mesa {order.tableNumber}</p>
                            <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">{orderLabel[order.status]}</span>
                            <span className={`rounded-md px-2 py-1 text-xs ${order.reviewConsent ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                              {order.reviewConsent ? 'Valoracion activada' : 'Sin valoracion'}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-stone-500">{order.clientName} · {order.diners} comensales · {order.totalPrice.toFixed(2)} EUR</p>
                          {order.reviewConsent && order.customerEmail ? (
                            <p className="mt-2 text-xs font-medium text-stone-700">Email valoracion: {order.customerEmail}</p>
                          ) : null}
                        </div>
                        <p className="text-xs text-stone-500">{new Date(order.createdAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeSection === 'settings' ? (
              <section className="panel overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-stone-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
                  <div>
                    <h3 className="text-base font-semibold text-stone-900">Wi-Fi para clientes</h3>
                    <p className="mt-1 text-sm text-stone-500">Configura si quieres mostrar el acceso al Wi-Fi antes del nombre y comensales.</p>
                  </div>
                  {props.settingsLoading ? <InlineLoader /> : null}
                </div>
                <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
                  <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-4">
                    <p className="text-sm font-medium text-stone-900">Vista previa del cliente</p>
                    <p className="mt-1 text-sm text-stone-500">{settingsForm.showWifiPopup ? 'Se mostrara un pop-up de Wi-Fi al abrir la mesa.' : 'La mesa ira directa al formulario de nombre y comensales.'}</p>
                    <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-white px-4 py-4 text-sm">
                      <p><span className="font-medium text-stone-900">Red:</span> <span className="text-stone-600">{settingsForm.wifiSsid || 'Sin configurar'}</span></p>
                      <p><span className="font-medium text-stone-900">Contrasena:</span> <span className="text-stone-600">{settingsForm.wifiPassword || 'Sin configurar'}</span></p>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </section>
          <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            {activeSection === 'menu' ? (
              <PanelForm title={selectedItemId ? 'Editar plato' : 'Nuevo plato'} description={selectedItemId ? 'Actualiza los datos y guarda sin salir del panel.' : 'Crea un plato nuevo y asignalo a una categoria.'}>
                <form onSubmit={(e) => { e.preventDefault(); void props.onSave(selectedItemId, toMenuPayload(menuForm)); if (!selectedItemId) setMenuForm(emptyMenu); }} className="space-y-4 px-6 py-5">
                  <Input label="Nombre" value={menuForm.name} onChange={(value) => setMenuForm((c) => ({ ...c, name: value }))} placeholder="Ej. Tarta de queso" />
                  <TextArea label="Descripcion" value={menuForm.description} onChange={(value) => setMenuForm((c) => ({ ...c, description: value }))} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Precio" value={menuForm.price} onChange={(value) => setMenuForm((c) => ({ ...c, price: value }))} placeholder="12.50" />
                    <Input label="Categoria" value={menuForm.category} onChange={(value) => setMenuForm((c) => ({ ...c, category: value }))} placeholder="Entrantes" list="menu-categories" />
                    <datalist id="menu-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
                  </div>
                  <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-stone-800">Subir imagen desde archivo</p>
                        <p className="text-xs text-stone-500">JPG, PNG, WEBP o GIF. Maximo 5 MB.</p>
                      </div>
                      {props.isUploadingImage ? <InlineLoader text="Subiendo" /> : null}
                    </div>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void props.onUploadImage(file).then((imageUrl) => setMenuForm((c) => ({ ...c, imageUrl }))); event.currentTarget.value = ''; }} className="block w-full text-sm text-stone-600 file:mr-4 file:rounded-lg file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white" />
                    {menuForm.imageUrl ? <div className="overflow-hidden rounded-lg border border-stone-200 bg-white"><img src={menuForm.imageUrl} alt="Vista previa del plato" className="h-44 w-full object-cover" /></div> : null}
                  </div>
                  <Input label="Ingredientes" value={menuForm.ingredients} onChange={(value) => setMenuForm((c) => ({ ...c, ingredients: value }))} placeholder="tomate, mozzarella" />
                  <Input label="Alergenos" value={menuForm.allergens} onChange={(value) => setMenuForm((c) => ({ ...c, allergens: value }))} placeholder="gluten, lacteos" />
                  <Input label="Etiquetas dietarias" value={menuForm.dietary} onChange={(value) => setMenuForm((c) => ({ ...c, dietary: value }))} placeholder="vegano, sin gluten" />
                  <Input label="Alias de voz" value={menuForm.voiceAliases} onChange={(value) => setMenuForm((c) => ({ ...c, voiceAliases: value }))} placeholder="croquetas de jamon, tarta casera" />
                  <p className="-mt-2 text-xs text-stone-500">Separa por comas las formas naturales en que suelen pedir este plato.</p>
                  <label className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-3"><div><p className="text-sm font-medium text-stone-800">Disponible en carta</p><p className="text-xs text-stone-500">Si lo desactivas, desaparece de la vista del cliente.</p></div><input type="checkbox" checked={menuForm.available} onChange={(e) => setMenuForm((c) => ({ ...c, available: e.target.checked }))} className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600" /></label>
                  <div className="flex flex-wrap gap-2 pt-2"><PrimaryButton type="submit" disabled={!menuForm.name.trim() || !menuForm.category.trim() || !menuForm.price.trim() || props.isSaving} loading={props.isSaving}>{selectedItemId ? 'Guardar cambios' : 'Crear plato'}</PrimaryButton><SecondaryButton onClick={() => { setSelectedItemId(null); setMenuForm(emptyMenu); }}>Limpiar</SecondaryButton></div>
                </form>
              </PanelForm>
            ) : null}

            {activeSection === 'tables' ? (
              <PanelForm title={selectedTableId ? 'Editar mesa' : 'Nueva mesa'} description={selectedTableId ? 'Ajusta numero o alias interno.' : 'Crea una mesa nueva y genera su QR.'}>
                <form onSubmit={(e) => { e.preventDefault(); void props.onSaveTable(selectedTableId, toTablePayload(tableForm)); if (!selectedTableId) setTableForm(emptyTable); }} className="space-y-4 px-6 py-5">
                  <Input label="Numero de mesa" value={tableForm.number} onChange={(value) => setTableForm((current) => ({ ...current, number: value }))} placeholder="1" />
                  <Input label="Alias interno" value={tableForm.label} onChange={(value) => setTableForm((current) => ({ ...current, label: value }))} placeholder="Terraza 1" />
                  <div className="flex flex-wrap gap-2 pt-2"><PrimaryButton type="submit" disabled={!tableForm.number.trim() || props.isSavingTable} loading={props.isSavingTable}>{selectedTableId ? 'Guardar mesa' : 'Crear mesa'}</PrimaryButton><SecondaryButton onClick={() => { setSelectedTableId(null); setTableForm(emptyTable); }}>Limpiar</SecondaryButton></div>
                </form>
              </PanelForm>
            ) : null}

            {activeSection === 'orders' ? (
              <section className="panel overflow-hidden">
                <div className="border-b border-stone-200 px-6 py-5">
                  <h3 className="text-base font-semibold text-stone-900">Resumen operativo</h3>
                  <p className="mt-1 text-sm text-stone-500">Una lectura rapida del estado actual del servicio.</p>
                </div>
                <div className="space-y-3 px-6 py-5">
                  <SummaryRow label="Pedidos activos" value={`${stats.activeOrders}`} />
                  <SummaryRow label="Total pedidos cargados" value={`${props.orders.length}`} />
                  <SummaryRow label="Mesas activas" value={`${stats.activeTables}`} />
                  <SummaryRow label="Platos visibles" value={`${stats.visibleItems}`} />
                  <SummaryRow label="Con email de valoracion" value={`${props.orders.filter((order) => order.reviewConsent && order.customerEmail).length}`} />
                  <div className="pt-2">
                    <PrimaryButton onClick={props.onRefreshOrders}>Actualizar pedidos</PrimaryButton>
                  </div>
                </div>
                <div className="border-t border-stone-200 px-6 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-stone-900">Diagnostico de voz</h4>
                      <p className="mt-1 text-xs text-stone-500">Ultimos turnos registrados para revisar dudas, matches y confirmaciones.</p>
                    </div>
                    <button type="button" onClick={props.onRefreshVoiceTraces} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-stone-50">Actualizar</button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {props.voiceTracesLoading ? <InlineLoader text="Cargando trazas" /> : null}
                    {props.voiceTracesError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{props.voiceTracesError}</p> : null}
                    {!props.voiceTracesLoading && props.voiceTraces.length === 0 ? <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-xs text-stone-500">Todavia no hay trazas de voz registradas.</p> : null}
                    {props.voiceTraces.slice(0, 8).map((trace) => (
                      <article key={trace.id} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Mesa {trace.tableNumber}</p>
                            <p className="mt-1 text-sm font-medium text-stone-900">{trace.transcript || 'Sin transcript'}</p>
                          </div>
                          <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${trace.resolution.requiresClarification ? 'bg-amber-100 text-amber-800' : trace.resolution.mutatedCart ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'}`}>{trace.resolution.requiresClarification ? 'Aclara' : trace.resolution.mutatedCart ? 'Aplicado' : 'Sin cambio'}</span>
                        </div>
                        {trace.assistantMessage ? <p className="mt-2 text-xs leading-5 text-stone-600">{trace.assistantMessage}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-500">
                          <span className="rounded-md bg-white px-2 py-1">Accion: {trace.resolution.action}</span>
                          <span className="rounded-md bg-white px-2 py-1">Fallback: {trace.resolution.fallbackUsed ? 'si' : 'no'}</span>
                          <span className="rounded-md bg-white px-2 py-1">Confirmacion pendiente: {trace.resolution.confirmationPending ? 'si' : 'no'}</span>
                        </div>
                        {trace.resolution.candidates.length > 0 ? <p className="mt-2 text-[11px] text-stone-500">Candidatos: {trace.resolution.candidates.map((candidate) => `${candidate.name} (${Math.round(candidate.confidence * 100)}%)`).join(' · ')}</p> : null}
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === 'settings' ? (
              <PanelForm title="Opciones de Wi-Fi" description="Define si quieres mostrar el acceso a internet y con que datos.">
                <form onSubmit={(e) => { e.preventDefault(); void props.onSaveSettings({ showWifiPopup: settingsForm.showWifiPopup, wifiSsid: settingsForm.wifiSsid.trim(), wifiPassword: settingsForm.wifiPassword.trim() }); }} className="space-y-4 px-6 py-5">
                  <label className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-3"><div><p className="text-sm font-medium text-stone-800">Mostrar pop-up de Wi-Fi</p><p className="text-xs text-stone-500">Se enseña antes del formulario inicial de cliente.</p></div><input type="checkbox" checked={settingsForm.showWifiPopup} onChange={(e) => setSettingsForm((current) => ({ ...current, showWifiPopup: e.target.checked }))} className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600" /></label>
                  <Input label="Nombre de la red" value={settingsForm.wifiSsid} onChange={(value) => setSettingsForm((current) => ({ ...current, wifiSsid: value }))} placeholder="Ej. Restaurante Guest" />
                  <Input label="Contrasena Wi-Fi" value={settingsForm.wifiPassword} onChange={(value) => setSettingsForm((current) => ({ ...current, wifiPassword: value }))} placeholder="Ej. camarero2026" />
                  <div className="flex flex-wrap gap-2 pt-2"><PrimaryButton type="submit" loading={props.isSavingSettings}>Guardar opciones</PrimaryButton><SecondaryButton onClick={() => setSettingsForm({ showWifiPopup: props.settings.showWifiPopup, wifiSsid: props.settings.wifiSsid, wifiPassword: props.settings.wifiPassword })}>Restablecer</SecondaryButton></div>
                </form>
              </PanelForm>
            ) : null}
          </aside>
        </div>
      </div>

      {(props.qrPreview || props.qrPreviewLoading || props.qrPreviewError) ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6" onClick={props.onCloseQrPreview}><section className="panel w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between border-b border-stone-200 px-6 py-5"><div><h2 className="text-base font-semibold text-stone-900">Vista previa QR</h2><p className="mt-1 text-sm text-stone-500">Comprueba el codigo antes de imprimirlo.</p></div><button type="button" onClick={props.onCloseQrPreview} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50"><X size={16} /></button></div><div className="space-y-4 px-6 py-6">{props.qrPreviewLoading ? <InlineLoader text="Generando QR..." /> : null}{props.qrPreviewError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{props.qrPreviewError}</p> : null}{props.qrPreview ? <><div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-5 text-center"><p className="text-sm font-medium text-stone-500">{props.restaurantName}</p><p className="mt-1 text-2xl font-semibold text-stone-900">Mesa {props.qrPreview.table.number}</p><p className="mt-1 text-sm text-stone-500">{props.qrPreview.table.label || 'Sin alias interno'}</p><div className="mx-auto mt-5 flex w-fit items-center justify-center rounded-lg bg-white p-3" dangerouslySetInnerHTML={{ __html: props.qrPreview.qrSvg }} /><p className="mt-4 break-all text-xs text-stone-500">{props.qrPreview.qrUrl}</p></div><div className="flex flex-wrap gap-2"><PrimaryButton onClick={() => props.onPrintQr(props.qrPreview!.table.id)}><span className="inline-flex items-center gap-2"><Printer size={16} />Imprimir QR</span></PrimaryButton><SecondaryButton onClick={props.onCloseQrPreview}>Cerrar</SecondaryButton></div></> : null}</div></section></div> : null}
    </>
  );
}

function ToolbarButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 sm:w-auto">{icon}{label}</button>; }
function Messages({ values }: { values: Array<string | null | undefined> }) { const list = values.filter(Boolean) as string[]; if (!list.length) return null; return <div className="space-y-2 px-6 py-4 text-sm">{list.map((value, index) => <p key={`${value}-${index}`} className={`rounded-lg px-3 py-2 ${index === list.length - 1 && values[values.length - 1] ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{value}</p>)}</div>; }
function EmptyState({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm text-stone-500">{text}</div>; }
function Badge({ active, activeLabel = 'Activa', inactiveLabel = 'Desactivada' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) { return <span className={`rounded-md px-2 py-1 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'}`}>{active ? activeLabel : inactiveLabel}</span>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"><p className="text-[11px] font-medium text-stone-500">{label}</p><p className="mt-1 line-clamp-2 text-xs text-stone-700">{value}</p></div>; }
function InlineLoader({ text = 'Actualizando' }: { text?: string }) { return <div className="inline-flex items-center gap-2 text-sm text-stone-500"><Loader2 size={16} className="animate-spin" />{text}</div>; }
function ActionButton({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50 sm:w-auto">{icon}{label}</button>; }
function IconDangerButton({ icon, onClick }: { icon: React.ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-red-200 text-red-700 transition hover:bg-red-50 sm:h-9 sm:w-9">{icon}</button>; }
function SquareButton({ icon, disabled, onClick }: { icon: React.ReactNode; disabled?: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick} className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-400 sm:h-9 sm:w-9">{icon}</button>; }
function PanelForm({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="panel overflow-hidden"><div className="border-b border-stone-200 px-4 py-4 sm:px-6 sm:py-5"><h2 className="text-base font-semibold text-stone-900">{title}</h2><p className="mt-1 text-sm text-stone-500">{description}</p></div>{children}</section>; }
function MobileNavButton({ active, icon, label, onClick }: { key?: React.Key; active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition ${active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700'}`}>{icon}{label}</button>; }
function SidebarNavButton({ active, icon, label, helper, onClick }: { key?: React.Key; active: boolean; icon: React.ReactNode; label: string; helper: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${active ? 'bg-stone-900 text-white shadow-lg shadow-stone-300/30' : 'text-stone-700 hover:bg-stone-50'}`}><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${active ? 'bg-white/12 text-white' : 'bg-stone-100 text-stone-600'}`}>{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className={`block text-xs ${active ? 'text-stone-300' : 'text-stone-500'}`}>{helper}</span></span></button>; }
function StatCard({ label, value, tone = 'default', compact = false }: { label: string; value: number; tone?: 'default' | 'amber' | 'muted'; compact?: boolean }) { return <div className={`rounded-2xl border px-4 ${compact ? 'py-3' : 'py-3'} ${tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-white'}`}><p className={`font-medium uppercase tracking-[0.14em] text-stone-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>{label}</p><p className={`font-semibold text-stone-900 ${compact ? 'mt-1 text-xl' : 'mt-2 text-2xl'}`}>{value}</p></div>; }
function SummaryRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-4 py-3"><span className="text-sm text-stone-600">{label}</span><span className="text-sm font-semibold text-stone-900">{value}</span></div>; }
function Input({ label, value, onChange, placeholder, list }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; list?: string }) { return <label className="block space-y-2"><span className="text-sm font-medium text-stone-700">{label}</span><input list={list} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600" placeholder={placeholder} /></label>; }
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block space-y-2"><span className="text-sm font-medium text-stone-700">{label}</span><textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600" /></label>; }
function PrimaryButton({ children, disabled, loading, onClick, type = 'button' }: { children: React.ReactNode; disabled?: boolean; loading?: boolean; onClick?: () => void; type?: 'button' | 'submit' }) { return <button type={type} onClick={onClick} disabled={disabled || loading} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:bg-stone-300 sm:flex-1">{loading ? <Loader2 size={16} className="animate-spin" /> : null}{children}</button>; }
function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex w-full items-center justify-center rounded-lg border border-stone-300 px-4 py-3 text-sm text-stone-700 transition hover:bg-stone-50 sm:w-auto">{children}</button>; }

