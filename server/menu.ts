import type { MenuItem } from '../types.js';
import { fetchCsvRows } from './csv.js';
import { serverConfig } from './config.js';
import { appStore } from './store.js';

const SAMPLE_MENU: MenuItem[] = [
  {
    id: 'croquetas-caseras',
    name: 'Croquetas caseras',
    description: 'Ración cremosa de jamón ibérico con rebozado crujiente.',
    price: 8.5,
    category: 'Entrantes',
    allergens: ['gluten', 'lácteos'],
    dietary: [],
    available: true,
    ingredients: ['jamón ibérico', 'bechamel', 'pan rallado'],
  },
  {
    id: 'ensaladilla-de-la-casa',
    name: 'Ensaladilla de la casa',
    description: 'Patata, ventresca y mayonesa suave terminada al momento.',
    price: 7.9,
    category: 'Entrantes',
    allergens: ['huevo', 'pescado'],
    dietary: [],
    available: true,
    ingredients: ['patata', 'ventresca', 'mayonesa'],
  },
  {
    id: 'presa-iberica',
    name: 'Presa ibérica',
    description: 'Pieza jugosa con patata asada y reducción propia.',
    price: 17.5,
    category: 'Principales',
    allergens: [],
    dietary: ['sin gluten'],
    available: true,
    ingredients: ['presa ibérica', 'patata', 'romero'],
  },
  {
    id: 'lubina-a-la-plancha',
    name: 'Lubina a la plancha',
    description: 'Lubina fresca con verduras de temporada y aceite de limón.',
    price: 18.9,
    category: 'Principales',
    allergens: ['pescado'],
    dietary: ['sin gluten'],
    available: true,
    ingredients: ['lubina', 'verduras', 'limón'],
  },
  {
    id: 'tarta-de-queso',
    name: 'Tarta de queso',
    description: 'Tarta cremosa horneada con coulis de frutos rojos.',
    price: 6.2,
    category: 'Postres',
    allergens: ['gluten', 'lácteos', 'huevo'],
    dietary: [],
    available: true,
    ingredients: ['queso crema', 'nata', 'frutos rojos'],
  },
  {
    id: 'agua-mineral',
    name: 'Agua mineral',
    description: 'Botella fría de agua mineral natural.',
    price: 2.3,
    category: 'Bebidas',
    allergens: [],
    dietary: ['vegano'],
    available: true,
    ingredients: ['agua'],
  },
];

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

const buildMenuFromRows = (rows: Array<Record<string, string>>): MenuItem[] => {
  const collisions = new Map<string, number>();

  return rows
    .map((row) => {
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
        allergens: toList(row.alergenos || row.allergens),
        dietary: toList(row.tipo_dieta || row.dietary),
        available: toBoolean(row.disponibilidad || row.available),
        ingredients: toList(row.ingredientes || row.ingredients),
        imageUrl: row.image_url || row.imagen || row.image || null,
      } satisfies MenuItem;
    })
    .filter((item) => item !== null) as MenuItem[];
};

const persistMenuCache = async (menu: MenuItem[]) => {
  await appStore.update((currentStore) => ({
    ...currentStore,
    menuCache: menu,
    lastMenuSyncAt: new Date().toISOString(),
  }));
};

export async function getMenu(): Promise<MenuItem[]> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < serverConfig.menuCacheTtlMs) {
    return memoryCache.menu;
  }

  const currentStore = await appStore.read();

  if (serverConfig.menuCsvUrl) {
    try {
      const rows = await fetchCsvRows(serverConfig.menuCsvUrl);
      const menu = buildMenuFromRows(rows).filter((item) => item.available);

      if (menu.length > 0) {
        memoryCache = { menu, fetchedAt: Date.now() };
        await persistMenuCache(menu);
        return menu;
      }
    } catch (error) {
      console.error('[menu] No se pudo actualizar el menú remoto:', error);
    }
  }

  if (currentStore.menuCache.length > 0) {
    memoryCache = { menu: currentStore.menuCache, fetchedAt: Date.now() };
    return currentStore.menuCache;
  }

  memoryCache = { menu: SAMPLE_MENU, fetchedAt: Date.now() };
  await persistMenuCache(SAMPLE_MENU);
  return SAMPLE_MENU;
}
