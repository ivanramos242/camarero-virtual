import { describe, expect, it } from 'vitest';

import type { MenuItem } from '../types';
import { normalizeVoiceText, parseVoiceQuantity, resolveMenuItemMatch } from './voiceMatching';

const menu: MenuItem[] = [
  {
    id: 'croquetas-caseras',
    name: 'Croquetas caseras',
    description: 'Croquetas de jamon iberico.',
    price: 8.5,
    category: 'Entrantes',
    allergens: ['gluten'],
    dietary: [],
    available: true,
    ingredients: ['jamon iberico', 'bechamel'],
    voiceAliases: ['croquetas de jamon', 'croquetas'],
  },
  {
    id: 'tarta-de-queso',
    name: 'Tarta de queso',
    description: 'Tarta cremosa al horno.',
    price: 6.2,
    category: 'Postres',
    allergens: ['gluten', 'lacteos'],
    dietary: [],
    available: true,
    ingredients: ['queso crema', 'nata'],
    voiceAliases: ['cheesecake', 'tarta casera'],
  },
  {
    id: 'tarta-de-chocolate',
    name: 'Tarta de chocolate',
    description: 'Tarta intensa de cacao.',
    price: 6.4,
    category: 'Postres',
    allergens: ['gluten'],
    dietary: [],
    available: true,
    ingredients: ['chocolate', 'cacao'],
    voiceAliases: ['tarta choco'],
  },
  {
    id: 'fuera-de-carta',
    name: 'Plato oculto',
    description: 'No disponible.',
    price: 99,
    category: 'Especial',
    allergens: [],
    dietary: [],
    available: false,
    ingredients: ['secreto'],
    voiceAliases: ['oculto'],
  },
];

describe('voiceMatching', () => {
  it('normaliza texto con acentos y ruido', () => {
    expect(normalizeVoiceText('  Tárta, de   Queso!! ')).toBe('tarta de queso');
  });

  it('detecta cantidades en texto natural', () => {
    expect(parseVoiceQuantity('ponme dos croquetas')).toBe(2);
    expect(parseVoiceQuantity('quiero 3 tartas')).toBe(3);
  });

  it('resuelve por nombre exacto', () => {
    const result = resolveMenuItemMatch(menu, 'tarta de queso');
    expect(result.item?.id).toBe('tarta-de-queso');
    expect(result.requiresClarification).toBe(false);
  });

  it('resuelve por alias de voz', () => {
    const result = resolveMenuItemMatch(menu, 'croquetas de jamon');
    expect(result.item?.id).toBe('croquetas-caseras');
    expect(result.requiresClarification).toBe(false);
  });

  it('usa ingredientes como apoyo sin romper la precision', () => {
    const result = resolveMenuItemMatch(menu, 'queso crema');
    expect(result.item?.id).toBe('tarta-de-queso');
  });

  it('ignora platos no disponibles aunque coincidan', () => {
    const result = resolveMenuItemMatch(menu, 'oculto');
    expect(result.item).toBeNull();
  });

  it('pide aclaracion cuando hay empate cercano', () => {
    const result = resolveMenuItemMatch(menu, 'tarta');
    expect(result.item).toBeNull();
    expect(result.requiresClarification).toBe(true);
    expect(result.candidates.map((candidate) => candidate.menuItemId)).toContain('tarta-de-queso');
    expect(result.candidates.map((candidate) => candidate.menuItemId)).toContain('tarta-de-chocolate');
  });
});
