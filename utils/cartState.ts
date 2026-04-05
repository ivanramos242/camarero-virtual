import type { CartItem, MenuItem } from '../types';

const MAX_CART_ACTION_QUANTITY = 12;

export interface AddCartItemResult {
  items: CartItem[];
  addedLine: CartItem;
  merged: boolean;
  quantityAdded: number;
}

export interface RemoveCartUnitsTarget {
  menuItemId?: string;
  itemName?: string;
  quantity?: number;
  notes?: string;
}

export interface RemoveCartUnitsResult {
  items: CartItem[];
  removedQuantity: number;
  matched: boolean;
  requiresClarification?: boolean;
  matchingLines?: CartItem[];
}

interface AddCartItemOptions {
  notes?: string;
  createId: () => string;
  timestamp: string;
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCartNotes(value?: string) {
  return normalizeText(value ?? '');
}

export function clampCartActionQuantity(rawValue: number) {
  const safeValue = Number.isFinite(rawValue) ? Math.trunc(rawValue) : 1;
  return Math.max(1, Math.min(MAX_CART_ACTION_QUANTITY, safeValue || 1));
}

export function summarizeCartItems(items: CartItem[]) {
  if (items.length === 0) {
    return 'Pedido vacio.';
  }

  return items.map((item) => `${item.quantity}x ${item.menuItem.name}`).join(', ');
}

export function buildCartSignature(items: CartItem[]) {
  return items
    .map((item) => `${item.menuItem.id}:${item.quantity}:${normalizeCartNotes(item.notes)}`)
    .sort()
    .join('|');
}

export function addCartItem(items: CartItem[], item: MenuItem, quantity: number, options: AddCartItemOptions): AddCartItemResult {
  const normalizedNotes = normalizeCartNotes(options.notes);
  const clampedQuantity = clampCartActionQuantity(quantity);
  const existingIndex = items.findIndex(
    (cartItem) => cartItem.menuItem.id === item.id && normalizeCartNotes(cartItem.notes) === normalizedNotes,
  );

  if (existingIndex >= 0) {
    const nextItems = [...items];
    const updatedLine = {
      ...nextItems[existingIndex],
      quantity: nextItems[existingIndex].quantity + clampedQuantity,
    };
    nextItems[existingIndex] = updatedLine;
    return {
      items: nextItems,
      addedLine: updatedLine,
      merged: true,
      quantityAdded: clampedQuantity,
    };
  }

  const addedLine: CartItem = {
    id: options.createId(),
    menuItem: item,
    quantity: clampedQuantity,
    notes: options.notes?.trim() || undefined,
    timestamp: options.timestamp,
  };

  return {
    items: [...items, addedLine],
    addedLine,
    merged: false,
    quantityAdded: clampedQuantity,
  };
}

export function removeCartLine(items: CartItem[], itemId: string) {
  return items.filter((item) => item.id !== itemId);
}

export function updateCartLineQuantity(items: CartItem[], itemId: string, quantity: number) {
  const nextQuantity = Math.max(0, Math.trunc(quantity));
  return items
    .map((item) => (item.id === itemId ? { ...item, quantity: nextQuantity } : item))
    .filter((item) => item.quantity > 0);
}

function matchesRemovalTarget(item: CartItem, target: RemoveCartUnitsTarget) {
  const requestedId = target.menuItemId?.trim();
  const normalizedRequestedNotes = normalizeCartNotes(target.notes);

  if (requestedId) {
    if (item.menuItem.id !== requestedId) {
      return false;
    }

    if (normalizedRequestedNotes) {
      return normalizeCartNotes(item.notes) === normalizedRequestedNotes;
    }

    return true;
  }

  if (normalizedRequestedNotes && normalizeCartNotes(item.notes) !== normalizedRequestedNotes) {
    return false;
  }

  const requestedName = normalizeText(target.itemName ?? '');
  if (!requestedName) {
    return false;
  }

  const normalizedItemName = normalizeText(item.menuItem.name);
  return normalizedItemName === requestedName || normalizedItemName.includes(requestedName) || requestedName.includes(normalizedItemName);
}

export function removeCartUnits(items: CartItem[], target: RemoveCartUnitsTarget): RemoveCartUnitsResult {
  const quantityToRemove = clampCartActionQuantity(target.quantity ?? 1);
  const matchingLines = items.filter((item) => matchesRemovalTarget(item, target));

  if (matchingLines.length === 0) {
    return {
      items,
      removedQuantity: 0,
      matched: false,
    };
  }

  const normalizedRequestedNotes = normalizeCartNotes(target.notes);
  if (matchingLines.length > 1 && !normalizedRequestedNotes) {
    return {
      items,
      removedQuantity: 0,
      matched: true,
      requiresClarification: true,
      matchingLines,
    };
  }

  let remainingToRemove = quantityToRemove;

  const nextItems = items.flatMap((item) => {
    if (!matchesRemovalTarget(item, target) || remainingToRemove <= 0) {
      return [item];
    }

    const removedNow = Math.min(item.quantity, remainingToRemove);
    remainingToRemove -= removedNow;

    const nextQuantity = item.quantity - removedNow;
    if (nextQuantity <= 0) {
      return [];
    }

    return [{ ...item, quantity: nextQuantity }];
  });

  return {
    items: nextItems,
    removedQuantity: quantityToRemove - remainingToRemove,
    matched: true,
  };
}
