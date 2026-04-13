import { describe, expect, it } from 'vitest';

import type { CartItem, MenuItem } from '../types';
import { buildVoiceWelcomeMessage, parseLocalVoiceIntent } from './useLiveSession';

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
  voiceAliases: ['croquetas'],
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
  voiceAliases: ['tarta'],
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

describe('parseLocalVoiceIntent', () => {
  it('genera un saludo breve que confirma el micrófono y explica qué puede hacer Ramiro', () => {
    expect(buildVoiceWelcomeMessage('Ramiro')).toBe(
      'Hola, soy Ramiro. Micrófono activado. Puedo recomendarte platos, resolver dudas de la carta y tomar tu pedido. Mantén pulsado para hablar.',
    );
  });

  it('prioriza anadir frente a confirmacion cuando la frase mezcla ambas cosas', () => {
    const intent = parseLocalVoiceIntent('ponme una tarta de queso y ya estaria', [croquetas, tarta], []);
    expect(intent.type).toBe('add');
  });

  it('prioriza quitar frente a confirmacion cuando la frase mezcla ambas cosas', () => {
    const intent = parseLocalVoiceIntent('quita las croquetas caseras, correcto', [croquetas, tarta], [createCartLine('1', croquetas, 2)]);
    expect(intent.type).toBe('remove');
  });

  it('no permite que la misma frase confirme justo despues de armar la confirmacion pendiente', () => {
    const intent = parseLocalVoiceIntent('confirma pedido', [croquetas, tarta], [createCartLine('1', croquetas, 2)], true, true);
    expect(intent.type).toBe('unknown');
  });

  it('si confirma cuando la confirmacion pendiente viene de un turno anterior', () => {
    const intent = parseLocalVoiceIntent('si, confirma pedido', [croquetas, tarta], [createCartLine('1', croquetas, 2)], true, false);
    expect(intent.type).toBe('confirm');
  });

  it('detecta el plato aunque exista repetido en varias lineas del pedido', () => {
    const intent = parseLocalVoiceIntent(
      'quita una croqueta',
      [croquetas, tarta],
      [
        createCartLine('1', croquetas, 1, 'sin alioli'),
        createCartLine('2', croquetas, 1, 'muy hechas'),
      ],
    );

    expect(intent.type).toBe('remove');
  });
});
