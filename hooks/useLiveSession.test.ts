import { describe, expect, it } from 'vitest';

import type { CartItem, MenuItem } from '../types';
import { extractVoiceNotes, getTurnRecoveryTimeoutMs, parseLocalVoiceIntent } from './useLiveSession';

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
  it('amplia la ventana de recuperación cuando Ramiro aún tiene audio en cola', () => {
    expect(
      getTurnRecoveryTimeoutMs({
        reason: 'audio remoto',
        queuedAudioMs: 20_000,
        hasLocalSpeech: false,
      }),
    ).toBe(22_500);
  });

  it('mantiene una ventana amplia para voz local y evita cortar frases largas', () => {
    expect(
      getTurnRecoveryTimeoutMs({
        reason: 'voz local',
        queuedAudioMs: 0,
        hasLocalSpeech: true,
      }),
    ).toBe(22_000);
  });

  it('usa una espera distinta cuando Ramiro aún está pensando y no hablando', () => {
    expect(
      getTurnRecoveryTimeoutMs({
        reason: 'espera de respuesta',
        queuedAudioMs: 20_000,
        hasLocalSpeech: true,
      }),
    ).toBe(12_000);
  });

  it('extrae observaciones habituales del pedido desde la frase del cliente', () => {
    expect(extractVoiceNotes('ponme una coca cola sin hielo y para compartir')).toBe('sin hielo, para compartir');
  });

  it('prioriza anadir frente a confirmacion cuando la frase mezcla ambas cosas', () => {
    const intent = parseLocalVoiceIntent('ponme una tarta de queso y ya estaria', [croquetas, tarta], []);
    expect(intent.type).toBe('add');
  });

  it('conserva las observaciones al detectar un alta clara de pedido', () => {
    const intent = parseLocalVoiceIntent('ponme dos croquetas sin gluten', [croquetas, tarta], []);
    expect(intent.type).toBe('add');
    if (intent.type !== 'add') {
      throw new Error('Se esperaba una intencion de alta.');
    }
    expect(intent.quantity).toBe(2);
    expect(intent.notes).toBe('sin gluten');
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
