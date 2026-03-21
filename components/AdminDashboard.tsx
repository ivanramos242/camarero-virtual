import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Copy, Eye, Loader2, LogOut, Pencil, Plus, Printer, QrCode, RefreshCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import type { AdminTable, CreateAdminTableRequest, CreateMenuItemRequest, MenuItem, PersistedOrder, TableQrResponse, UpdateAdminTableRequest, UpdateMenuItemRequest } from '../types';

type MenuForm = { name: string; description: string; price: string; category: string; imageUrl: string; ingredients: string; allergens: string; dietary: string; available: boolean };
type TableForm = { number: string; label: string };

interface Props {
  restaurantName: string;
  menu: MenuItem[];
  orders: PersistedOrder[];
  tables: AdminTable[];
  menuLoading: boolean;
  ordersLoading: boolean;
  tablesLoading: boolean;
  menuError?: string | null;
  ordersError?: string | null;
  tablesError?: string | null;
  actionError?: string | null;
  actionSuccess?: string | null;
  isSaving: boolean;
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
  onRefreshMenu: () => void;
  onRefreshOrders: () => void;
  onRefreshTables: () => void;
  onSaveTable: (tableId: string | null, payload: CreateAdminTableRequest | UpdateAdminTableRequest) => Promise<void>;
  onDeleteTable: (tableId: string) => Promise<void>;
  onToggleTableStatus: (tableId: string, active: boolean) => Promise<void>;
  onPreviewQr: (tableId: string) => Promise<void>;
  onPrintQr: (tableId: string) => void;
  onPrintSelectedQrs: (tableIds: string[]) => void;
  onCloseQrPreview: () => void;
  onLogout: () => void;
}

const emptyMenu: MenuForm = { name: '', description: '', price: '', category: '', imageUrl: '', ingredients: '', allergens: '', dietary: '', available: true };
const emptyTable: TableForm = { number: '', label: '' };
const orderLabel: Record<PersistedOrder['status'], string> = { pending: 'Pendiente', cooking: 'En cocina', ready: 'Listo', served: 'Servido' };
const toList = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);
const toMenuPayload = (form: MenuForm): CreateMenuItemRequest => ({ name: form.name.trim(), description: form.description.trim(), price: Number(form.price), category: form.category.trim(), imageUrl: form.imageUrl.trim() || null, ingredients: toList(form.ingredients), allergens: toList(form.allergens), dietary: toList(form.dietary), available: form.available });
const toTablePayload = (form: TableForm): CreateAdminTableRequest => ({ number: form.number.trim(), label: form.label.trim() || undefined });

export default function AdminDashboard(props: Props) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [menuForm, setMenuForm] = useState<MenuForm>(emptyMenu);
  const [tableForm, setTableForm] = useState<TableForm>(emptyTable);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);

  useEffect(() => {
    const item = props.menu.find((entry) => entry.id === selectedItemId);
    setMenuForm(item ? { name: item.name, description: item.description, price: item.price.toFixed(2), category: item.category, imageUrl: item.imageUrl ?? '', ingredients: item.ingredients.join(', '), allergens: item.allergens.join(', '), dietary: item.dietary.join(', '), available: item.available } : emptyMenu);
  }, [props.menu, selectedItemId]);

  useEffect(() => {
    const table = props.tables.find((entry) => entry.id === selectedTableId);
    setTableForm(table ? { number: table.number, label: table.label ?? '' } : emptyTable);
  }, [props.tables, selectedTableId]);

  const categories = useMemo(() => Array.from(new Set<string>(props.menu.map((item) => item.category))).sort((a, b) => a.localeCompare(b, 'es')), [props.menu]);
  const groupedMenu = useMemo(() => Array.from(props.menu.reduce((map, item) => map.set(item.category, [...(map.get(item.category) ?? []), item]), new Map<string, MenuItem[]>()).entries()).sort(([a], [b]) => a.localeCompare(b, 'es')), [props.menu]);
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

  return (
    <>
      <div className="page-container py-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="space-y-6">
            <section className="panel overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-stone-200 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900 text-white"><ShieldCheck size={18} /></span><div><h1 className="text-lg font-semibold text-stone-900">Administracion</h1><p className="text-sm text-stone-500">{props.restaurantName}</p></div></div>
                <div className="flex flex-wrap items-center gap-2">
                  <ToolbarButton icon={<RefreshCcw size={16} />} label="Carta" onClick={props.onRefreshMenu} />
                  <ToolbarButton icon={<QrCode size={16} />} label="Mesas" onClick={props.onRefreshTables} />
                  <ToolbarButton icon={<ClipboardList size={16} />} label="Pedidos" onClick={props.onRefreshOrders} />
                  <ToolbarButton icon={<LogOut size={16} />} label="Salir" onClick={props.onLogout} />
                </div>
              </div>
              <div className="grid gap-4 border-b border-stone-200 bg-stone-50 px-6 py-4 md:grid-cols-4">
                <Stat label="Pedidos activos" value={stats.activeOrders} />
                <Stat label="Platos visibles" value={stats.visibleItems} />
                <Stat label="Ocultos o agotados" value={stats.hiddenItems} />
                <Stat label="Mesas activas" value={stats.activeTables} />
              </div>
              <Messages values={[props.menuError, props.ordersError, props.tablesError, props.actionError, props.actionSuccess]} />
            </section>

            <section className="panel overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-stone-200 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                <div><h2 className="text-base font-semibold text-stone-900">Mesas y QRs</h2><p className="mt-1 text-sm text-stone-500">Genera, revisa e imprime el QR de cada mesa.</p></div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => props.onPrintSelectedQrs(selectedTableIds)} disabled={selectedTableIds.length === 0} className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-400">
                    Imprimir seleccion
                  </button>
                  <input value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Buscar mesa" className="w-44 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-amber-600" />
                  {props.tablesLoading ? <InlineLoader /> : null}
                </div>
              </div>
              <div className="space-y-3 px-6 py-5">
                {filteredTables.length > 0 ? <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={filteredTables.every((table) => selectedTableIds.includes(table.id)) && filteredTables.length > 0} onChange={(event) => setSelectedTableIds(event.target.checked ? Array.from(new Set([...selectedTableIds, ...filteredTables.map((table) => table.id)])) : selectedTableIds.filter((id) => !filteredTables.some((table) => table.id === id)))} className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600" />Seleccionar mesas visibles</label> : null}
                {filteredTables.length === 0 && !props.tablesLoading ? <EmptyState text="Todavia no hay mesas creadas." /> : null}
                {filteredTables.map((table) => (
                  <article key={table.id} className="rounded-xl border border-stone-200 bg-white p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-3"><input type="checkbox" checked={selectedTableIds.includes(table.id)} onChange={(event) => setSelectedTableIds((current) => event.target.checked ? [...current, table.id] : current.filter((id) => id !== table.id))} className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600" /><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-stone-900">Mesa {table.number}</p><Badge active={table.active} /></div><p className="mt-1 text-sm text-stone-500">{table.label || 'Sin alias interno.'}</p></div></div>
                      <div className="flex flex-wrap items-center gap-2">
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

            <section className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5"><div><h2 className="text-base font-semibold text-stone-900">Carta</h2><p className="mt-1 text-sm text-stone-500">Edita platos y disponibilidad en tiempo real.</p></div>{props.menuLoading ? <InlineLoader /> : null}</div>
              <div className="space-y-5 px-6 py-5">
                {groupedMenu.length === 0 && !props.menuLoading ? <EmptyState text="Todavia no hay platos guardados." /> : null}
                {groupedMenu.map(([category, items]) => (
                  <div key={category} className="space-y-3">
                    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-stone-900">{category}</h3><span className="text-xs text-stone-500">{items.length} platos</span></div>
                    <div className="space-y-3">
                      {[...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((item, index) => (
                        <article key={item.id} className="rounded-xl border border-stone-200 bg-white p-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-stone-900">{item.name}</p><Badge active={item.available} activeLabel="Visible" inactiveLabel="Oculto" /></div>
                              <p className="mt-1 text-sm text-stone-500">{item.description || 'Sin descripcion.'}</p>
                              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-500"><span>{item.price.toFixed(2)} EUR</span><span>Ingredientes: {item.ingredients.length ? item.ingredients.join(', ') : 'Sin definir'}</span><span>Alergenos: {item.allergens.length ? item.allergens.join(', ') : 'Sin definir'}</span></div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
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

            <section className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5"><div><h2 className="text-base font-semibold text-stone-900">Pedidos recientes</h2><p className="mt-1 text-sm text-stone-500">Vista operativa para revisar servicio.</p></div>{props.ordersLoading ? <InlineLoader /> : null}</div>
              <div className="space-y-3 px-6 py-5">
                {props.orders.slice(0, 8).length === 0 && !props.ordersLoading ? <EmptyState text="No hay pedidos todavia." /> : null}
                {props.orders.slice(0, 8).map((order) => (
                  <article key={order.id} className="rounded-xl border border-stone-200 bg-white px-4 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-stone-900">Mesa {order.tableNumber}</p><span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">{orderLabel[order.status]}</span></div><p className="mt-1 text-sm text-stone-500">{order.clientName} · {order.diners} comensales · {order.totalPrice.toFixed(2)} EUR</p></div>
                      <p className="text-xs text-stone-500">{new Date(order.createdAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>

          <aside className="space-y-6">
            <PanelForm title={selectedTableId ? 'Editar mesa' : 'Nueva mesa'} description={selectedTableId ? 'Ajusta numero o alias interno.' : 'Crea una mesa nueva y genera su QR.'}>
              <form onSubmit={(e) => { e.preventDefault(); void props.onSaveTable(selectedTableId, toTablePayload(tableForm)); if (!selectedTableId) setTableForm(emptyTable); }} className="space-y-4 px-6 py-5">
                <Input label="Numero de mesa" value={tableForm.number} onChange={(value) => setTableForm((current) => ({ ...current, number: value }))} placeholder="1" />
                <Input label="Alias interno" value={tableForm.label} onChange={(value) => setTableForm((current) => ({ ...current, label: value }))} placeholder="Terraza 1" />
                <div className="flex flex-wrap gap-2 pt-2"><PrimaryButton type="submit" disabled={!tableForm.number.trim() || props.isSavingTable} loading={props.isSavingTable}>{selectedTableId ? 'Guardar mesa' : 'Crear mesa'}</PrimaryButton><SecondaryButton onClick={() => { setSelectedTableId(null); setTableForm(emptyTable); }}>Limpiar</SecondaryButton></div>
              </form>
            </PanelForm>

            <PanelForm title={selectedItemId ? 'Editar plato' : 'Nuevo plato'} description={selectedItemId ? 'Actualiza los datos y guarda sin salir del panel.' : 'Crea un plato nuevo y asignalo a una categoria.'}>
              <form onSubmit={(e) => { e.preventDefault(); void props.onSave(selectedItemId, toMenuPayload(menuForm)); if (!selectedItemId) setMenuForm(emptyMenu); }} className="space-y-4 px-6 py-5">
                <Input label="Nombre" value={menuForm.name} onChange={(value) => setMenuForm((c) => ({ ...c, name: value }))} placeholder="Ej. Tarta de queso" />
                <TextArea label="Descripcion" value={menuForm.description} onChange={(value) => setMenuForm((c) => ({ ...c, description: value }))} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Precio" value={menuForm.price} onChange={(value) => setMenuForm((c) => ({ ...c, price: value }))} placeholder="12.50" />
                  <Input label="Categoria" value={menuForm.category} onChange={(value) => setMenuForm((c) => ({ ...c, category: value }))} placeholder="Entrantes" list="menu-categories" />
                  <datalist id="menu-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
                </div>
                <Input label="Imagen URL" value={menuForm.imageUrl} onChange={(value) => setMenuForm((c) => ({ ...c, imageUrl: value }))} placeholder="https://..." />
                <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-stone-800">Subir imagen desde archivo</p><p className="text-xs text-stone-500">JPG, PNG, WEBP o GIF. Maximo 5 MB.</p></div>{props.isUploadingImage ? <InlineLoader text="Subiendo" /> : null}</div>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void props.onUploadImage(file).then((imageUrl) => setMenuForm((c) => ({ ...c, imageUrl }))); event.currentTarget.value = ''; }} className="block w-full text-sm text-stone-600 file:mr-4 file:rounded-lg file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white" />
                  {menuForm.imageUrl ? <div className="overflow-hidden rounded-lg border border-stone-200 bg-white"><img src={menuForm.imageUrl} alt="Vista previa del plato" className="h-44 w-full object-cover" /></div> : null}
                </div>
                <Input label="Ingredientes" value={menuForm.ingredients} onChange={(value) => setMenuForm((c) => ({ ...c, ingredients: value }))} placeholder="tomate, mozzarella" />
                <Input label="Alergenos" value={menuForm.allergens} onChange={(value) => setMenuForm((c) => ({ ...c, allergens: value }))} placeholder="gluten, lacteos" />
                <Input label="Etiquetas dietarias" value={menuForm.dietary} onChange={(value) => setMenuForm((c) => ({ ...c, dietary: value }))} placeholder="vegano, sin gluten" />
                <label className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-3"><div><p className="text-sm font-medium text-stone-800">Disponible en carta</p><p className="text-xs text-stone-500">Si lo desactivas, desaparece de la vista del cliente.</p></div><input type="checkbox" checked={menuForm.available} onChange={(e) => setMenuForm((c) => ({ ...c, available: e.target.checked }))} className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600" /></label>
                <div className="flex flex-wrap gap-2 pt-2"><PrimaryButton type="submit" disabled={!menuForm.name.trim() || !menuForm.category.trim() || !menuForm.price.trim() || props.isSaving} loading={props.isSaving}>{selectedItemId ? 'Guardar cambios' : 'Crear plato'}</PrimaryButton><SecondaryButton onClick={() => { setSelectedItemId(null); setMenuForm(emptyMenu); }}>Limpiar</SecondaryButton></div>
              </form>
            </PanelForm>
          </aside>
        </div>
      </div>

      {(props.qrPreview || props.qrPreviewLoading || props.qrPreviewError) ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6" onClick={props.onCloseQrPreview}><section className="panel w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between border-b border-stone-200 px-6 py-5"><div><h2 className="text-base font-semibold text-stone-900">Vista previa QR</h2><p className="mt-1 text-sm text-stone-500">Comprueba el codigo antes de imprimirlo.</p></div><button type="button" onClick={props.onCloseQrPreview} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50"><X size={16} /></button></div><div className="space-y-4 px-6 py-6">{props.qrPreviewLoading ? <InlineLoader text="Generando QR..." /> : null}{props.qrPreviewError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{props.qrPreviewError}</p> : null}{props.qrPreview ? <><div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-5 text-center"><p className="text-sm font-medium text-stone-500">{props.restaurantName}</p><p className="mt-1 text-2xl font-semibold text-stone-900">Mesa {props.qrPreview.table.number}</p><p className="mt-1 text-sm text-stone-500">{props.qrPreview.table.label || 'Sin alias interno'}</p><div className="mx-auto mt-5 flex w-fit items-center justify-center rounded-lg bg-white p-3" dangerouslySetInnerHTML={{ __html: props.qrPreview.qrSvg }} /><p className="mt-4 break-all text-xs text-stone-500">{props.qrPreview.qrUrl}</p></div><div className="flex flex-wrap gap-2"><PrimaryButton onClick={() => props.onPrintQr(props.qrPreview!.table.id)}><span className="inline-flex items-center gap-2"><Printer size={16} />Imprimir QR</span></PrimaryButton><SecondaryButton onClick={props.onCloseQrPreview}>Cerrar</SecondaryButton></div></> : null}</div></section></div> : null}
    </>
  );
}

function ToolbarButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50">{icon}{label}</button>; }
function Stat({ label, value }: { label: string; value: number }) { return <div><p className="text-sm text-stone-500">{label}</p><p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p></div>; }
function Messages({ values }: { values: Array<string | null | undefined> }) { const list = values.filter(Boolean) as string[]; if (!list.length) return null; return <div className="space-y-2 px-6 py-4 text-sm">{list.map((value, index) => <p key={`${value}-${index}`} className={`rounded-lg px-3 py-2 ${index === list.length - 1 && values[values.length - 1] ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{value}</p>)}</div>; }
function EmptyState({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm text-stone-500">{text}</div>; }
function Badge({ active, activeLabel = 'Activa', inactiveLabel = 'Desactivada' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) { return <span className={`rounded-md px-2 py-1 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'}`}>{active ? activeLabel : inactiveLabel}</span>; }
function InlineLoader({ text = 'Actualizando' }: { text?: string }) { return <div className="inline-flex items-center gap-2 text-sm text-stone-500"><Loader2 size={16} className="animate-spin" />{text}</div>; }
function ActionButton({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-50">{icon}{label}</button>; }
function IconDangerButton({ icon, onClick }: { icon: React.ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-700 transition hover:bg-red-50">{icon}</button>; }
function SquareButton({ icon, disabled, onClick }: { icon: React.ReactNode; disabled?: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-700 transition hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-400">{icon}</button>; }
function PanelForm({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="panel overflow-hidden"><div className="border-b border-stone-200 px-6 py-5"><h2 className="text-base font-semibold text-stone-900">{title}</h2><p className="mt-1 text-sm text-stone-500">{description}</p></div>{children}</section>; }
function Input({ label, value, onChange, placeholder, list }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; list?: string }) { return <label className="block space-y-2"><span className="text-sm font-medium text-stone-700">{label}</span><input list={list} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600" placeholder={placeholder} /></label>; }
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block space-y-2"><span className="text-sm font-medium text-stone-700">{label}</span><textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600" /></label>; }
function PrimaryButton({ children, disabled, loading, onClick, type = 'button' }: { children: React.ReactNode; disabled?: boolean; loading?: boolean; onClick?: () => void; type?: 'button' | 'submit' }) { return <button type={type} onClick={onClick} disabled={disabled || loading} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:bg-stone-300">{loading ? <Loader2 size={16} className="animate-spin" /> : null}{children}</button>; }
function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex items-center justify-center rounded-lg border border-stone-300 px-4 py-3 text-sm text-stone-700 transition hover:bg-stone-50">{children}</button>; }
