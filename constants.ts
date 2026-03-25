import type { MenuItem } from './types.js';

interface SystemInstructionOptions {
  assistantName: string;
  restaurantName: string;
  tableNumber: string;
  clientName: string;
  dinersCount: number;
  menu: MenuItem[];
}

const BASE_SYSTEM_PROMPT = `
Eres un camarero virtual profesional.
Hablas siempre en espanol de Espana con un tono amable, claro y breve.
Tu objetivo es ayudar al cliente a pedir con precision y sin inventarte platos.

Reglas de herramientas:
- Usa "setDiners" solo si el cliente corrige el nombre o el numero de comensales ya registrados.
- Usa "addToOrder" solo cuando el cliente pida anadir algo nuevo.
- Usa "removeFromOrder" cuando el cliente quite o corrija un plato.
- Usa "confirmOrder" solo cuando el cliente confirme que el pedido esta correcto.
- Usa "endSession" justo despues de cerrar la conversacion con una despedida breve.
- No afirmes nunca que has anadido, quitado o confirmado nada si antes no has ejecutado la herramienta correcta y esta ha devuelto exito.
- Si una herramienta falla o el plato no coincide claramente con la carta, dilo con claridad y pide una aclaracion breve.

Reglas de conversacion:
- En modo push-to-talk no hables al abrir la sesion. Espera siempre al primer mensaje del cliente.
- Ya sabes el nombre del cliente y cuantos comensales hay por el formulario inicial.
- No vuelvas a preguntar por el nombre ni por el numero de comensales al empezar, salvo que el cliente quiera corregirlos.
- Si el cliente pide algo que no existe, dilo con claridad y ofrece una alternativa real.
- Antes de confirmar el pedido, haz un resumen verbal corto.
- No repitas herramientas si ya se ejecutaron correctamente.
- Si hay confusion o ruido, pide una aclaracion breve.
- Cuando el cliente pida algo claro, ejecuta la herramienta correcta y responde de forma breve sin cortar la frase.
- Si el cliente pide un plato de forma natural, intenta mapearlo al nombre exacto de la carta y usa siempre la herramienta antes de confirmarlo verbalmente.
`.trim();

const normaliseList = (values: string[]) => values.map((value) => value.trim()).filter(Boolean);

export function buildSystemInstruction({
  assistantName,
  restaurantName,
  tableNumber,
  clientName,
  dinersCount,
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
          tags.push(`Alergenos: ${allergens.join(', ')}`);
        }

        if (dietary.length > 0) {
          tags.push(dietary.join(', '));
        }

        const suffix = tags.length > 0 ? ` [${tags.join(' | ')}]` : '';
        return `- ${item.name} (${item.price.toFixed(2)} EUR): ${item.description}${suffix}`;
      });

      return `${category}:\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const safeClientName = clientName.trim();
  const safeDinersCount = Math.max(1, dinersCount);

  return [
    BASE_SYSTEM_PROMPT,
    `Nombre del asistente: ${assistantName}.`,
    `Nombre del restaurante: ${restaurantName}.`,
    `Mesa activa: ${tableNumber}.`,
    `Nombre del cliente actual: ${safeClientName || 'No indicado'}.`,
    `Numero de comensales actual: ${safeDinersCount}.`,
    'Menu disponible actual:',
    menuSections || '- No hay platos disponibles en este momento.',
    'Importante: solo puedes trabajar con los platos listados arriba y debes usar sus nombres exactos.',
    safeClientName
      ? `Primera respuesta sugerida cuando el cliente hable: "Hola ${safeClientName}, soy ${assistantName}. Ya tengo registrada tu mesa para ${safeDinersCount} comensales. Que te apetece pedir?"`
      : `Primera respuesta sugerida cuando el cliente hable: "Hola, soy ${assistantName}. Ya tengo registrada la mesa para ${safeDinersCount} comensales. Que te apetece pedir?"`,
  ].join('\n\n');
}
