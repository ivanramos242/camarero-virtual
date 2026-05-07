import type { MenuItem, VoiceMatchCandidate } from '../types';

const VOICE_STOP_WORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'con',
  'sin',
  'para',
  'por',
  'favor',
  'quiero',
  'queria',
  'me',
  'pon',
  'ponme',
  'ponnos',
  'trae',
  'traeme',
  'traenos',
  'dame',
  'danos',
  'anade',
  'añade',
  'pedido',
  'plato',
  'platos',
  'racion',
  'ración',
  'quita',
  'quitar',
  'elimina',
  'borra',
  'cancela',
  'confirma',
  'confirmar',
  'correcto',
  'ya',
  'estaria',
]);

export interface VoiceMenuMatch {
  item: MenuItem | null;
  confidence: number;
  reason: string;
  requiresClarification: boolean;
  candidates: VoiceMatchCandidate[];
}

function legacyResolveScore(item: MenuItem, rawQuery: string) {
  const query = normalizeVoiceText(rawQuery);
  const queryTokens = tokenizeVoiceText(rawQuery);

  if (!query) {
    return 0;
  }

  const name = normalizeVoiceText(item.name);
  const category = normalizeVoiceText(item.category);
  const ingredients = item.ingredients.map(normalizeVoiceText);
  const aliases = (item.voiceAliases ?? []).map(normalizeVoiceText);
  const haystack = [name, category, ...aliases, ...ingredients].join(' ');
  const haystackTokens = new Set(tokenizeVoiceText(`${item.name} ${item.category} ${(item.voiceAliases ?? []).join(' ')} ${item.ingredients.join(' ')}`));

  let score = 0;

  if (name === query || aliases.includes(query)) {
    score += 120;
  }

  if (name.includes(query) || query.includes(name) || aliases.some((alias) => alias.includes(query) || query.includes(alias))) {
    score += 80;
  }

  for (const token of queryTokens) {
    if (haystackTokens.has(token)) {
      score += name.includes(token) || aliases.some((alias) => alias.includes(token)) ? 22 : 10;
    } else if (haystack.includes(token)) {
      score += 6;
    }
  }

  if (queryTokens.length > 0) {
    const matchedTokens = queryTokens.filter((token) => haystackTokens.has(token)).length;
    score += (matchedTokens / queryTokens.length) * 35;
  }

  return score;
}

export function normalizeVoiceText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeVoiceText(value: string) {
  return normalizeVoiceText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !VOICE_STOP_WORDS.has(token));
}

export function parseVoiceQuantity(rawText: string) {
  const normalized = normalizeVoiceText(rawText);
  const digitMatch = normalized.match(/\b([1-9]|10|11|12)\b/);
  if (digitMatch) {
    return Number(digitMatch[1]);
  }

  const quantityMap: Record<string, number> = {
    un: 1,
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  };

  const token = normalized.split(' ').find((part) => quantityMap[part]);
  return token ? quantityMap[token] : 1;
}

function buildSearchTexts(item: MenuItem) {
  const aliases = item.voiceAliases ?? [];
  return {
    name: normalizeVoiceText(item.name),
    aliases: aliases.map(normalizeVoiceText).filter(Boolean),
    category: normalizeVoiceText(item.category),
    ingredients: item.ingredients.map(normalizeVoiceText).filter(Boolean),
    description: normalizeVoiceText(item.description),
  };
}

function buildCandidate(item: MenuItem, score: number, confidence: number, matchedOn: string): VoiceMatchCandidate {
  return {
    menuItemId: item.id,
    name: item.name,
    confidence: Number(confidence.toFixed(2)),
    score: Number(score.toFixed(2)),
    matchedOn,
  };
}

export function resolveMenuItemMatch(items: MenuItem[], rawQuery: string, menuItemId?: string): VoiceMenuMatch {
  const query = normalizeVoiceText(rawQuery);
  const queryTokens = tokenizeVoiceText(rawQuery);
  const requestedId = menuItemId?.trim();

  if (requestedId) {
    const exactById = items.find((item) => item.available && item.id === requestedId);
    if (exactById) {
      return {
        item: exactById,
        confidence: 1,
        reason: 'exact-id',
        requiresClarification: false,
        candidates: [buildCandidate(exactById, 200, 1, 'exact-id')],
      };
    }
  }

  if (!query) {
    return {
      item: null,
      confidence: 0,
      reason: 'empty-query',
      requiresClarification: false,
      candidates: [],
    };
  }

  const scored = items
    .filter((item) => item.available)
    .map((item) => {
      const searchTexts = buildSearchTexts(item);
      let score = 0;
      let matchedOn = 'legacy';

      if (searchTexts.name === query) {
        score += 150;
        matchedOn = 'exact-name';
      }

      if (searchTexts.aliases.includes(query)) {
        score += 140;
        matchedOn = matchedOn === 'exact-name' ? matchedOn : 'exact-alias';
      }

      if (searchTexts.ingredients.includes(query)) {
        score += 95;
        matchedOn = matchedOn.startsWith('exact') ? matchedOn : 'exact-ingredient';
      }

      if (searchTexts.name.startsWith(query) || query.startsWith(searchTexts.name)) {
        score += 60;
        matchedOn = matchedOn.startsWith('exact') ? matchedOn : 'name-prefix';
      }

      const aliasPrefixMatch = searchTexts.aliases.some((alias) => alias.startsWith(query) || query.startsWith(alias));
      if (aliasPrefixMatch) {
        score += 54;
        matchedOn = matchedOn.startsWith('exact') ? matchedOn : 'alias-prefix';
      }

      for (const token of queryTokens) {
        if (searchTexts.name.includes(token)) {
          score += 20;
          matchedOn = matchedOn.startsWith('exact') ? matchedOn : 'name-token';
          continue;
        }

        if (searchTexts.aliases.some((alias) => alias.includes(token))) {
          score += 18;
          matchedOn = matchedOn.startsWith('exact') ? matchedOn : 'alias-token';
          continue;
        }

        if (searchTexts.category.includes(token)) {
          score += 8;
          matchedOn = matchedOn.startsWith('exact') ? matchedOn : 'category-token';
          continue;
        }

        if (searchTexts.ingredients.some((ingredient) => ingredient.includes(token))) {
          score += 7;
          matchedOn = matchedOn.startsWith('exact') ? matchedOn : 'ingredient-token';
          continue;
        }

        if (searchTexts.description.includes(token)) {
          score += 3;
        }
      }

      if (queryTokens.length > 0) {
        const tokenMatches = queryTokens.filter((token) => {
          return (
            searchTexts.name.includes(token) ||
            searchTexts.aliases.some((alias) => alias.includes(token)) ||
            searchTexts.ingredients.some((ingredient) => ingredient.includes(token))
          );
        }).length;

        score += (tokenMatches / queryTokens.length) * 30;
      }

      const legacyScore = legacyResolveScore(item, rawQuery);
      score += legacyScore * 0.35;
      const confidence = Math.min(0.99, score / 170);
      return {
        item,
        score,
        confidence,
        matchedOn,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return {
      item: null,
      confidence: 0,
      reason: 'no-candidate',
      requiresClarification: false,
      candidates: [],
    };
  }

  const top = scored[0];
  const second = scored[1];
  const gap = second ? top.confidence - second.confidence : top.confidence;
  const requiresClarification = top.confidence < 0.72 || gap < 0.12;
  const candidates = scored.slice(0, 3).map((candidate) => buildCandidate(candidate.item, candidate.score, candidate.confidence, candidate.matchedOn));

  return {
    item: requiresClarification ? null : top.item,
    confidence: Number(top.confidence.toFixed(2)),
    reason: requiresClarification ? 'needs-clarification' : top.matchedOn,
    requiresClarification,
    candidates,
  };
}
