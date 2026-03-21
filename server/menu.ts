import { ZodError } from 'zod';

import type {
  CreateMenuItemRequest,
  MenuItem,
  ReorderMenuRequest,
  UpdateMenuItemRequest,
} from '../types.js';
import { fetchCsvRows } from './csv.js';
import { serverConfig } from './config.js';
import { appStore } from './store.js';

const SAMPLE_MENU: MenuItem[] = [
  {
    id: 'croquetas-caseras',
    name: 'Croquetas caseras',
    description: 'Racion cremosa de jamon iberico con rebozado crujiente.',
    price: 8.5,
    category: 'Entrantes',
    sortOrder: 0,
    allergens: ['gluten', 'lacteos'],
    dietary: [],
    available: true,
    ingredients: ['jamon iberico', 'bechamel', 'pan rallado'],
  },
  {
    id: 'ensaladilla-de-la-casa',
    name: 'Ensaladilla de la casa',
    description: 'Patata, ventresca y mayonesa suave terminada al momento.',
    price: 7.9,
    category: 'Entrantes',
    sortOrder: 1,
    allergens: ['huevo', 'pescado'],
    dietary: [],
    available: true,
    ingredients: ['patata', 'ventresca', 'mayonesa'],
  },
  {
    id: 'presa-iberica',
    name: 'Presa iberica',
    description: 'Pieza jugosa con patata asada y reduccion propia.',
    price: 17.5,
    category: 'Principales',
    sortOrder: 2,
    allergens: [],
    dietary: ['sin gluten'],
    available: true,
    ingredients: ['presa iberica', 'patata', 'romero'],
  },
  {
    id: 'lubina-a-la-plancha',
    name: 'Lubina a la plancha',
    description: 'Lubina fresca con verduras de temporada y aceite de limon.',
    price: 18.9,
    category: 'Principales',
    sortOrder: 3,
    allergens: ['pescado'],
    dietary: ['sin gluten'],
    available: true,
    ingredients: ['lubina', 'verduras', 'limon'],
  },
  {
    id: 'tarta-de-queso',
    name: 'Tarta de queso',
    description: 'Tarta cremosa horneada con coulis de frutos rojos.',
    price: 6.2,
    category: 'Postres',
    sortOrder: 4,
    allergens: ['gluten', 'lacteos', 'huevo'],
    dietary: [],
    available: true,
    ingredients: ['queso crema', 'nata', 'frutos rojos'],
  },
  {
    id: 'agua-mineral',
    name: 'Agua mineral',
    description: 'Botella fria de agua mineral natural.',
    price: 2.3,
    category: 'Bebidas',
    sortOrder: 5,
    allergens: [],
    dietary: ['vegano'],
    available: true,
    ingredients: ['agua'],
  },
];

class MenuServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let memoryCache: { menu: MenuItem[]; fetchedAt: number } | null = null;

const toSlug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toPrice = (rawValue: string | undefined) => {
  const normalisedValue = rawValue?.replace(/[^\d,.-]/g, '').replace(',', '.') ?? '0';
  const parsedValue = Number.parseFloat(normalisedValue);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

const toList = (rawValue: string | undefined) =>
  (rawValue ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.toLowerCase() !== 'ninguno');

const toBoolean = (rawValue: string | undefined) => {
  const normalisedValue = (rawValue ?? 'true').trim().toLowerCase();
  return !['false', '0', 'no', 'agotado'].includes(normalisedValue);
};

const cloneMenu = (menu: MenuItem[]) =>
  [...menu]
    .map((item, index) => ({
      ...item,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
      imageUrl: item.imageUrl ?? null,
    }))
    .sort((left, right) => {
      const categoryComparison = left.category.localeCompare(right.category, 'es');
      if (categoryComparison !== 0) {
        return categoryComparison;
      }

      const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.name.localeCompare(right.name, 'es');
    });

const sanitiseList = (values?: string[]) =>
  Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const normaliseMenuInput = (input: CreateMenuItemRequest | UpdateMenuItemRequest, currentSortOrder: number): MenuItem => {
  const name = input.name?.trim();
  const category = input.category?.trim();

  if (!name) {
    throw new MenuServiceError('El nombre del plato es obligatorio.', 400);
  }

  if (!category) {
    throw new MenuServiceError('La categoria es obligatoria.', 400);
  }

  const parsedPrice = Number(input.price);
  if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
    throw new MenuServiceError('El precio debe ser valido y no negativo.', 400);
  }

  return {
    id: '',
    name,
    description: input.description?.trim() ?? '',
    price: Number(parsedPrice.toFixed(2)),
    category,
    sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : currentSortOrder,
    allergens: sanitiseList(input.allergens),
    dietary: sanitiseList(input.dietary),
    available: input.available ?? true,
    ingredients: sanitiseList(input.ingredients),
    imageUrl: input.imageUrl?.trim() || null,
  };
};

const buildMenuFromRows = (rows: Array<Record<string, string>>): MenuItem[] => {
  const collisions = new Map<string, number>();

  return rows
    .map((row, index) => {
      const name = row.nombre || row.plato || row.titulo || row.name;
      if (!name) {
        return null;
      }

      const baseId = toSlug(row.id || row.codigo || row.sku || name);
      const collisionCount = (collisions.get(baseId) ?? 0) + 1;
      collisions.set(baseId, collisionCount);

      return {
        id: collisionCount === 1 ? baseId : `${baseId}-${collisionCount}`,
        name,
        description: row.descripcion || row.description || '',
        price: toPrice(row.precio || row.price),
        category: row.categoria || row.category || 'Carta',
        sortOrder: index,
        allergens: toList(row.alergenos || row.allergens),
        dietary: toList(row.tipo_dieta || row.dietary),
        available: toBoolean(row.disponibilidad || row.available),
        ingredients: toList(row.ingredientes || row.ingredients),
        imageUrl: row.image_url || row.imagen || row.image || null,
      } satisfies MenuItem;
    })
    .filter((item) => item !== null) as MenuItem[];
};

async function persistMenu(menu: MenuItem[], updatedBy: 'system' | 'admin' | 'legacy_import') {
  const normalizedMenu = cloneMenu(menu);
  const nextStore = await appStore.update((currentStore) => ({
    ...currentStore,
    menu: normalizedMenu,
    menuMetadata: {
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: updatedBy,
    },
    lastLegacyMenuImportAt:
      updatedBy === 'legacy_import' ? new Date().toISOString() : currentStore.lastLegacyMenuImportAt ?? null,
  }));

  memoryCache = { menu: nextStore.menu, fetchedAt: Date.now() };
  appStore.notifyMenuChanged(nextStore.menu);
  return nextStore.menu;
}

function getNextUniqueId(menu: MenuItem[], requestedName: string) {
  const baseId = toSlug(requestedName);
  if (!menu.some((item) => item.id === baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (menu.some((item) => item.id === `${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

async function ensureMenuSeeded() {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < serverConfig.menuCacheTtlMs) {
    return memoryCache.menu;
  }

  const currentStore = await appStore.read();
  if (currentStore.menu.length > 0) {
    const menu = cloneMenu(currentStore.menu);
    memoryCache = { menu, fetchedAt: Date.now() };
    return menu;
  }

  if (serverConfig.menuCsvUrl) {
    try {
      const rows = await fetchCsvRows(serverConfig.menuCsvUrl);
      const importedMenu = buildMenuFromRows(rows);
      if (importedMenu.length > 0) {
        return await persistMenu(importedMenu, 'legacy_import');
      }
    } catch (error) {
      console.error('[menu] No se pudo importar la carta remota:', error);
    }
  }

  return await persistMenu(SAMPLE_MENU, 'system');
}

export async function getMenu(includeUnavailable = false): Promise<MenuItem[]> {
  const menu = await ensureMenuSeeded();
  return includeUnavailable ? menu : menu.filter((item) => item.available);
}

export async function getAdminMenu(): Promise<MenuItem[]> {
  return ensureMenuSeeded();
}

export async function createMenuItem(input: CreateMenuItemRequest) {
  const currentMenu = await ensureMenuSeeded();
  const nextMenuItem = normaliseMenuInput(input, currentMenu.length);
  nextMenuItem.id = getNextUniqueId(currentMenu, nextMenuItem.name);

  return persistMenu([...currentMenu, nextMenuItem], 'admin');
}

export async function updateMenuItem(itemId: string, input: UpdateMenuItemRequest) {
  const currentMenu = await ensureMenuSeeded();
  const targetItem = currentMenu.find((item) => item.id === itemId);

  if (!targetItem) {
    throw new MenuServiceError('El plato no existe.', 404);
  }

  const mergedInput: CreateMenuItemRequest = {
    ...targetItem,
    ...input,
    name: input.name ?? targetItem.name,
    category: input.category ?? targetItem.category,
    description: input.description ?? targetItem.description,
    price: input.price ?? targetItem.price,
    sortOrder: input.sortOrder ?? targetItem.sortOrder,
    allergens: input.allergens ?? targetItem.allergens,
    dietary: input.dietary ?? targetItem.dietary,
    available: input.available ?? targetItem.available,
    ingredients: input.ingredients ?? targetItem.ingredients,
    imageUrl: input.imageUrl ?? targetItem.imageUrl ?? null,
  };

  const normalizedItem = normaliseMenuInput(mergedInput, targetItem.sortOrder ?? 0);
  normalizedItem.id = targetItem.id;

  return persistMenu(
    currentMenu.map((item) => (item.id === itemId ? normalizedItem : item)),
    'admin',
  );
}

export async function deleteMenuItem(itemId: string) {
  const currentMenu = await ensureMenuSeeded();
  if (!currentMenu.some((item) => item.id === itemId)) {
    throw new MenuServiceError('El plato no existe.', 404);
  }

  return persistMenu(
    currentMenu
      .filter((item) => item.id !== itemId)
      .map((item, index) => ({ ...item, sortOrder: index })),
    'admin',
  );
}

export async function updateMenuItemAvailability(itemId: string, available: boolean) {
  return updateMenuItem(itemId, { available });
}

export async function reorderMenu(input: ReorderMenuRequest) {
  const currentMenu = await ensureMenuSeeded();
  const orderMap = new Map(input.items.map((item) => [item.id, item.sortOrder]));

  return persistMenu(
    currentMenu.map((item, index) => ({
      ...item,
      sortOrder: orderMap.get(item.id) ?? item.sortOrder ?? index,
    })),
    'admin',
  );
}

export function toMenuServiceError(error: unknown) {
  if (error instanceof MenuServiceError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new MenuServiceError(error.issues[0]?.message || 'Los datos de la carta no son validos.', 400);
  }

  return new MenuServiceError('Se produjo un error inesperado con la carta.', 500);
}
