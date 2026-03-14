import type { MenuItem } from './types.js';

interface SystemInstructionOptions {
  assistantName: string;
  restaurantName: string;
  tableNumber: string;
  menu: MenuItem[];
}

const BASE_SYSTEM_PROMPT = `
Eres un camarero virtual profesional.
Hablas siempre en español de España con un tono amable, claro y breve.
Tu objetivo es ayudar al cliente a pedir con precisión y sin inventarte platos.

Reglas de herramientas:
- Usa "setDiners" cuando el cliente confirme cuántas personas hay en la mesa.
- Usa "addToOrder" solo cuando el cliente pida añadir algo nuevo.
- Usa "removeFromOrder" cuando el cliente quite o corrija un plato.
- Usa "confirmOrder" solo cuando el cliente confirme que el pedido está correcto.
- Usa "endSession" justo después de cerrar la conversación con una despedida breve.

Reglas de conversación:
- Saluda tú primero al iniciar la sesión.
- Si el cliente pide algo que no existe, dilo con claridad y ofrece una alternativa real.
- Antes de confirmar el pedido, haz un resumen verbal corto.
- No repitas herramientas si ya se ejecutaron correctamente.
- Si hay confusión o ruido, pide una aclaración breve.
`.trim();

const normaliseList = (values: string[]) => values.map((value) => value.trim()).filter(Boolean);

export function buildSystemInstruction({
  assistantName,
  restaurantName,
  tableNumber,
  menu,
}: SystemInstructionOptions): string {
  const availableItems = menu.filter((item) => item.available);
  const categoryMap = new Map<string, MenuItem[]>();

  availableItems.forEach((item) => {
    const category = item.category || 'Carta';
    const currentItems = categoryMap.get(category) ?? [];
    currentItems.push(item);
    categoryMap.set(category, currentItems);
  });

  const menuSections = Array.from(categoryMap.entries())
    .map(([category, items]) => {
      const lines = items.map((item) => {
        const tags: string[] = [];
        const allergens = normaliseList(item.allergens);
        const dietary = normaliseList(item.dietary);

        if (allergens.length > 0) {
          tags.push(`Alérgenos: ${allergens.join(', ')}`);
        }

        if (dietary.length > 0) {
          tags.push(dietary.join(', '));
        }

        const suffix = tags.length > 0 ? ` [${tags.join(' | ')}]` : '';
        return `- ${item.name} (${item.price.toFixed(2)} €): ${item.description}${suffix}`;
      });

      return `${category}:\n${lines.join('\n')}`;
    })
    .join('\n\n');

  return [
    BASE_SYSTEM_PROMPT,
    `Nombre del asistente: ${assistantName}.`,
    `Nombre del restaurante: ${restaurantName}.`,
    `Mesa activa: ${tableNumber}.`,
    'Menú disponible actual:',
    menuSections || '- No hay platos disponibles en este momento.',
    'Importante: solo puedes trabajar con los platos listados arriba y debes usar sus nombres exactos.',
    `Saludo sugerido: "Hola, soy ${assistantName}. ¿Cuántas personas sois en la mesa?"`,
  ].join('\n\n');
}
