import { describe, expect, it } from 'vitest';

import type { CartItem, MenuItem } from '../types';
import {
  buildToolCallSignature,
  extractVoiceNotes,
  getTurnRecoveryTimeoutMs,
  mergeVoiceTranscriptFragment,
  parseLocalVoiceIntent,
} from './useLiveSession';

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

const tartaChocolate: MenuItem = {
  id: 'tarta-de-chocolate',
  name: 'Tarta de chocolate',
  description: 'Tarta de cacao.',
  price: 6.4,
  category: 'Postres',
  allergens: ['gluten', 'lacteos'],
  dietary: [],
  available: true,
  ingredients: ['chocolate'],
  voiceAliases: ['tarta choco'],
};

const cola: MenuItem = {
  id: 'coca-cola',
  name: 'Coca-Cola',
  description: 'Refresco.',
  price: 2.8,
  category: 'Bebidas',
  allergens: [],
  dietary: [],
  available: true,
  ingredients: [],
  voiceAliases: ['coca cola'],
};

const colaZero: MenuItem = {
  id: 'coca-cola-zero',
  name: 'Coca-Cola Zero',
  description: 'Refresco sin azúcar.',
  price: 2.8,
  category: 'Bebidas',
  allergens: [],
  dietary: [],
  available: true,
  ingredients: [],
  voiceAliases: ['coca cola zero'],
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
  it('amplía la ventana de recuperación cuando Ramiro aún tiene audio en cola', () => {
    expect(
      getTurnRecoveryTimeoutMs({
        reason: 'audio remoto',
        queuedAudioMs: 20_000,
        hasLocalSpeech: false,
      }),
    ).toBe(45_000);
  });

  it('mantiene una ventana amplia para voz local y evita cortar frases largas', () => {
    expect(
      getTurnRecoveryTimeoutMs({
        reason: 'voz local',
        queuedAudioMs: 0,
        hasLocalSpeech: true,
      }),
    ).toBe(45_000);
  });

  it('usa una espera distinta cuando Ramiro aún está pensando y no hablando', () => {
    expect(
      getTurnRecoveryTimeoutMs({
        reason: 'espera de respuesta',
        queuedAudioMs: 20_000,
        hasLocalSpeech: true,
      }),
    ).toBe(25_000);
  });

  it('extrae observaciones habituales del pedido desde la frase del cliente', () => {
    expect(extractVoiceNotes('ponme una coca cola sin hielo y para compartir')).toBe('sin hielo, para compartir');
  });

  it('prioriza añadir frente a confirmación cuando la frase mezcla ambas cosas', () => {
    const intent = parseLocalVoiceIntent('ponme una tarta de queso y ya estaria', [croquetas, tarta], []);
    expect(intent.type).toBe('add');
  });

  it('detecta un pedido natural por alias aunque el cliente no use un verbo explicito', () => {
    const intent = parseLocalVoiceIntent('dos croquetas', [croquetas, tarta], []);
    expect(intent.type).toBe('add');
    if (intent.type !== 'add') {
      throw new Error('Se esperaba una intención de alta por alias.');
    }
    expect(intent.quantity).toBe(2);
  });

  it('detecta varios platos por alias en una frase natural sin verbo explicito', () => {
    const intent = parseLocalVoiceIntent('croquetas y una tarta', [croquetas, tarta], []);
    expect(intent.type).toBe('addMany');
    if (intent.type !== 'addMany') {
      throw new Error('Se esperaba una intención de alta múltiple.');
    }
    expect(intent.items).toHaveLength(2);
  });

  it('detecta todos los platos aunque la transcripción no incluya una conjunción clara', () => {
    const intent = parseLocalVoiceIntent('ponme dos croquetas una tarta de queso', [croquetas, tarta], []);
    expect(intent.type).toBe('addMany');
    if (intent.type !== 'addMany') {
      throw new Error('Se esperaba una intención de alta múltiple.');
    }
    expect(intent.items.map((entry) => [entry.item.id, entry.quantity])).toEqual([
      ['croquetas-caseras', 2],
      ['tarta-de-queso', 1],
    ]);
  });

  it('detecta bebidas con nombres solapados aunque falten separadores claros', () => {
    const intent = parseLocalVoiceIntent('ponme dos coca cola zero una coca cola', [cola, colaZero], []);
    expect(intent.type).toBe('addMany');
    if (intent.type !== 'addMany') {
      throw new Error('Se esperaba una intención de alta múltiple.');
    }
    expect(intent.items.map((entry) => [entry.item.id, entry.quantity])).toEqual([
      ['coca-cola-zero', 2],
      ['coca-cola', 1],
    ]);
  });

  it('no elige un alias genérico cuando hay platos parecidos y debe preguntar', () => {
    const intent = parseLocalVoiceIntent('ponme una tarta', [tarta, tartaChocolate], []);
    expect(intent.type).toBe('unknown');
  });

  it('detecta cantidades escritas hasta doce', () => {
    const intent = parseLocalVoiceIntent('ponme ocho croquetas', [croquetas, tarta], []);
    expect(intent.type).toBe('add');
    if (intent.type !== 'add') {
      throw new Error('Se esperaba una intención de alta.');
    }
    expect(intent.quantity).toBe(8);
  });

  it('reconstruye una frase completa desde fragmentos de transcripción incremental', () => {
    const first = mergeVoiceTranscriptFragment('', 'ponme dos croquetas');
    const second = mergeVoiceTranscriptFragment(first, 'croquetas y una tarta');
    const third = mergeVoiceTranscriptFragment(second, 'ponme dos croquetas y una tarta');

    expect(first).toBe('ponme dos croquetas');
    expect(second).toBe('ponme dos croquetas y una tarta');
    expect(third).toBe('ponme dos croquetas y una tarta');
  });

  it('conserva las observaciones al detectar un alta clara de pedido', () => {
    const intent = parseLocalVoiceIntent('ponme dos croquetas sin gluten', [croquetas, tarta], []);
    expect(intent.type).toBe('add');
    if (intent.type !== 'add') {
      throw new Error('Se esperaba una intención de alta.');
    }
    expect(intent.quantity).toBe(2);
    expect(intent.notes).toBe('sin gluten');
  });

  it('prioriza quitar frente a confirmación cuando la frase mezcla ambas cosas', () => {
    const intent = parseLocalVoiceIntent('quita las croquetas caseras, correcto', [croquetas, tarta], [createCartLine('1', croquetas, 2)]);
    expect(intent.type).toBe('remove');
  });

  it('no permite que la misma frase confirme justo después de armar la confirmación pendiente', () => {
    const intent = parseLocalVoiceIntent('confirma pedido', [croquetas, tarta], [createCartLine('1', croquetas, 2)], true, true);
    expect(intent.type).toBe('unknown');
  });

  it('sí confirma cuando la confirmación pendiente viene de un turno anterior', () => {
    const intent = parseLocalVoiceIntent('si, confirma pedido', [croquetas, tarta], [createCartLine('1', croquetas, 2)], true, false);
    expect(intent.type).toBe('confirm');
  });

  it('detecta el plato aunque exista repetido en varias líneas del pedido', () => {
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

  it('genera la misma firma para tool calls equivalentes aunque cambie el orden de argumentos', () => {
    expect(buildToolCallSignature('addToOrder', { quantity: 1, itemName: 'Croquetas' })).toBe(
      buildToolCallSignature('addToOrder', { itemName: 'Croquetas', quantity: 1 }),
    );
  });
});
