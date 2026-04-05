import { describe, expect, it } from 'vitest';

import type { CartItem, MenuItem } from '../types';
import {
  addCartItem,
  buildCartSignature,
  removeCartUnitsBatch,
  removeCartUnits,
  summarizeCartItems,
  updateCartLineQuantity,
} from './cartState';

const croquetas: MenuItem = {
  id: 'croquetas-caseras',
  name: 'Croquetas caseras',
  description: 'Croquetas de jamon iberico.',
  price: 8.5,
  category: 'Entrantes',
  allergens: ['gluten'],
  dietary: [],
  available: true,
  ingredients: ['jamon iberico'],
};

const tarta: MenuItem = {
  id: 'tarta-de-queso',
  name: 'Tarta de queso',
  description: 'Tarta cremosa.',
  price: 6.2,
  category: 'Postres',
  allergens: ['gluten', 'lacteos'],
  dietary: [],
  available: true,
  ingredients: ['queso crema'],
};

function createCartLine(id: string, menuItem: MenuItem, quantity: number, notes?: string): CartItem {
  return {
    id,
    menuItem,
    quantity,
    notes,
    timestamp: '2026-04-03T00:00:00.000Z',
  };
}

describe('cartState', () => {
  it('acumula la misma linea cuando plato y notas coinciden', () => {
    const initialItems = [createCartLine('1', croquetas, 1, 'sin gluten')];
    const result = addCartItem(initialItems, croquetas, 2, {
      notes: '  SIN GLUTEN ',
      createId: () => '2',
      timestamp: '2026-04-03T00:00:01.000Z',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(3);
    expect(result.merged).toBe(true);
  });

  it('crea otra linea cuando cambian las notas', () => {
    const initialItems = [createCartLine('1', croquetas, 1, 'sin alioli')];
    const result = addCartItem(initialItems, croquetas, 1, {
      notes: 'extra crujientes',
      createId: () => '2',
      timestamp: '2026-04-03T00:00:01.000Z',
    });

    expect(result.items).toHaveLength(2);
    expect(result.merged).toBe(false);
  });

  it('quita una linea concreta cuando se indican sus notas', () => {
    const initialItems = [
      createCartLine('1', croquetas, 1, 'sin alioli'),
      createCartLine('2', croquetas, 2, 'muy hechas'),
      createCartLine('3', tarta, 1),
    ];

    const result = removeCartUnits(initialItems, {
      menuItemId: croquetas.id,
      quantity: 1,
      notes: 'sin alioli',
    });

    expect(result.removedQuantity).toBe(1);
    expect(result.items).toEqual([
      createCartLine('2', croquetas, 2, 'muy hechas'),
      createCartLine('3', tarta, 1),
    ]);
  });

  it('pide aclaracion si el mismo plato existe en varias lineas y no se indica cual', () => {
    const initialItems = [
      createCartLine('1', croquetas, 1, 'sin alioli'),
      createCartLine('2', croquetas, 2, 'muy hechas'),
    ];

    const result = removeCartUnits(initialItems, {
      menuItemId: croquetas.id,
      quantity: 1,
    });

    expect(result.matched).toBe(true);
    expect(result.requiresClarification).toBe(true);
    expect(result.removedQuantity).toBe(0);
    expect(result.matchingLines).toEqual(initialItems);
    expect(result.items).toEqual(initialItems);
  });

  it('no aplica un borrado multiple parcial si una de las lineas necesita aclaracion', () => {
    const initialItems = [
      createCartLine('1', tarta, 1),
      createCartLine('2', croquetas, 1, 'sin alioli'),
      createCartLine('3', croquetas, 2, 'muy hechas'),
    ];

    const result = removeCartUnitsBatch(initialItems, [
      {
        menuItemId: tarta.id,
        itemName: tarta.name,
        quantity: 1,
      },
      {
        menuItemId: croquetas.id,
        itemName: croquetas.name,
        quantity: 1,
      },
    ]);

    expect(result.requiresClarification).toBe(true);
    expect(result.removedQuantity).toBe(0);
    expect(result.clarificationTarget).toEqual({
      menuItemId: croquetas.id,
      itemName: croquetas.name,
      quantity: 1,
    });
    expect(result.matchingLines).toEqual([
      createCartLine('2', croquetas, 1, 'sin alioli'),
      createCartLine('3', croquetas, 2, 'muy hechas'),
    ]);
    expect(result.items).toEqual(initialItems);
  });

  it('no inventa borrados cuando el plato ya no esta', () => {
    const initialItems = [createCartLine('1', tarta, 1)];
    const result = removeCartUnits(initialItems, {
      menuItemId: croquetas.id,
      quantity: 1,
    });

    expect(result.matched).toBe(false);
    expect(result.removedQuantity).toBe(0);
    expect(result.items).toBe(initialItems);
  });

  it('mantiene una firma estable y un resumen legible', () => {
    const items = [
      createCartLine('1', tarta, 1),
      createCartLine('2', croquetas, 2, 'sin alioli'),
    ];

    expect(buildCartSignature(items)).toBe('croquetas-caseras:2:sin alioli|tarta-de-queso:1:');
    expect(summarizeCartItems(items)).toBe('1x Tarta de queso, 2x Croquetas caseras');
  });

  it('elimina lineas cuando la cantidad se actualiza a cero', () => {
    const items = [createCartLine('1', tarta, 2)];
    expect(updateCartLineQuantity(items, '1', 0)).toEqual([]);
  });
});
