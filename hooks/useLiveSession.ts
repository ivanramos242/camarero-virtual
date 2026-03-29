import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityHandling, FunctionDeclaration, GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';

import { buildSystemInstruction } from '../constants';
import type {
  AppBranding,
  CartItem,
  ConnectionStatus,
  GeminiSessionTokenResponse,
  LogMessage,
  MenuItem,
  SessionTokenResponse,
  VoiceTurnState,
} from '../types';
import { fetchVoiceDiagnostics } from '../utils/api';
import { base64ToUint8Array, createPcmBlob, decodeAudioData } from '../utils/audio';

interface UseLiveSessionProps {
  branding: AppBranding;
  tableNumber: string;
  menu: MenuItem[];
  createSessionToken: () => Promise<SessionTokenResponse>;
  onAddToCart: (item: MenuItem, quantity: number, notes?: string) => void;
  onRemoveFromOrder: (itemName: string, quantity?: number) => void;
  onConfirmOrder: (diners: number, name: string, items?: CartItem[]) => Promise<boolean>;
  onSetDiners: (count: number, name?: string) => void;
  cartItems: CartItem[];
  dinersCount: number;
  clientName: string;
}

interface ToolResult {
  success?: boolean;
  message?: string;
  error?: string;
  count?: number;
}

const MAX_RECORDING_MS = 120_000;
const VOICE_CLIENT_BUILD = 'ptt-v2-no-explicit-vad';
const PLAYBACK_GAIN = 2.15;
const CAPTURE_IDLE_TEARDOWN_MS = 12_000;
const SAFARI_CAPTURE_RELEASE_MS = 180;
const AUTO_RECONNECT_DELAY_MS = 1_500;
const MAX_AUTO_RECONNECT_ATTEMPTS = 2;

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
]);

function normalizeVoiceText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeVoiceText(value: string) {
  return normalizeVoiceText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !VOICE_STOP_WORDS.has(token));
}

function resolveMenuItemFromVoiceQuery(items: MenuItem[], rawQuery: string) {
  const query = normalizeVoiceText(rawQuery);
  const queryTokens = tokenizeVoiceText(rawQuery);

  if (!query) {
    return null;
  }

  let bestMatch: { item: MenuItem; score: number } | null = null;

  for (const item of items) {
    if (!item.available) {
      continue;
    }

    const name = normalizeVoiceText(item.name);
    const category = normalizeVoiceText(item.category);
    const ingredients = item.ingredients.map(normalizeVoiceText);
    const haystack = [name, category, ...ingredients].join(' ');
    const haystackTokens = new Set(tokenizeVoiceText(`${item.name} ${item.category} ${item.ingredients.join(' ')}`));

    let score = 0;

    if (name === query) {
      score += 120;
    }

    if (name.includes(query) || query.includes(name)) {
      score += 80;
    }

    for (const token of queryTokens) {
      if (haystackTokens.has(token)) {
        score += name.includes(token) ? 22 : 10;
      } else if (haystack.includes(token)) {
        score += 6;
      }
    }

    if (queryTokens.length > 0) {
      const matchedTokens = queryTokens.filter((token) => haystackTokens.has(token)).length;
      score += (matchedTokens / queryTokens.length) * 35;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { item, score };
    }
  }

  return bestMatch && bestMatch.score >= 34 ? bestMatch.item : null;
}

function findMenuItem(items: MenuItem[], args: Record<string, unknown>, nameKey: 'itemName' | 'menuItemId' = 'itemName') {
  const menuItemId = typeof args.menuItemId === 'string' ? args.menuItemId.trim() : '';
  if (menuItemId) {
    const exactById = items.find((item) => item.available && item.id === menuItemId);
    if (exactById) {
      return exactById;
    }
  }

  const rawName = typeof args[nameKey] === 'string' ? args[nameKey] : '';
  return resolveMenuItemFromVoiceQuery(items, rawName);
}

function summarizeCartItems(items: CartItem[]) {
  if (items.length === 0) {
    return 'Pedido vacio.';
  }

  return items.map((item) => `${item.quantity}x ${item.menuItem.name}`).join(', ');
}

function buildCartSignature(items: CartItem[]) {
  return items
    .map((item) => `${item.menuItem.id}:${item.quantity}:${(item.notes || '').trim().toLowerCase()}`)
    .sort()
    .join('|');
}

function buildOrderConfirmationPrompt(items: CartItem[]) {
  if (items.length === 0) {
    return 'No veo ningun plato en el pedido todavia.';
  }

  return `Resumen del pedido: ${summarizeCartItems(items)}. Si esta todo correcto, di confirmar pedido para enviarlo a cocina.`;
}

function isExplicitFinalConfirmation(transcript: string) {
  const normalized = normalizeVoiceText(transcript);
  return /\b(si|sí|confirmo|confirmar|confirmar pedido|correcto|perfecto|adelante|vale|ok|de acuerdo|envialo|mandalo)\b/.test(normalized);
}

function parseVoiceQuantity(rawText: string) {
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
  };

  const token = normalized.split(' ').find((part) => quantityMap[part]);
  return token ? quantityMap[token] : 1;
}

function isMobileBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

function isSafariBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent;
  return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edgios|opr\//i.test(userAgent);
}

type SupportedAudioSessionType = 'auto' | 'playback' | 'play-and-record';

type LocalVoiceIntent =
  | { type: 'add'; item: MenuItem; quantity: number }
  | { type: 'remove'; item: MenuItem; quantity: number }
  | { type: 'removeMany'; items: Array<{ item: MenuItem; quantity: number }> }
  | { type: 'removeAllExcept'; items: Array<{ item: MenuItem; quantity: number }>; keepItems: MenuItem[] }
  | { type: 'confirm' }
  | { type: 'unknown' };

interface PendingAddFallback {
  itemName?: string;
  menuItemId?: string;
  quantity: number;
  notes?: string;
}

function extractMultipleRemoveIntents(transcript: string, cartItems: CartItem[]) {
  const normalized = normalizeVoiceText(transcript);
  if (!/\b(quita|quitar|elimina|borra|cancela|sin)\b/.test(normalized)) {
    return [];
  }

  const segments = normalized
    .split(/\s*(?:,| y | e | luego | despues | después | tambien | también )\s*/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const merged = new Map<string, { item: MenuItem; quantity: number }>();
  const orderItems = cartItems.map((cartItem) => cartItem.menuItem);

  for (const segment of segments) {
    const matchedItem = resolveMenuItemFromVoiceQuery(orderItems, segment);
    if (!matchedItem) {
      continue;
    }

    const quantity = Math.max(1, Math.min(12, parseVoiceQuantity(segment)));
    const existing = merged.get(matchedItem.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(matchedItem.id, { item: matchedItem, quantity });
    }
  }

  return Array.from(merged.values());
}

function findOrderItemsByCategoryOrName(cartItems: CartItem[], rawQuery: string) {
  const normalized = normalizeVoiceText(rawQuery);
  if (!normalized) {
    return [];
  }

  const tokens = tokenizeVoiceText(rawQuery);
  const orderItems = cartItems.map((cartItem) => cartItem.menuItem);
  const directMatch = resolveMenuItemFromVoiceQuery(orderItems, rawQuery);
  if (directMatch) {
    return [directMatch];
  }

  const categoryMatches = orderItems.filter((item) => {
    const normalizedCategory = normalizeVoiceText(item.category);
    if (normalized.includes(normalizedCategory) || normalizedCategory.includes(normalized)) {
      return true;
    }

    return tokens.some((token) => normalizedCategory.includes(token) || token.includes(normalizedCategory));
  });

  return Array.from(new Map(categoryMatches.map((item) => [item.id, item])).values());
}

function extractProtectedItems(transcript: string, cartItems: CartItem[]) {
  const normalized = normalizeVoiceText(transcript);
  const keepMarkers = [
    'pero deja',
    'pero no quites',
    'pero no me quites',
    'menos',
    'excepto',
    'salvo',
  ];

  const marker = keepMarkers.find((candidate) => normalized.includes(candidate));
  if (!marker) {
    return [];
  }

  const clause = normalized.split(marker)[1]?.trim() || '';
  if (!clause) {
    return [];
  }

  return findOrderItemsByCategoryOrName(cartItems, clause);
}

function extractRemoveAllExceptIntent(transcript: string, cartItems: CartItem[]) {
  const normalized = normalizeVoiceText(transcript);
  if (!/\b(quita|quitar|borra|elimina|cancela)\b/.test(normalized) || !/\btodo\b/.test(normalized)) {
    return null;
  }

  const keepItems = extractProtectedItems(transcript, cartItems);
  const keepIds = new Set(keepItems.map((item) => item.id));
  const removableItems = cartItems
    .filter((cartItem) => !keepIds.has(cartItem.menuItem.id))
    .map((cartItem) => ({
      item: cartItem.menuItem,
      quantity: cartItem.quantity,
    }));

  if (removableItems.length === 0) {
    return null;
  }

  return {
    type: 'removeAllExcept' as const,
    items: removableItems,
    keepItems,
  };
}

function parseLocalVoiceIntent(transcript: string, menuItems: MenuItem[], cartItems: CartItem[], hasPendingConfirmation = false): LocalVoiceIntent {
  const normalized = normalizeVoiceText(transcript);

  const wantsConfirm =
    /\b(confirma|confirmar|confirma ya|esta bien|está bien|correcto|eso es todo|ya estaria|ya estaria bien|puedes mandarlo|mandalo|mandalo ya|envialo|enviarlo)\b/.test(
      normalized,
    );

  const wantsPendingConfirmation = hasPendingConfirmation && isExplicitFinalConfirmation(transcript);

  if (wantsConfirm || wantsPendingConfirmation) {
    return { type: 'confirm' };
  }

  const wantsRemove = /\b(quita|quitar|quita una|elimina|borra|cancela|sin)\b/.test(normalized);
  if (wantsRemove) {
    const removeAllExceptIntent = extractRemoveAllExceptIntent(transcript, cartItems);
    if (removeAllExceptIntent) {
      return removeAllExceptIntent;
    }

    const multipleItems = extractMultipleRemoveIntents(transcript, cartItems);
    const protectedItems = extractProtectedItems(transcript, cartItems);
    const protectedIds = new Set(protectedItems.map((item) => item.id));
    const filteredMultipleItems = multipleItems.filter((entry) => !protectedIds.has(entry.item.id));
    if (filteredMultipleItems.length > 1) {
      return { type: 'removeMany', items: filteredMultipleItems };
    }

    const item = resolveMenuItemFromVoiceQuery(
      cartItems.map((cartItem) => cartItem.menuItem),
      transcript,
    );
    if (item && !protectedIds.has(item.id)) {
      return { type: 'remove', item, quantity: Math.max(1, Math.min(12, parseVoiceQuantity(transcript))) };
    }

    return { type: 'unknown' };
  }

  const wantsAdd = /\b(pon|ponme|ponnos|trae|traeme|traenos|anade|añade|dame|danos|quiero|queria|me pones|para mi)\b/.test(normalized);
  if (wantsAdd || menuItems.some((item) => normalized.includes(normalizeVoiceText(item.name)))) {
    const item = resolveMenuItemFromVoiceQuery(menuItems, transcript);
    if (item) {
      return { type: 'add', item, quantity: Math.max(1, Math.min(12, parseVoiceQuantity(transcript))) };
    }
  }

  return { type: 'unknown' };
}

export function useLiveSession({
  branding,
  tableNumber,
  menu,
  createSessionToken,
  onAddToCart,
  onRemoveFromOrder,
  onConfirmOrder,
  onSetDiners,
  cartItems,
  dinersCount,
  clientName,
}: UseLiveSessionProps) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [turnState, setTurnState] = useState<VoiceTurnState>('idle');
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const captureSinkRef = useRef<GainNode | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<{ close: () => void } | null>(null);
  const geminiSessionRef = useRef<{ sendRealtimeInput: (params: Record<string, unknown>) => void; sendToolResponse: (params: Record<string, unknown>) => void; close: () => void } | null>(null);
  const sessionPromiseRef = useRef<Promise<void> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const transcriptRef = useRef('');
  const recordingTimeoutRef = useRef<number | null>(null);
  const shouldStreamAudioRef = useRef(false);
  const pendingPressRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const modelTurnCompleteRef = useRef(false);
  const statusRef = useRef<ConnectionStatus>('disconnected');
  const turnStateRef = useRef<VoiceTurnState>('idle');
  const hasRunDiagnosticsRef = useRef(false);
  const captureTeardownTimeoutRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const playedAudioChunksRef = useRef<Set<string>>(new Set());
  const lastAssistantTextRef = useRef('');
  const lastOutputTranscriptRef = useRef('');
  const pendingEndSessionRef = useRef(false);
  const latestInputTranscriptRef = useRef('');
  const currentTurnHadToolCallRef = useRef(false);
  const currentTurnLocallyHandledRef = useRef(false);
  const currentTurnAddedToOrderRef = useRef(false);
  const currentTurnRemovedFromOrderRef = useRef(false);
  const currentTurnConfirmedOrderRef = useRef(false);
  const currentTurnHadAssistantOutputRef = useRef(false);
  const pendingOrderConfirmationRef = useRef(false);
  const pendingOrderConfirmationSignatureRef = useRef('');
  const pendingAddFallbackRef = useRef<PendingAddFallback | null>(null);
  const lastAssistantOutputSignatureRef = useRef('');

  const cartItemsRef = useRef(cartItems);
  const dinersCountRef = useRef(dinersCount);
  const clientNameRef = useRef(clientName);
  const menuRef = useRef(menu);

  useEffect(() => {
    cartItemsRef.current = cartItems;
    dinersCountRef.current = dinersCount;
    clientNameRef.current = clientName;
    menuRef.current = menu;
  }, [cartItems, clientName, dinersCount, menu]);

  useEffect(() => {
    const currentSignature = buildCartSignature(cartItems);
    if (pendingOrderConfirmationRef.current && pendingOrderConfirmationSignatureRef.current !== currentSignature) {
      pendingOrderConfirmationRef.current = false;
      pendingOrderConfirmationSignatureRef.current = '';
    }
  }, [cartItems]);

  const setStatusSafe = useCallback((nextStatus: ConnectionStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const setTurnStateSafe = useCallback((nextTurnState: VoiceTurnState) => {
    turnStateRef.current = nextTurnState;
    setTurnState(nextTurnState);
  }, []);

  const addLog = useCallback((role: LogMessage['role'], text: string) => {
    setLogs((previousLogs) => [
      ...previousLogs,
      {
        role,
        text,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const clearRecordingTimeout = useCallback(() => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }, []);

  const clearCaptureTeardownTimeout = useCallback(() => {
    if (captureTeardownTimeoutRef.current) {
      window.clearTimeout(captureTeardownTimeoutRef.current);
      captureTeardownTimeoutRef.current = null;
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const resetPendingOrderConfirmation = useCallback(() => {
    pendingOrderConfirmationRef.current = false;
    pendingOrderConfirmationSignatureRef.current = '';
  }, []);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((source) => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    modelTurnCompleteRef.current = false;
    playedAudioChunksRef.current.clear();
  }, []);

  const resetAssistantTurnTracking = useCallback(() => {
    playedAudioChunksRef.current.clear();
    lastAssistantTextRef.current = '';
    lastOutputTranscriptRef.current = '';
    pendingEndSessionRef.current = false;
    latestInputTranscriptRef.current = '';
    currentTurnHadToolCallRef.current = false;
    currentTurnLocallyHandledRef.current = false;
    currentTurnAddedToOrderRef.current = false;
    currentTurnRemovedFromOrderRef.current = false;
    currentTurnConfirmedOrderRef.current = false;
    currentTurnHadAssistantOutputRef.current = false;
    pendingAddFallbackRef.current = null;
    lastAssistantOutputSignatureRef.current = '';
  }, []);

  const cancelLocalSpeech = useCallback(() => {}, []);

  const setPreferredAudioSession = useCallback((type: SupportedAudioSessionType) => {
    if (typeof navigator === 'undefined') {
      return;
    }

    const navigatorWithAudioSession = navigator as Navigator & {
      audioSession?: {
        type?: SupportedAudioSessionType;
      };
    };

    if (!navigatorWithAudioSession.audioSession) {
      return;
    }

    try {
      navigatorWithAudioSession.audioSession.type = type;
    } catch {
      // Safari puede ignorar o bloquear este cambio en algunos estados; es best effort.
    }
  }, []);

  const teardownAudioCapture = useCallback(() => {
    clearCaptureTeardownTimeout();

    if (inputProcessorRef.current) {
      inputProcessorRef.current.disconnect();
      inputProcessorRef.current.onaudioprocess = null;
      inputProcessorRef.current = null;
    }

    if (inputContextRef.current) {
      void inputContextRef.current.close();
      inputContextRef.current = null;
    }

    if (captureSinkRef.current) {
      captureSinkRef.current.disconnect();
      captureSinkRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    shouldStreamAudioRef.current = false;
    setVolumeLevel(0);
  }, [clearCaptureTeardownTimeout]);

  const scheduleAudioCaptureTeardown = useCallback(() => {
    clearCaptureTeardownTimeout();
    captureTeardownTimeoutRef.current = window.setTimeout(() => {
      teardownAudioCapture();
    }, CAPTURE_IDLE_TEARDOWN_MS);
  }, [clearCaptureTeardownTimeout, teardownAudioCapture]);

  const getAudioContextClass = useCallback(() => {
    return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  }, []);

  const resetSession = useCallback(
    (nextStatus: ConnectionStatus) => {
      clearRecordingTimeout();
      clearCaptureTeardownTimeout();
      clearReconnectTimeout();
      shouldStreamAudioRef.current = false;
      pendingPressRef.current = false;
      sessionPromiseRef.current = null;

      const activeSession = sessionRef.current;
      sessionRef.current = null;
      activeSession?.close();
      geminiSessionRef.current = null;

      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
      playbackGainRef.current = null;
      playbackCompressorRef.current = null;
      captureSinkRef.current = null;

      teardownAudioCapture();

      stopPlayback();
      cancelLocalSpeech();
      transcriptRef.current = '';
      hasRunDiagnosticsRef.current = false;
      setLastAssistantMessage('');
      resetAssistantTurnTracking();
      resetPendingOrderConfirmation();
      setVolumeLevel(0);
      setTurnStateSafe(nextStatus === 'error' ? 'error' : 'idle');
      setStatusSafe(nextStatus);
      setPreferredAudioSession('auto');
    },
    [cancelLocalSpeech, clearCaptureTeardownTimeout, clearRecordingTimeout, clearReconnectTimeout, resetAssistantTurnTracking, resetPendingOrderConfirmation, setPreferredAudioSession, setStatusSafe, setTurnStateSafe, stopPlayback, teardownAudioCapture],
  );

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    addLog('system', 'Sesion cerrada.');
    resetSession('disconnected');
  }, [addLog, resetSession]);

  const runVoiceDiagnostics = useCallback(async () => {
    if (hasRunDiagnosticsRef.current) {
      return;
    }

    hasRunDiagnosticsRef.current = true;

    try {
      const diagnostics = await fetchVoiceDiagnostics();
      addLog(diagnostics.tokenCheck.ok ? 'system' : 'error', `Diagnostico token: ${diagnostics.tokenCheck.message}`);
      addLog(diagnostics.liveCheck.ok ? 'system' : 'error', `Diagnostico Live: ${diagnostics.liveCheck.message}`);
    } catch (error) {
      addLog(
        'error',
        error instanceof Error ? `No se ha podido leer el diagnostico: ${error.message}` : 'No se ha podido leer el diagnostico de voz.',
      );
    }
  }, [addLog]);

  const systemInstruction = useMemo(
    () =>
      buildSystemInstruction({
        assistantName: branding.assistantName,
        restaurantName: branding.restaurantName,
        tableNumber,
        clientName,
        dinersCount,
        cartItems,
        menu,
      }),
    [branding.assistantName, branding.restaurantName, cartItems, clientName, dinersCount, menu, tableNumber],
  );

  const getMenuTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'getMenu',
      description: 'Devuelve la carta disponible.',
    }),
    [],
  );

  const setDinersTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'setDiners',
      description: 'Actualiza el numero de comensales y opcionalmente el nombre del cliente.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          count: { type: Type.NUMBER, description: 'Numero de comensales' },
          name: { type: Type.STRING, description: 'Nombre del cliente' },
        },
        required: ['count'],
      },
    }),
    [],
  );

  const addToOrderTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'addToOrder',
      description: 'Anade un plato nuevo al pedido actual usando preferiblemente el menuItemId exacto de la carta.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          menuItemId: { type: Type.STRING, description: 'ID exacto del plato en la carta. Prioritario si se conoce.' },
          itemName: { type: Type.STRING, description: 'Nombre del plato' },
          quantity: { type: Type.NUMBER, description: 'Cantidad solicitada' },
          notes: { type: Type.STRING, description: 'Observaciones' },
        },
        required: ['quantity'],
      },
    }),
    [],
  );

  const removeFromOrderTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'removeFromOrder',
      description: 'Quita una o varias unidades del plato indicado del pedido actual usando preferiblemente el menuItemId exacto del pedido.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          menuItemId: { type: Type.STRING, description: 'ID exacto del plato en el pedido actual. Prioritario si se conoce.' },
          itemName: { type: Type.STRING, description: 'Nombre del plato a corregir' },
          quantity: { type: Type.NUMBER, description: 'Numero de unidades a quitar. Si no se indica, quita 1.' },
        },
        required: [],
      },
    }),
    [],
  );

  const getCurrentOrderTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'getCurrentOrder',
      description: 'Devuelve el pedido actual resumido para comprobar que platos hay antes de quitar, corregir o confirmar.',
    }),
    [],
  );

  const confirmOrderTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'confirmOrder',
      description: 'Confirma el pedido y lo envia a cocina.',
    }),
    [],
  );

  const endSessionTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'endSession',
      description: 'Cierra la sesion cuando la conversacion haya terminado.',
    }),
    [],
  );

  const geminiTools = useMemo(
    () => [
      {
        functionDeclarations: [getMenuTool, getCurrentOrderTool, setDinersTool, addToOrderTool, removeFromOrderTool, confirmOrderTool, endSessionTool],
      },
    ],
    [addToOrderTool, confirmOrderTool, endSessionTool, getCurrentOrderTool, getMenuTool, removeFromOrderTool, setDinersTool],
  );

  const runTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      let result: ToolResult = { success: true };

      if (name === 'getMenu') {
        result = { success: true, count: menuRef.current.length, message: 'La carta ya esta en contexto.' };
      } else if (name === 'getCurrentOrder') {
        result = {
          success: true,
          count: cartItemsRef.current.length,
          message: summarizeCartItems(cartItemsRef.current),
        };
      } else if (name === 'setDiners') {
        const count = Number(args.count ?? 1);
        const nextName = typeof args.name === 'string' ? args.name : undefined;
        onSetDiners(count, nextName);
        resetPendingOrderConfirmation();
        addLog('system', `Mesa actualizada a ${count} comensales.`);
        result = { success: true, message: `${count} comensales actualizados.` };
      } else if (name === 'addToOrder') {
        const itemName = typeof args.itemName === 'string' ? args.itemName : typeof args.menuItemId === 'string' ? args.menuItemId : '';
        const quantity = Math.max(1, Math.min(12, Number(args.quantity ?? 1) || 1));
        const notes = typeof args.notes === 'string' ? args.notes : undefined;
        const item = findMenuItem(menuRef.current, args);
        pendingAddFallbackRef.current = {
          itemName: typeof args.itemName === 'string' ? args.itemName : undefined,
          menuItemId: typeof args.menuItemId === 'string' ? args.menuItemId : undefined,
          quantity,
          notes,
        };

        if (!item) {
          result = { success: false, error: `No he podido identificar el plato "${itemName}" en la carta actual.` };
          addLog('error', result.error);
        } else {
          onAddToCart(item, quantity, notes);
          resetPendingOrderConfirmation();
          currentTurnAddedToOrderRef.current = true;
          pendingAddFallbackRef.current = null;
          addLog('system', `Anadido ${quantity}x ${item.name}.`);
          result = {
            success: true,
            message: `${quantity}x ${item.name} anadidos correctamente.${notes ? ` Observaciones: ${notes}.` : ''} Pedido actual: ${summarizeCartItems([
              ...cartItemsRef.current,
              {
                id: 'preview',
                menuItem: item,
                quantity,
                notes,
                timestamp: new Date().toISOString(),
              },
            ])}`,
          };
        }
      } else if (name === 'removeFromOrder') {
        const itemName = typeof args.itemName === 'string' ? args.itemName : typeof args.menuItemId === 'string' ? args.menuItemId : '';
        const quantity = Math.max(1, Math.min(12, Number(args.quantity ?? 1) || 1));
        const item = findMenuItem(
          cartItemsRef.current.map((cartItem) => cartItem.menuItem),
          args,
        );

        if (!item) {
          result = { success: false, error: `No he encontrado "${itemName}" dentro del pedido actual.` };
          addLog('error', result.error);
        } else {
          onRemoveFromOrder(item.name, quantity);
          resetPendingOrderConfirmation();
          currentTurnRemovedFromOrderRef.current = true;
          addLog('system', `Corregido el pedido de ${item.name}: quitadas ${quantity} unidades.`);
          const remainingCart = [...cartItemsRef.current];
          const targetIndex = remainingCart.findIndex((cartItem) => cartItem.menuItem.id === item.id);
          if (targetIndex >= 0) {
            const target = remainingCart[targetIndex];
            const nextQuantity = target.quantity - quantity;
            if (nextQuantity <= 0) {
              remainingCart.splice(targetIndex, 1);
            } else {
              remainingCart[targetIndex] = { ...target, quantity: nextQuantity };
            }
          }

          result = {
            success: true,
            message: `Se han quitado ${quantity} unidades de ${item.name} del pedido actual. Pedido actual: ${summarizeCartItems(remainingCart)}`,
          };
        }
      } else if (name === 'confirmOrder') {
        if (cartItemsRef.current.length === 0) {
          resetPendingOrderConfirmation();
          result = { success: false, error: 'No puedes confirmar un pedido vacio.' };
          addLog('error', result.error);
          return result;
        }

        const currentCartSignature = buildCartSignature(cartItemsRef.current);
        if (!pendingOrderConfirmationRef.current || pendingOrderConfirmationSignatureRef.current !== currentCartSignature) {
          pendingOrderConfirmationRef.current = true;
          pendingOrderConfirmationSignatureRef.current = currentCartSignature;
          result = {
            success: false,
            error: `${buildOrderConfirmationPrompt(cartItemsRef.current)} No lo envies todavia: primero pide confirmacion explicita al cliente.`,
          };
          addLog('system', 'Confirmacion bloqueada: falta confirmacion final del cliente.');
          return result;
        }

        const success = await onConfirmOrder(dinersCountRef.current, clientNameRef.current, cartItemsRef.current);
        resetPendingOrderConfirmation();
        currentTurnConfirmedOrderRef.current = success;
        result = success
          ? {
              success: true,
              message: `Pedido confirmado y enviado con ${cartItemsRef.current.length} lineas.`,
            }
          : { success: false, error: 'No se pudo confirmar el pedido.' };
        addLog(success ? 'system' : 'error', success ? 'Pedido confirmado desde voz.' : 'La confirmacion por voz ha fallado.');
      } else if (name === 'endSession') {
        result = { success: true, message: 'Sesion cerrada.' };
        pendingEndSessionRef.current = true;
      }

      return result;
    },
    [addLog, disconnect, onAddToCart, onConfirmOrder, onRemoveFromOrder, onSetDiners, resetPendingOrderConfirmation],
  );

  const ensureAudioPipeline = useCallback(async () => {
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) {
      throw new Error('Este navegador no soporta audio en tiempo real.');
    }

    if (!audioContextRef.current || audioContextRef.current.state === 'closed' || !playbackGainRef.current) {
      const playbackContext = new AudioContextClass({ sampleRate: 24_000 });
      audioContextRef.current = playbackContext;

      const playbackGain = playbackContext.createGain();
      playbackGain.gain.value = PLAYBACK_GAIN;
      const playbackCompressor = playbackContext.createDynamicsCompressor();
      playbackCompressor.threshold.value = -18;
      playbackCompressor.knee.value = 10;
      playbackCompressor.ratio.value = 3;
      playbackCompressor.attack.value = 0.008;
      playbackCompressor.release.value = 0.08;
      playbackGain.connect(playbackCompressor);
      playbackCompressor.connect(playbackContext.destination);
      playbackGainRef.current = playbackGain;
      playbackCompressorRef.current = playbackCompressor;
      await playbackContext.resume();
    }

    if (mediaStreamRef.current && inputProcessorRef.current && inputContextRef.current?.state !== 'closed') {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const captureContext = new AudioContextClass({ sampleRate: 16_000 });
    inputContextRef.current = captureContext;

    const source = captureContext.createMediaStreamSource(stream);
    const processor = captureContext.createScriptProcessor(4096, 1, 1);
    const silentSink = captureContext.createGain();
    silentSink.gain.value = 0;
    captureSinkRef.current = silentSink;
    inputProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      let energy = 0;

      for (let index = 0; index < inputData.length; index += 1) {
        energy += inputData[index] * inputData[index];
      }

      const nextVolume = Math.sqrt(energy / inputData.length);
      setVolumeLevel(shouldStreamAudioRef.current ? nextVolume : 0);

      if (!shouldStreamAudioRef.current || !geminiSessionRef.current) {
        return;
      }

      geminiSessionRef.current.sendRealtimeInput({
        audio: createPcmBlob(inputData),
      });
    };

    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(captureContext.destination);

    await captureContext.resume();
  }, [getAudioContextClass]);

  const finalizeTurnIfReady = useCallback(() => {
    if (sourcesRef.current.size > 0) {
      return;
    }

    if (turnStateRef.current !== 'recording') {
      setTurnStateSafe('idle');
      setVolumeLevel(0);
      scheduleAudioCaptureTeardown();
      if (pendingEndSessionRef.current) {
        pendingEndSessionRef.current = false;
        disconnect();
      }
    }
  }, [disconnect, scheduleAudioCaptureTeardown, setTurnStateSafe]);

  const tryHandlePendingAddFallback = useCallback(() => {
    if (currentTurnAddedToOrderRef.current || !pendingAddFallbackRef.current) {
      return false;
    }

    const fallbackArgs = pendingAddFallbackRef.current;
    const fallbackItem = findMenuItem(menuRef.current, {
      menuItemId: fallbackArgs.menuItemId,
      itemName: fallbackArgs.itemName,
    });

    if (!fallbackItem) {
      return false;
    }

    currentTurnLocallyHandledRef.current = true;
    currentTurnAddedToOrderRef.current = true;
    pendingAddFallbackRef.current = null;
    onAddToCart(fallbackItem, fallbackArgs.quantity, fallbackArgs.notes);
    resetPendingOrderConfirmation();
    addLog('system', `Fallback silencioso desde tool call: anadido ${fallbackArgs.quantity}x ${fallbackItem.name}.`);
    finalizeTurnIfReady();
    return true;
  }, [addLog, finalizeTurnIfReady, onAddToCart, resetPendingOrderConfirmation]);

  const tryHandleLocalIntent = useCallback(async () => {
    const transcript = latestInputTranscriptRef.current.trim();
    if (!transcript || currentTurnLocallyHandledRef.current) {
      return false;
    }

    const intent = parseLocalVoiceIntent(transcript, menuRef.current, cartItemsRef.current, pendingOrderConfirmationRef.current);
    if (intent.type === 'unknown') {
      return false;
    }

    if (intent.type === 'add') {
      if (currentTurnAddedToOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      onAddToCart(intent.item, intent.quantity);
      resetPendingOrderConfirmation();
      currentTurnAddedToOrderRef.current = true;
      addLog('system', `Fallback local silencioso: anadido ${intent.quantity}x ${intent.item.name}.`);
      finalizeTurnIfReady();
      return true;
    }

    if (intent.type === 'remove') {
      if (currentTurnRemovedFromOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      onRemoveFromOrder(intent.item.name, intent.quantity);
      resetPendingOrderConfirmation();
      currentTurnRemovedFromOrderRef.current = true;
      addLog('system', `Fallback local silencioso: quitadas ${intent.quantity} unidades de ${intent.item.name}.`);
      finalizeTurnIfReady();
      return true;
    }

    if (intent.type === 'removeMany') {
      if (currentTurnRemovedFromOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      intent.items.forEach((entry) => {
        onRemoveFromOrder(entry.item.name, entry.quantity);
      });
      resetPendingOrderConfirmation();
      currentTurnRemovedFromOrderRef.current = true;
      addLog(
        'system',
        `Fallback local silencioso: quitados ${intent.items.map((entry) => `${entry.quantity}x ${entry.item.name}`).join(', ')}.`,
      );
      finalizeTurnIfReady();
      return true;
    }

    if (intent.type === 'removeAllExcept') {
      if (currentTurnRemovedFromOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      intent.items.forEach((entry) => {
        onRemoveFromOrder(entry.item.name, entry.quantity);
      });
      resetPendingOrderConfirmation();
      currentTurnRemovedFromOrderRef.current = true;
      addLog(
        'system',
        `Fallback local silencioso: quitado todo excepto ${intent.keepItems.length > 0 ? intent.keepItems.map((item) => item.name).join(', ') : 'nada'}.`,
      );
      finalizeTurnIfReady();
      return true;
    }

    return false;
  }, [addLog, finalizeTurnIfReady, onAddToCart, onRemoveFromOrder, resetPendingOrderConfirmation]);

  const cancelCurrentResponse = useCallback(() => {
    stopPlayback();
    if (turnStateRef.current === 'speaking' || turnStateRef.current === 'processing') {
      setTurnStateSafe('idle');
    }
  }, [setTurnStateSafe, stopPlayback]);

  const startRecordingInternal = useCallback(() => {
    if (!geminiSessionRef.current || !inputProcessorRef.current) {
      return;
    }

    if (isSafariBrowser()) {
      setPreferredAudioSession('play-and-record');
    }

    clearRecordingTimeout();
    pendingPressRef.current = true;
    cancelCurrentResponse();
    cancelLocalSpeech();
    resetAssistantTurnTracking();
    geminiSessionRef.current.sendRealtimeInput({ activityStart: {} });
    shouldStreamAudioRef.current = true;
    transcriptRef.current = '';
    modelTurnCompleteRef.current = false;
    setTurnStateSafe('recording');
    addLog('system', 'Grabando audio...');

    recordingTimeoutRef.current = window.setTimeout(() => {
      if (pendingPressRef.current) {
        pendingPressRef.current = false;
        shouldStreamAudioRef.current = false;
        geminiSessionRef.current?.sendRealtimeInput({ activityEnd: {} });
        if (isSafariBrowser()) {
          setPreferredAudioSession('playback');
        }
        if (isMobileBrowser()) {
          window.setTimeout(() => {
            if (turnStateRef.current !== 'recording') {
              teardownAudioCapture();
            }
          }, SAFARI_CAPTURE_RELEASE_MS);
        }
        setTurnStateSafe('processing');
        addLog('system', 'Audio enviado por limite de tiempo.');
      }
    }, MAX_RECORDING_MS);
  }, [addLog, cancelCurrentResponse, cancelLocalSpeech, clearRecordingTimeout, resetAssistantTurnTracking, setPreferredAudioSession, setTurnStateSafe, teardownAudioCapture]);

  const ensureGeminiSession = useCallback(async () => {
    if (statusRef.current === 'connected' && geminiSessionRef.current) {
      await ensureAudioPipeline();
      return;
    }

    if (sessionPromiseRef.current) {
      await sessionPromiseRef.current;
      return;
    }

    sessionPromiseRef.current = (async () => {
      manualDisconnectRef.current = false;
      setStatusSafe('connecting');
      setTurnStateSafe('idle');
      addLog('system', `Iniciando a ${branding.assistantName}...`);
      addLog('system', `Voice client build: ${VOICE_CLIENT_BUILD}`);

      const token = await createSessionToken();
      if (token.provider !== 'gemini') {
        throw new Error('El modo push-to-talk solo esta habilitado para Gemini en esta version.');
      }

      await ensureAudioPipeline();

      const ai = new GoogleGenAI({
        apiKey: (token as GeminiSessionTokenResponse).token,
        httpOptions: {
          apiVersion: token.apiVersion,
        },
      });

      const session = await ai.live.connect({
        model: token.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          tools: geminiTools,
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: true,
            },
            activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck',
              },
            },
          },
        },
        callbacks: {
          onopen: () => {
            reconnectAttemptsRef.current = 0;
            clearReconnectTimeout();
            addLog('system', `Sesion de voz abierta con ${branding.assistantName} por Gemini.`);
            setStatusSafe('connected');
            if (isSafariBrowser()) {
              setPreferredAudioSession('playback');
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            const textParts = message.serverContent?.modelTurn?.parts
              ?.map((part) => ('text' in part ? part.text : undefined))
              .filter((part): part is string => Boolean(part));

            if (textParts && textParts.length > 0) {
              const assistantText = textParts.join(' ').trim();
              const assistantSignature = normalizeVoiceText(assistantText);
              if (assistantText && assistantSignature && assistantSignature !== lastAssistantOutputSignatureRef.current) {
                lastAssistantOutputSignatureRef.current = assistantSignature;
                lastAssistantTextRef.current = assistantText;
                lastOutputTranscriptRef.current = assistantText;
                currentTurnHadAssistantOutputRef.current = true;
                setLastAssistantMessage(assistantText);
                addLog('assistant', assistantText);
              }
            }

            const inputTranscript = message.serverContent?.inputTranscription?.text?.trim();
            if (inputTranscript) {
              latestInputTranscriptRef.current = inputTranscript;
              addLog('system', `Tu voz: ${inputTranscript}`);
            }

            const outputTranscript = message.serverContent?.outputTranscription?.text?.trim();
            const outputSignature = outputTranscript ? normalizeVoiceText(outputTranscript) : '';
            if (outputTranscript && outputSignature && outputSignature !== lastAssistantOutputSignatureRef.current) {
              lastAssistantOutputSignatureRef.current = outputSignature;
              lastOutputTranscriptRef.current = outputTranscript;
              lastAssistantTextRef.current = outputTranscript;
              currentTurnHadAssistantOutputRef.current = true;
              setLastAssistantMessage(outputTranscript);
              addLog('assistant', outputTranscript);
            }

            if (message.toolCall) {
              currentTurnHadToolCallRef.current = true;
              const responses = [];

              for (const functionCall of message.toolCall.functionCalls) {
                const result = await runTool(functionCall.name, (functionCall.args as Record<string, unknown>) ?? {});
                responses.push({
                  id: functionCall.id,
                  name: functionCall.name,
                  response: { result },
                });
              }

              geminiSessionRef.current?.sendToolResponse({ functionResponses: responses });
            }

            const audioParts = message.serverContent?.modelTurn?.parts?.filter(
              (part): part is typeof part & { inlineData: { data: string } } => 'inlineData' in part && Boolean(part.inlineData?.data),
            );
            if (audioParts && audioParts.length > 0 && audioContextRef.current) {
              currentTurnHadAssistantOutputRef.current = true;
              if (isSafariBrowser()) {
                setPreferredAudioSession('playback');
              }

              const audioContext = audioContextRef.current;
              if (audioContext.state === 'suspended') {
                await audioContext.resume();
              }

              for (const part of audioParts) {
                const base64Audio = part.inlineData.data;
                if (playedAudioChunksRef.current.has(base64Audio)) {
                  continue;
                }

                playedAudioChunksRef.current.add(base64Audio);
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);

                const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), audioContext, 24_000);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(playbackGainRef.current ?? audioContext.destination);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                setTurnStateSafe('speaking');

                sourcesRef.current.add(source);
                source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (modelTurnCompleteRef.current) {
                    finalizeTurnIfReady();
                  }
                };
              }
            }

            if (message.serverContent?.interrupted) {
              stopPlayback();
              cancelLocalSpeech();
              resetAssistantTurnTracking();
              addLog('system', 'Respuesta interrumpida para escuchar una nueva instruccion.');
            }

            if (message.serverContent?.turnComplete) {
              modelTurnCompleteRef.current = true;
              const handledLocally = tryHandlePendingAddFallback() || (await tryHandleLocalIntent());
              if (!handledLocally) {
                finalizeTurnIfReady();
              }
            }
          },
          onclose: (event) => {
            const code = typeof event?.code === 'number' ? ` Codigo: ${event.code}.` : '';
            const reason = typeof event?.reason === 'string' && event.reason.trim() ? ` Motivo: ${event.reason}.` : '';
            addLog('system', `La conexion de voz de Gemini se ha cerrado.${code}${reason}`);

            if (!manualDisconnectRef.current) {
              void runVoiceDiagnostics();
              resetSession('error');
            } else {
              resetSession('disconnected');
            }
          },
          onerror: (error) => {
            addLog('error', error.message || 'Se ha producido un error en la sesion de Gemini.');
            void runVoiceDiagnostics();
            resetSession('error');
          },
        },
      });

      addLog(
        'system',
        `Gemini connect config cargada: ${JSON.stringify({
          responseModalities: ['AUDIO'],
          automaticActivityDetectionDisabled: true,
          activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
          hasInputAudioTranscription: true,
          hasOutputAudioTranscription: true,
          explicitVadSignal: false,
        })}`,
      );

      geminiSessionRef.current = session as typeof geminiSessionRef.current;
      sessionRef.current = {
        close: () => {
          session.close();
        },
      };
    })();

    try {
      await sessionPromiseRef.current;
    } finally {
      sessionPromiseRef.current = null;
    }
  }, [
    addLog,
    branding.assistantName,
    branding.showDebugTools,
    createSessionToken,
    ensureAudioPipeline,
    finalizeTurnIfReady,
    geminiTools,
    runTool,
    runVoiceDiagnostics,
    clearReconnectTimeout,
    resetSession,
    setPreferredAudioSession,
    setStatusSafe,
    setTurnStateSafe,
    stopPlayback,
    systemInstruction,
  ]);

  const beginPressToTalk = useCallback(async () => {
    if (!branding.voiceEnabled) {
      addLog('error', 'La voz no esta disponible en este entorno. Puedes seguir usando la carta manual.');
      setStatusSafe('error');
      setTurnStateSafe('error');
      return;
    }

    pendingPressRef.current = true;
    clearCaptureTeardownTimeout();

    try {
      if (isSafariBrowser()) {
        setPreferredAudioSession('play-and-record');
      }
      await ensureGeminiSession();
      await ensureAudioPipeline();
      if (!pendingPressRef.current) {
        return;
      }

      startRecordingInternal();
    } catch (connectionError) {
      const message = connectionError instanceof Error ? connectionError.message : 'No se pudo iniciar la sesion de voz.';
      addLog('error', message);
      void runVoiceDiagnostics();
      setStatusSafe('error');
      setTurnStateSafe('error');
    }
  }, [addLog, branding.voiceEnabled, clearCaptureTeardownTimeout, ensureGeminiSession, runVoiceDiagnostics, setPreferredAudioSession, setStatusSafe, setTurnStateSafe, startRecordingInternal]);

  const endPressToTalk = useCallback(() => {
    pendingPressRef.current = false;

    if (turnStateRef.current !== 'recording' || !geminiSessionRef.current) {
      return;
    }

    clearRecordingTimeout();
    shouldStreamAudioRef.current = false;
    geminiSessionRef.current.sendRealtimeInput({ activityEnd: {} });
    if (isSafariBrowser()) {
      setPreferredAudioSession('playback');
    }
    if (isMobileBrowser()) {
      window.setTimeout(() => {
        if (turnStateRef.current !== 'recording') {
          teardownAudioCapture();
        }
      }, SAFARI_CAPTURE_RELEASE_MS);
    }
    setTurnStateSafe('processing');
    setVolumeLevel(0);
    addLog('system', 'Audio enviado a Ramiro.');
  }, [addLog, clearRecordingTimeout, setPreferredAudioSession, setTurnStateSafe, teardownAudioCapture]);

  useEffect(() => {
    if (
      status !== 'error' ||
      manualDisconnectRef.current ||
      !branding.voiceEnabled ||
      reconnectAttemptsRef.current >= MAX_AUTO_RECONNECT_ATTEMPTS
    ) {
      return;
    }

    clearReconnectTimeout();
    reconnectAttemptsRef.current += 1;
    const attempt = reconnectAttemptsRef.current;

    reconnectTimeoutRef.current = window.setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      addLog('system', `Reintentando recuperar la voz (${attempt}/${MAX_AUTO_RECONNECT_ATTEMPTS})...`);
      void ensureGeminiSession().catch((error) => {
        addLog('error', error instanceof Error ? error.message : 'No se pudo recuperar la sesion de voz.');
      });
    }, AUTO_RECONNECT_DELAY_MS);

    return () => {
      clearReconnectTimeout();
    };
  }, [addLog, branding.voiceEnabled, clearReconnectTimeout, ensureGeminiSession, status]);

  useEffect(() => () => resetSession('disconnected'), [resetSession]);

  return {
    status,
    turnState,
    beginPressToTalk,
    endPressToTalk,
    cancelCurrentResponse,
    disconnect,
    volumeLevel,
    logs,
    lastAssistantMessage,
  };
}
