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
import { fetchVoiceDiagnostics, synthesizeKitchenAnnouncementOnApi as synthesizeVoiceFallbackOnApi } from '../utils/api';
import { base64ToUint8Array, createPcmBlob, decodeAudioData } from '../utils/audio';
import { buildCartSignature, summarizeCartItems, type RemoveCartUnitsBatchResult, type RemoveCartUnitsTarget } from '../utils/cartState';
import { resolveMenuItemMatch } from '../utils/voiceMatching';

interface UseLiveSessionProps {
  branding: AppBranding;
  tableNumber: string;
  menu: MenuItem[];
  createSessionToken: () => Promise<SessionTokenResponse>;
  onAddToCart: (item: MenuItem, quantity: number, notes?: string) => CartItem[];
  onRemoveFromOrder: (menuItemId: string, quantity?: number, itemName?: string, notes?: string) => {
    items: CartItem[];
    removedQuantity: number;
    matched: boolean;
    requiresClarification?: boolean;
    matchingLines?: CartItem[];
  };
  onRemoveManyFromOrder: (targets: RemoveCartUnitsTarget[]) => RemoveCartUnitsBatchResult;
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
  confirmationPending?: boolean;
}

function stableToolArgs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableToolArgs);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, stableToolArgs(nestedValue)]),
    );
  }

  return value;
}

export function buildToolCallSignature(name: string, args: Record<string, unknown>) {
  return JSON.stringify({
    name,
    args: stableToolArgs(args),
  });
}

function buildTurnAddKey(menuItemId: string, notes?: string) {
  return `${menuItemId}:${normalizeVoiceText(notes ?? '')}`;
}

const MAX_RECORDING_MS = 120_000;
const VOICE_CLIENT_BUILD = 'ptt-v2-no-explicit-vad';
const DEFAULT_PLAYBACK_GAIN = 2.15;
const APPLE_MOBILE_PLAYBACK_GAIN = 2.8;
const ANDROID_CHROME_PLAYBACK_GAIN = 2.35;
const CAPTURE_IDLE_TEARDOWN_MS = 12_000;
const SAFARI_CAPTURE_RELEASE_MS = 180;
const AUTO_RECONNECT_DELAY_MS = 1_500;
const MAX_AUTO_RECONNECT_ATTEMPTS = 2;
const TURN_RECOVERY_PROCESSING_TIMEOUT_MS = 12_000;
const TURN_RECOVERY_SPEAKING_TIMEOUT_MS = 18_000;
const TURN_RECOVERY_LOCAL_SPEECH_TIMEOUT_MS = 22_000;
const TURN_RECOVERY_AUDIO_GRACE_MS = 2_500;
const FAST_LOCAL_INTENT_DELAY_MS = 650;
const LOCAL_FALLBACK_SPEECH_DELAY_MS = 120;
const ASSISTANT_TRANSCRIPT_SPEECH_DELAY_MS = 1_400;

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

const VOICE_QUANTITY_WORDS = new Set([
  'un',
  'uno',
  'una',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
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

function dedupeMenuItems(items: MenuItem[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function resolveBestMenuItemMatch(items: MenuItem[], rawQuery: string, menuItemId?: string) {
  const uniqueItems = dedupeMenuItems(items);
  const initialMatch = resolveMenuItemMatch(uniqueItems, rawQuery, menuItemId);

  if (initialMatch.item) {
    return initialMatch;
  }

  const strippedQuery = stripVoiceNotes(rawQuery);
  if (strippedQuery && strippedQuery !== rawQuery.trim()) {
    const strippedMatch = resolveMenuItemMatch(uniqueItems, strippedQuery, menuItemId);
    if (strippedMatch.item) {
      return strippedMatch;
    }

    if (strippedMatch.confidence > initialMatch.confidence) {
      return strippedMatch;
    }
  }

  const cleanedQuery = buildSimplifiedVoiceQuery(rawQuery);
  if (!cleanedQuery || cleanedQuery === normalizeVoiceText(stripVoiceNotes(rawQuery))) {
    return initialMatch;
  }

  const cleanedMatch = resolveMenuItemMatch(uniqueItems, cleanedQuery, menuItemId);
  if (cleanedMatch.item) {
    return cleanedMatch;
  }

  return cleanedMatch.confidence > initialMatch.confidence ? cleanedMatch : initialMatch;
}

function resolveMenuItemFromVoiceQuery(items: MenuItem[], rawQuery: string) {
  const match = resolveBestMenuItemMatch(items, rawQuery);
  if (!match.requiresClarification) {
    return match.item;
  }

  const simplifiedQuery = buildSimplifiedVoiceQuery(rawQuery);
  if (!simplifiedQuery) {
    return null;
  }

  const simplifiedMatch = resolveMenuItemMatch(dedupeMenuItems(items), simplifiedQuery);
  return simplifiedMatch.requiresClarification ? null : simplifiedMatch.item;
}

function transcriptMentionsMenuItem(rawTranscript: string, items: MenuItem[]) {
  const normalizedTranscript = normalizeVoiceText(rawTranscript);
  if (!normalizedTranscript) {
    return false;
  }

  return items.some((item) => {
    const candidates = [item.name, ...(item.voiceAliases ?? [])]
      .map((value) => normalizeVoiceText(value))
      .filter(Boolean);

    return candidates.some(
      (candidate) =>
        normalizedTranscript.includes(candidate) ||
        candidate.includes(normalizedTranscript) ||
        candidate.split(' ').some((token) => token.length > 2 && normalizedTranscript.includes(token)),
    );
  });
}

function findMenuItemMatch(items: MenuItem[], args: Record<string, unknown>, nameKey: 'itemName' | 'menuItemId' = 'itemName') {
  const menuItemId = typeof args.menuItemId === 'string' ? args.menuItemId.trim() : '';
  const rawName = typeof args[nameKey] === 'string' ? args[nameKey] : '';
  return resolveBestMenuItemMatch(items, rawName, menuItemId);
}

function findMenuItem(items: MenuItem[], args: Record<string, unknown>, nameKey: 'itemName' | 'menuItemId' = 'itemName') {
  return findMenuItemMatch(items, args, nameKey).item;
}

function buildOrderConfirmationPrompt(items: CartItem[]) {
  if (items.length === 0) {
    return 'No veo ningún plato en el pedido todavía.';
  }

  return `Resumen del pedido: ${summarizeCartItems(items)}. Si está todo correcto, di confirmar pedido para enviarlo a cocina.`;
}

function buildRemoveClarificationMessage(itemName: string, matchingLines: CartItem[]) {
  const variants = matchingLines
    .map((line) => `${line.quantity}x ${line.menuItem.name}${line.notes ? ` (${line.notes})` : ''}`)
    .join(', ');

  return `Tengo varias líneas para ${itemName}: ${variants}. Dime cuál quieres quitar exactamente.`;
}

function isExplicitFinalConfirmation(transcript: string) {
  const normalized = normalizeVoiceText(transcript);
  return /\b(si|sí|confirmo|confirmar|confirmar pedido|correcto|perfecto|adelante|vale|ok|de acuerdo|envialo|mandalo)\b/.test(normalized);
}

function assistantTextClaimsMutation(text: string) {
  const normalized = normalizeVoiceText(text);
  return /\b(anadid|agregad|quitad|eliminad|borrad|actualizad|confirmad|enviad|hecho|listo)\b/.test(normalized);
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

function isAndroidBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /android/i.test(navigator.userAgent);
}

function isAppleMobileBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isChromeLikeBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /chrome|chromium|crios|edg|edgios/i.test(navigator.userAgent) && !/opr\//i.test(navigator.userAgent);
}

function isAndroidChromeBrowser() {
  return isAndroidBrowser() && isChromeLikeBrowser();
}

function isSafariBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent;
  return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edgios|opr\//i.test(userAgent);
}

function shouldKeepCaptureWarm() {
  return isMobileBrowser() || isSafariBrowser();
}

function shouldReleaseCaptureAfterTurn() {
  return isAppleMobileBrowser() || isSafariBrowser();
}

function isLocalhost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function assertMicrophoneRuntimeAvailable() {
  if (typeof window !== 'undefined' && window.isSecureContext === false && !isLocalhost(window.location.hostname)) {
    throw new Error(
      'Chrome en Android bloquea el micrófono si la web se abre por HTTP desde una IP local. Abre la app con HTTPS o desde el dominio publicado.',
    );
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este dispositivo no permite acceder al micrófono.');
  }
}

function getMicrophoneConstraints(): MediaStreamConstraints {
  return {
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
    },
  };
}

function hasLiveAudioTrack(stream: MediaStream | null) {
  return Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live'));
}

function getPlaybackTuning() {
  if (isAppleMobileBrowser()) {
    return {
      gain: APPLE_MOBILE_PLAYBACK_GAIN,
      compressor: {
        threshold: -24,
        knee: 18,
        ratio: 10,
        attack: 0.003,
        release: 0.22,
      },
    };
  }

  if (isAndroidChromeBrowser()) {
    return {
      gain: ANDROID_CHROME_PLAYBACK_GAIN,
      compressor: {
        threshold: -20,
        knee: 12,
        ratio: 4,
        attack: 0.006,
        release: 0.1,
      },
    };
  }

  return {
    gain: DEFAULT_PLAYBACK_GAIN,
    compressor: {
      threshold: -18,
      knee: 10,
      ratio: 3,
      attack: 0.008,
      release: 0.08,
    },
  };
}

type SupportedAudioSessionType = 'auto' | 'playback' | 'play-and-record';

type LocalVoiceIntent =
  | { type: 'add'; item: MenuItem; quantity: number; notes?: string }
  | { type: 'addMany'; items: Array<{ item: MenuItem; quantity: number; notes?: string }> }
  | { type: 'remove'; item: MenuItem; quantity: number; notes?: string }
  | { type: 'removeMany'; items: Array<{ item: MenuItem; quantity: number; notes?: string }> }
  | { type: 'removeAllExcept'; items: Array<{ item: MenuItem; quantity: number; notes?: string }>; keepItems: MenuItem[] }
  | { type: 'confirm' }
  | { type: 'unknown' };

interface PendingAddFallback {
  itemName?: string;
  menuItemId?: string;
  quantity: number;
  notes?: string;
}

function normalizeVoiceNote(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[,.]+$/g, '')
    .trim();
}

function getVoiceNotePatterns() {
  return [
    /\bpara compartir\b/gi,
    /\bsin [a-z0-9]+(?: [a-z0-9]+){0,1}\b/gi,
    /\bcon [a-z0-9]+(?: [a-z0-9]+){0,2} aparte\b/gi,
    /\b[a-z0-9]+ aparte\b/gi,
    /\b(?:muy hecho|bien hecho|poco hecho|al punto)\b/gi,
    /\b(?:sin|con) hielo\b/gi,
    /\b(?:sin|con) picante\b/gi,
    /\bextra de [a-z0-9]+(?: [a-z0-9]+){0,2}\b/gi,
  ];
}

export function extractVoiceNotes(rawText: string) {
  const matches: string[] = [];
  const segments = rawText
    .split(/\s*(?:,| y | e | pero )\s*/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    for (const pattern of getVoiceNotePatterns()) {
      for (const match of segment.matchAll(pattern)) {
        const value = normalizeVoiceNote(match[0] ?? '');
        if (value && !matches.includes(value)) {
          matches.push(value);
        }
      }
    }
  }

  return matches.length > 0 ? matches.join(', ') : undefined;
}

function stripVoiceNotes(rawText: string) {
  let cleanedText = rawText;

  for (const pattern of getVoiceNotePatterns()) {
    cleanedText = cleanedText.replace(pattern, ' ');
  }

  return cleanedText.replace(/\s+/g, ' ').trim();
}

function buildSimplifiedVoiceQuery(rawText: string) {
  return tokenizeVoiceText(stripVoiceNotes(rawText))
    .filter((token) => !VOICE_QUANTITY_WORDS.has(token) && !/^\d+$/.test(token))
    .join(' ');
}

interface TurnRecoveryTimeoutOptions {
  reason: string;
  queuedAudioMs: number;
  hasLocalSpeech: boolean;
}

export function getTurnRecoveryTimeoutMs({
  reason,
  queuedAudioMs,
  hasLocalSpeech,
}: TurnRecoveryTimeoutOptions) {
  if (reason === 'espera de respuesta') {
    return TURN_RECOVERY_PROCESSING_TIMEOUT_MS;
  }

  const playbackWindowMs = Math.max(0, Math.ceil(queuedAudioMs + TURN_RECOVERY_AUDIO_GRACE_MS));
  const localSpeechWindowMs = hasLocalSpeech ? TURN_RECOVERY_LOCAL_SPEECH_TIMEOUT_MS : 0;

  return Math.max(TURN_RECOVERY_SPEAKING_TIMEOUT_MS, playbackWindowMs, localSpeechWindowMs);
}

function extractMultipleAddIntents(transcript: string, menuItems: MenuItem[]) {
  const normalized = normalizeVoiceText(transcript);
  if (
    !/\b(pon|ponme|ponnos|trae|traeme|traenos|anade|dame|danos|quiero|queria|me pones|para mi)\b/.test(normalized) &&
    !transcriptMentionsMenuItem(transcript, menuItems)
  ) {
    return [];
  }

  const segments = normalized
    .split(/\s*(?:,| y | e | luego | despues | tambien )\s*/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const merged = new Map<string, { item: MenuItem; quantity: number; notes?: string }>();

  for (const segment of segments) {
    const matchedItem = resolveMenuItemFromVoiceQuery(menuItems, segment);
    if (!matchedItem) {
      continue;
    }

    const quantity = Math.max(1, Math.min(12, parseVoiceQuantity(segment)));
    const notes = extractVoiceNotes(segment);
    const existing = merged.get(matchedItem.id);
    if (existing) {
      existing.quantity += quantity;
      if (!existing.notes && notes) {
        existing.notes = notes;
      }
    } else {
      merged.set(matchedItem.id, { item: matchedItem, quantity, notes });
    }
  }

  return Array.from(merged.values());
}

function extractMultipleRemoveIntents(transcript: string, cartItems: CartItem[]) {
  const normalized = normalizeVoiceText(transcript);
  if (!/\b(quita|quitar|elimina|borra|cancela)\b/.test(normalized)) {
    return [];
  }

  const segments = normalized
    .split(/\s*(?:,| y | e | luego | despues | después | tambien | también )\s*/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const merged = new Map<string, { item: MenuItem; quantity: number; notes?: string }>();
  const orderItems = dedupeMenuItems(cartItems.map((cartItem) => cartItem.menuItem));

  for (const segment of segments) {
    const matchedItem = resolveMenuItemFromVoiceQuery(orderItems, segment);
    if (!matchedItem) {
      continue;
    }

    const quantity = Math.max(1, Math.min(12, parseVoiceQuantity(segment)));
    const notes = extractVoiceNotes(segment);
    const existing = merged.get(matchedItem.id);
    if (existing) {
      existing.quantity += quantity;
      if (!existing.notes && notes) {
        existing.notes = notes;
      }
    } else {
      merged.set(matchedItem.id, { item: matchedItem, quantity, notes });
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
  const orderItems = dedupeMenuItems(cartItems.map((cartItem) => cartItem.menuItem));
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

export function parseLocalVoiceIntent(
  transcript: string,
  menuItems: MenuItem[],
  cartItems: CartItem[],
  hasPendingConfirmation = false,
  confirmationArmedThisTurn = false,
): LocalVoiceIntent {
  const normalized = normalizeVoiceText(transcript);

  const wantsConfirm =
    /\b(confirma|confirmar|confirma ya|esta bien|está bien|correcto|eso es todo|ya estaria|ya estaria bien|puedes mandarlo|mandalo|mandalo ya|envialo|enviarlo)\b/.test(
      normalized,
    );

  const wantsPendingConfirmation = hasPendingConfirmation && isExplicitFinalConfirmation(transcript);

  const wantsRemove = /\b(quita|quitar|quita una|elimina|borra|cancela)\b/.test(normalized);
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

    const item = resolveMenuItemFromVoiceQuery(dedupeMenuItems(cartItems.map((cartItem) => cartItem.menuItem)), transcript);
    if (item && !protectedIds.has(item.id)) {
      return {
        type: 'remove',
        item,
        quantity: Math.max(1, Math.min(12, parseVoiceQuantity(transcript))),
        notes: extractVoiceNotes(transcript),
      };
    }

    return { type: 'unknown' };
  }

  const wantsAdd = /\b(pon|ponme|ponnos|trae|traeme|traenos|anade|añade|dame|danos|quiero|queria|me pones|para mi)\b/.test(normalized);
  if (wantsAdd || transcriptMentionsMenuItem(transcript, menuItems)) {
    const multipleItems = extractMultipleAddIntents(transcript, menuItems);
    if (multipleItems.length > 1) {
      return { type: 'addMany', items: multipleItems };
    }

    const item = resolveMenuItemFromVoiceQuery(menuItems, transcript);
    if (item) {
      return {
        type: 'add',
        item,
        quantity: Math.max(1, Math.min(12, parseVoiceQuantity(transcript))),
        notes: extractVoiceNotes(transcript),
      };
    }
  }

  if (!confirmationArmedThisTurn && (wantsConfirm || wantsPendingConfirmation)) {
    return { type: 'confirm' };
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
  onRemoveManyFromOrder,
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
  const turnRecoveryTimeoutRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const fallbackSpeechTimeoutRef = useRef<number | null>(null);
  const assistantSpeechTimeoutRef = useRef<number | null>(null);
  const fastLocalIntentTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const playedAudioChunksRef = useRef<Set<string>>(new Set());
  const currentTurnHadAudioOutputRef = useRef(false);
  const lastSpokenOutputSignatureRef = useRef('');
  const localSpeechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const lastAssistantTextRef = useRef('');
  const lastOutputTranscriptRef = useRef('');
  const pendingEndSessionRef = useRef(false);
  const latestInputTranscriptRef = useRef('');
  const currentTurnHadToolCallRef = useRef(false);
  const processedToolCallIdsRef = useRef<Set<string>>(new Set());
  const processedToolCallSignaturesRef = useRef<Map<string, ToolResult>>(new Map());
  const currentTurnAddedQuantitiesRef = useRef<Map<string, number>>(new Map());
  const currentTurnLocallyHandledRef = useRef(false);
  const currentTurnAddedToOrderRef = useRef(false);
  const currentTurnRemovedFromOrderRef = useRef(false);
  const currentTurnConfirmedOrderRef = useRef(false);
  const currentTurnHadAssistantOutputRef = useRef(false);
  const pendingOrderConfirmationRef = useRef(false);
  const pendingOrderConfirmationSignatureRef = useRef('');
  const confirmationPendingActivatedThisTurnRef = useRef(false);
  const pendingConfirmationPromptRef = useRef('');
  const pendingLocalFallbackMessageRef = useRef('');
  const pendingAddFallbackRef = useRef<PendingAddFallback | null>(null);
  const lastAssistantOutputSignatureRef = useRef('');
  const synthesizedSpeechSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const synthesizedSpeechTokenRef = useRef(0);

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

  const clearTurnRecoveryTimeout = useCallback(() => {
    if (turnRecoveryTimeoutRef.current) {
      window.clearTimeout(turnRecoveryTimeoutRef.current);
      turnRecoveryTimeoutRef.current = null;
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearFallbackSpeechTimeout = useCallback(() => {
    if (fallbackSpeechTimeoutRef.current) {
      window.clearTimeout(fallbackSpeechTimeoutRef.current);
      fallbackSpeechTimeoutRef.current = null;
    }
  }, []);

  const clearAssistantSpeechTimeout = useCallback(() => {
    if (assistantSpeechTimeoutRef.current) {
      window.clearTimeout(assistantSpeechTimeoutRef.current);
      assistantSpeechTimeoutRef.current = null;
    }
  }, []);

  const clearFastLocalIntentTimeout = useCallback(() => {
    if (fastLocalIntentTimeoutRef.current) {
      window.clearTimeout(fastLocalIntentTimeoutRef.current);
      fastLocalIntentTimeoutRef.current = null;
    }
  }, []);

  const requestMicrophoneAccess = useCallback(async () => {
    if (!branding.voiceEnabled) {
      throw new Error('La voz no está disponible en este entorno.');
    }

    assertMicrophoneRuntimeAvailable();

    let stream: MediaStream | null = null;

    try {
      if (hasLiveAudioTrack(mediaStreamRef.current)) {
        addLog('system', 'Micrófono preparado.');
        return;
      }

      stream = await navigator.mediaDevices.getUserMedia(getMicrophoneConstraints());
      if (shouldKeepCaptureWarm()) {
        mediaStreamRef.current = stream;
        stream = null;
      }
      addLog('system', 'Micrófono preparado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo activar el micrófono.';
      addLog('error', message);
      throw error;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }, [addLog, branding.voiceEnabled]);

  const resetPendingOrderConfirmation = useCallback(() => {
    pendingOrderConfirmationRef.current = false;
    pendingOrderConfirmationSignatureRef.current = '';
    confirmationPendingActivatedThisTurnRef.current = false;
    pendingConfirmationPromptRef.current = '';
  }, []);

  const applyCartAdd = useCallback(
    (item: MenuItem, quantity: number, notes?: string) => {
      const nextItems = onAddToCart(item, quantity, notes);
      cartItemsRef.current = nextItems;
      return nextItems;
    },
    [onAddToCart],
  );

  const applyTurnCartAdd = useCallback(
    (item: MenuItem, quantity: number, notes?: string) => {
      const key = buildTurnAddKey(item.id, notes);
      const previousQuantity = currentTurnAddedQuantitiesRef.current.get(key) ?? 0;
      const quantityDelta = Math.max(0, quantity - previousQuantity);

      if (quantityDelta <= 0) {
        return {
          applied: false,
          items: cartItemsRef.current,
          quantityApplied: 0,
        };
      }

      const nextItems = applyCartAdd(item, quantityDelta, notes);
      currentTurnAddedQuantitiesRef.current.set(key, previousQuantity + quantityDelta);
      currentTurnAddedToOrderRef.current = true;

      return {
        applied: true,
        items: nextItems,
        quantityApplied: quantityDelta,
      };
    },
    [applyCartAdd],
  );

  const applyCartRemoval = useCallback(
    (item: MenuItem, quantity: number, notes?: string) => {
      const result = onRemoveFromOrder(item.id, quantity, item.name, notes);
      cartItemsRef.current = result.items;
      return result;
    },
    [onRemoveFromOrder],
  );

  const applyCartRemovalBatch = useCallback(
    (entries: Array<{ item: MenuItem; quantity: number; notes?: string }>) => {
      const result = onRemoveManyFromOrder(
        entries.map((entry) => ({
          menuItemId: entry.item.id,
          itemName: entry.item.name,
          quantity: entry.quantity,
          notes: entry.notes,
        })),
      );
      cartItemsRef.current = result.items;
      return result;
    },
    [onRemoveManyFromOrder],
  );

  const attemptConfirmCurrentOrder = useCallback(async () => {
    if (cartItemsRef.current.length === 0) {
      resetPendingOrderConfirmation();
      addLog('error', 'No puedes confirmar un pedido vacío.');
      return {
        success: false,
        confirmationPending: false,
        error: 'No puedes confirmar un pedido vacío.',
      } satisfies ToolResult & { confirmationPending?: boolean };
    }

    const currentCartSignature = buildCartSignature(cartItemsRef.current);
    if (!pendingOrderConfirmationRef.current || pendingOrderConfirmationSignatureRef.current !== currentCartSignature) {
      const confirmationPrompt = buildOrderConfirmationPrompt(cartItemsRef.current);
      pendingOrderConfirmationRef.current = true;
      pendingOrderConfirmationSignatureRef.current = currentCartSignature;
      confirmationPendingActivatedThisTurnRef.current = true;
      pendingConfirmationPromptRef.current = confirmationPrompt;
      addLog('system', 'Confirmación bloqueada: falta confirmación final del cliente.');
      return {
        success: false,
        confirmationPending: true,
        error: `${confirmationPrompt} No lo envíes todavía: primero pide confirmación explícita al cliente.`,
      } satisfies ToolResult & { confirmationPending?: boolean };
    }

    const lineCount = cartItemsRef.current.length;
    const success = await onConfirmOrder(dinersCountRef.current, clientNameRef.current, cartItemsRef.current);
    resetPendingOrderConfirmation();
    currentTurnConfirmedOrderRef.current = success;
    if (success) {
      cartItemsRef.current = [];
    }
    addLog(success ? 'system' : 'error', success ? 'Pedido confirmado desde voz.' : 'La confirmación por voz ha fallado.');
    return success
      ? ({
          success: true,
          confirmationPending: false,
          message: `Pedido confirmado y enviado con ${lineCount} líneas.`,
        } satisfies ToolResult & { confirmationPending?: boolean })
      : ({
          success: false,
          confirmationPending: false,
          error: 'No se pudo confirmar el pedido.',
        } satisfies ToolResult & { confirmationPending?: boolean });
  }, [addLog, onConfirmOrder, resetPendingOrderConfirmation]);

  const cancelSynthesizedSpeech = useCallback(() => {
    synthesizedSpeechTokenRef.current += 1;

    const source = synthesizedSpeechSourceRef.current;
    synthesizedSpeechSourceRef.current = null;
    if (!source) {
      return;
    }

    sourcesRef.current.delete(source);
    try {
      source.stop();
    } catch {
      // El nodo puede haber terminado ya; no hay nada que limpiar.
    }
  }, []);

  const stopPlayback = useCallback(() => {
    cancelSynthesizedSpeech();
    sourcesRef.current.forEach((source) => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    modelTurnCompleteRef.current = false;
    playedAudioChunksRef.current.clear();
  }, [cancelSynthesizedSpeech]);

  const resetAssistantTurnTracking = useCallback(() => {
    clearFallbackSpeechTimeout();
    clearAssistantSpeechTimeout();
    clearFastLocalIntentTimeout();
    playedAudioChunksRef.current.clear();
    currentTurnHadAudioOutputRef.current = false;
    lastSpokenOutputSignatureRef.current = '';
    lastAssistantTextRef.current = '';
    lastOutputTranscriptRef.current = '';
    pendingEndSessionRef.current = false;
    latestInputTranscriptRef.current = '';
    currentTurnHadToolCallRef.current = false;
    processedToolCallIdsRef.current.clear();
    processedToolCallSignaturesRef.current.clear();
    currentTurnAddedQuantitiesRef.current.clear();
    currentTurnLocallyHandledRef.current = false;
    currentTurnAddedToOrderRef.current = false;
    currentTurnRemovedFromOrderRef.current = false;
    currentTurnConfirmedOrderRef.current = false;
    currentTurnHadAssistantOutputRef.current = false;
    confirmationPendingActivatedThisTurnRef.current = false;
    pendingConfirmationPromptRef.current = '';
    pendingLocalFallbackMessageRef.current = '';
    pendingAddFallbackRef.current = null;
    lastAssistantOutputSignatureRef.current = '';
  }, [clearAssistantSpeechTimeout, clearFallbackSpeechTimeout, clearFastLocalIntentTimeout]);

  const cancelLocalSpeech = useCallback(() => {
    localSpeechUtteranceRef.current = null;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    window.speechSynthesis.cancel();
  }, []);

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
      clearTurnRecoveryTimeout();
      clearReconnectTimeout();
      clearFallbackSpeechTimeout();
      clearAssistantSpeechTimeout();
      clearFastLocalIntentTimeout();
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
    [cancelLocalSpeech, clearAssistantSpeechTimeout, clearCaptureTeardownTimeout, clearFallbackSpeechTimeout, clearFastLocalIntentTimeout, clearRecordingTimeout, clearReconnectTimeout, clearTurnRecoveryTimeout, resetAssistantTurnTracking, resetPendingOrderConfirmation, setPreferredAudioSession, setStatusSafe, setTurnStateSafe, stopPlayback, teardownAudioCapture],
  );

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    addLog('system', 'Sesión cerrada.');
    resetSession('disconnected');
  }, [addLog, resetSession]);

  const runVoiceDiagnostics = useCallback(async () => {
    if (hasRunDiagnosticsRef.current) {
      return;
    }

    hasRunDiagnosticsRef.current = true;

    try {
      const diagnostics = await fetchVoiceDiagnostics();
      addLog(diagnostics.tokenCheck.ok ? 'system' : 'error', `Diagnóstico token: ${diagnostics.tokenCheck.message}`);
      addLog(diagnostics.liveCheck.ok ? 'system' : 'error', `Diagnóstico Live: ${diagnostics.liveCheck.message}`);
    } catch (error) {
      addLog(
        'error',
        error instanceof Error ? `No se ha podido leer el diagnóstico: ${error.message}` : 'No se ha podido leer el diagnóstico de voz.',
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
      description: 'Actualiza el número de comensales y opcionalmente el nombre del cliente.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          count: { type: Type.NUMBER, description: 'Número de comensales' },
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
          quantity: { type: Type.NUMBER, description: 'Número de unidades a quitar. Si no se indica, quita 1.' },
          notes: { type: Type.STRING, description: 'Observaciones exactas de la línea si hay varias del mismo plato.' },
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
      description: 'Cierra la sesión cuando la conversación haya terminado.',
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
        result = { success: true, count: menuRef.current.length, message: 'La carta ya está en contexto.' };
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
        dinersCountRef.current = Math.max(1, count);
        if (nextName?.trim()) {
          clientNameRef.current = nextName.trim();
        }
        resetPendingOrderConfirmation();
        addLog('system', `Mesa actualizada a ${count} comensales.`);
        result = { success: true, message: `${count} comensales actualizados.` };
      } else if (name === 'addToOrder') {
        const itemName = typeof args.itemName === 'string' ? args.itemName : typeof args.menuItemId === 'string' ? args.menuItemId : '';
        const quantity = Math.max(1, Math.min(12, Number(args.quantity ?? 1) || 1));
        const notes = typeof args.notes === 'string' ? normalizeVoiceNote(args.notes) : undefined;
        const match = findMenuItemMatch(menuRef.current, args);
        const item = match.item;
        pendingAddFallbackRef.current = {
          itemName: typeof args.itemName === 'string' ? args.itemName : undefined,
          menuItemId: typeof args.menuItemId === 'string' ? args.menuItemId : undefined,
          quantity,
          notes,
        };

        if (!item) {
          const suggestions = match.candidates.slice(0, 3).map((candidate) => candidate.name).join(', ');
          result = {
            success: false,
            error: suggestions
              ? `No tengo claro qué plato es "${itemName}". Quizá te refieres a: ${suggestions}.`
              : `No he podido identificar el plato "${itemName}" en la carta actual.`,
          };
          addLog('error', result.error);
        } else {
          const addition = applyTurnCartAdd(item, quantity, notes);
          resetPendingOrderConfirmation();
          pendingAddFallbackRef.current = null;
          if (!addition.applied) {
            result = {
              success: true,
              message: `${item.name} ya estaba aplicado en este turno. Pedido actual: ${summarizeCartItems(addition.items)}`,
            };
            return result;
          }
          addLog('system', `Añadido ${quantity}x ${item.name}.`);
          result = {
            success: true,
            message: `${addition.quantityApplied}x ${item.name} añadidos correctamente.${notes ? ` Observaciones: ${notes}.` : ''} Pedido actual: ${summarizeCartItems(addition.items)}`,
          };
        }
      } else if (name === 'removeFromOrder') {
        if (currentTurnRemovedFromOrderRef.current) {
          result = {
            success: true,
            message: `La corrección ya estaba aplicada en este turno. Pedido actual: ${summarizeCartItems(cartItemsRef.current)}`,
          };
          return result;
        }

        const itemName = typeof args.itemName === 'string' ? args.itemName : typeof args.menuItemId === 'string' ? args.menuItemId : '';
        const quantity = Math.max(1, Math.min(12, Number(args.quantity ?? 1) || 1));
        const notes = typeof args.notes === 'string' ? normalizeVoiceNote(args.notes) : undefined;
        const match = findMenuItemMatch(
          cartItemsRef.current.map((cartItem) => cartItem.menuItem),
          args,
        );
        const item = match.item;

        if (!item) {
          const suggestions = match.candidates.slice(0, 3).map((candidate) => candidate.name).join(', ');
          result = {
            success: false,
            error: suggestions
              ? `No tengo claro qué plato quieres quitar cuando dices "${itemName}". Quizá te refieres a: ${suggestions}.`
              : `No he encontrado "${itemName}" dentro del pedido actual.`,
          };
          addLog('error', result.error);
        } else {
          const removal = applyCartRemoval(item, quantity, notes);
          if (removal.requiresClarification && removal.matchingLines?.length) {
            result = {
              success: false,
              error: buildRemoveClarificationMessage(item.name, removal.matchingLines),
            };
            addLog('error', result.error);
            return result;
          }

          if (removal.removedQuantity <= 0) {
            result = {
              success: false,
              error: `No he podido quitar ${item.name} porque ya no estaba en el pedido actual.`,
            };
            addLog('error', result.error);
            return result;
          }

          resetPendingOrderConfirmation();
          currentTurnRemovedFromOrderRef.current = true;
          addLog('system', `Corregido el pedido de ${item.name}: quitadas ${removal.removedQuantity} unidades.`);

          result = {
            success: true,
            message: `Se han quitado ${removal.removedQuantity} unidades de ${item.name} del pedido actual. Pedido actual: ${summarizeCartItems(removal.items)}`,
          };
        }
      } else if (name === 'confirmOrder') {
        result = await attemptConfirmCurrentOrder();
      } else if (name === 'endSession') {
        result = { success: true, message: 'Sesión cerrada.' };
        pendingEndSessionRef.current = true;
      }

      return result;
    },
    [addLog, applyTurnCartAdd, applyCartRemoval, attemptConfirmCurrentOrder, disconnect, onSetDiners, resetPendingOrderConfirmation],
  );

  const ensurePlaybackPipeline = useCallback(async () => {
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) {
      throw new Error('Este navegador no soporta audio en tiempo real.');
    }

    if (!audioContextRef.current || audioContextRef.current.state === 'closed' || !playbackGainRef.current) {
      const playbackContext = new AudioContextClass({ sampleRate: 24_000 });
      audioContextRef.current = playbackContext;
      const playbackTuning = getPlaybackTuning();

      const playbackGain = playbackContext.createGain();
      playbackGain.gain.value = playbackTuning.gain;
      const playbackCompressor = playbackContext.createDynamicsCompressor();
      playbackCompressor.threshold.value = playbackTuning.compressor.threshold;
      playbackCompressor.knee.value = playbackTuning.compressor.knee;
      playbackCompressor.ratio.value = playbackTuning.compressor.ratio;
      playbackCompressor.attack.value = playbackTuning.compressor.attack;
      playbackCompressor.release.value = playbackTuning.compressor.release;
      playbackGain.connect(playbackCompressor);
      playbackCompressor.connect(playbackContext.destination);
      playbackGainRef.current = playbackGain;
      playbackCompressorRef.current = playbackCompressor;
      await playbackContext.resume();
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, [getAudioContextClass]);

  const ensureAudioPipeline = useCallback(async () => {
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) {
      throw new Error('Este navegador no soporta audio en tiempo real.');
    }

    assertMicrophoneRuntimeAvailable();

    await ensurePlaybackPipeline();

    if (mediaStreamRef.current && inputProcessorRef.current && inputContextRef.current?.state !== 'closed') {
      return;
    }

    const activeStream = mediaStreamRef.current;
    const stream = hasLiveAudioTrack(activeStream) && activeStream
      ? activeStream
      : await navigator.mediaDevices.getUserMedia(getMicrophoneConstraints());
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
  }, [ensurePlaybackPipeline, getAudioContextClass]);

  const finalizeTurnIfReady = useCallback(() => {
    if (sourcesRef.current.size > 0 || localSpeechUtteranceRef.current) {
      return;
    }

    clearTurnRecoveryTimeout();

    if (turnStateRef.current !== 'recording') {
      setTurnStateSafe('idle');
      setVolumeLevel(0);
      if (shouldKeepCaptureWarm()) {
        clearCaptureTeardownTimeout();
      } else {
        scheduleAudioCaptureTeardown();
      }
      if (pendingEndSessionRef.current) {
        pendingEndSessionRef.current = false;
        disconnect();
      }
    }
  }, [clearCaptureTeardownTimeout, clearTurnRecoveryTimeout, disconnect, scheduleAudioCaptureTeardown, setTurnStateSafe]);

  const getQueuedPlaybackMs = useCallback(() => {
    if (!audioContextRef.current) {
      return 0;
    }

    return Math.max(0, (nextStartTimeRef.current - audioContextRef.current.currentTime) * 1_000);
  }, []);

  const scheduleTurnRecovery = useCallback(
    (reason: string) => {
      clearTurnRecoveryTimeout();
      const timeoutMs = getTurnRecoveryTimeoutMs({
        reason,
        queuedAudioMs: getQueuedPlaybackMs(),
        hasLocalSpeech: Boolean(localSpeechUtteranceRef.current),
      });

      turnRecoveryTimeoutRef.current = window.setTimeout(() => {
        if (turnStateRef.current !== 'processing' && turnStateRef.current !== 'speaking') {
          return;
        }

        addLog('error', `Ramiro ha recuperado el turno tras un bloqueo de audio (${reason}).`);
        stopPlayback();
        cancelLocalSpeech();
        sourcesRef.current.clear();
        localSpeechUtteranceRef.current = null;
        setTurnStateSafe('idle');
        setVolumeLevel(0);
        scheduleAudioCaptureTeardown();
      }, timeoutMs);
    },
    [addLog, cancelLocalSpeech, clearTurnRecoveryTimeout, getQueuedPlaybackMs, scheduleAudioCaptureTeardown, setTurnStateSafe, stopPlayback],
  );

  useEffect(() => {
    if (turnState !== 'processing' && turnState !== 'speaking') {
      clearTurnRecoveryTimeout();
      return;
    }

    scheduleTurnRecovery(
      turnState === 'speaking'
        ? localSpeechUtteranceRef.current
          ? 'voz local'
          : 'audio remoto'
        : 'espera de respuesta',
    );
  }, [clearTurnRecoveryTimeout, scheduleTurnRecovery, turnState]);

  const speakWithBrowserVoice = useCallback(
    (text: string) => {
      const message = text.trim();
      if (typeof window === 'undefined' || !('speechSynthesis' in window) || !message) {
        return false;
      }

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        const voices = window.speechSynthesis.getVoices();
        const spanishVoice =
          voices.find((voice) => voice.lang.toLowerCase() === 'es-es') ??
          voices.find((voice) => voice.lang.toLowerCase().startsWith('es'));

        if (spanishVoice) {
          utterance.voice = spanishVoice;
        }

        utterance.lang = spanishVoice?.lang || 'es-ES';
        utterance.rate = 1.04;
        utterance.pitch = 1;
        utterance.volume = 1;

        localSpeechUtteranceRef.current = utterance;
        setTurnStateSafe('speaking');
        scheduleTurnRecovery('voz local');

        utterance.onend = () => {
          if (localSpeechUtteranceRef.current === utterance) {
            localSpeechUtteranceRef.current = null;
          }
          finalizeTurnIfReady();
        };

        utterance.onerror = () => {
          if (localSpeechUtteranceRef.current === utterance) {
            localSpeechUtteranceRef.current = null;
          }
          finalizeTurnIfReady();
        };

        window.speechSynthesis.speak(utterance);
        return true;
      } catch {
        localSpeechUtteranceRef.current = null;
        return false;
      }
    },
    [finalizeTurnIfReady, scheduleTurnRecovery, setTurnStateSafe],
  );

  const speakWithConsistentVoice = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message) {
        return false;
      }

      const signature = normalizeVoiceText(message);
      if (!signature || signature === lastSpokenOutputSignatureRef.current) {
        return false;
      }
      lastSpokenOutputSignatureRef.current = signature;

      if (speakWithBrowserVoice(message)) {
        return true;
      }

      const speechToken = synthesizedSpeechTokenRef.current + 1;
      synthesizedSpeechTokenRef.current = speechToken;

      try {
        await ensurePlaybackPipeline();
        const audioContext = audioContextRef.current;
        if (!audioContext) {
          lastSpokenOutputSignatureRef.current = '';
          return false;
        }

        const { audioBase64, sampleRate } = await synthesizeVoiceFallbackOnApi(message);
        if (speechToken !== synthesizedSpeechTokenRef.current || currentTurnHadAudioOutputRef.current) {
          return false;
        }

        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        const audioBuffer = await decodeAudioData(base64ToUint8Array(audioBase64), audioContext, sampleRate);
        if (speechToken !== synthesizedSpeechTokenRef.current || currentTurnHadAudioOutputRef.current) {
          return false;
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackGainRef.current ?? audioContext.destination);
        synthesizedSpeechSourceRef.current = source;
        sourcesRef.current.add(source);

        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
        setTurnStateSafe('speaking');
        scheduleTurnRecovery('voz sintetizada');

        source.onended = () => {
          sourcesRef.current.delete(source);
          if (synthesizedSpeechSourceRef.current === source) {
            synthesizedSpeechSourceRef.current = null;
          }
          if (sourcesRef.current.size === 0) {
            finalizeTurnIfReady();
          }
        };

        return true;
      } catch (error) {
        lastSpokenOutputSignatureRef.current = '';
        addLog(
          'error',
          error instanceof Error
            ? `No se pudo sintetizar la respuesta de ${branding.assistantName}: ${error.message}`
            : `No se pudo sintetizar la respuesta de ${branding.assistantName}.`,
        );
        return false;
      }
    },
    [addLog, branding.assistantName, ensurePlaybackPipeline, finalizeTurnIfReady, scheduleTurnRecovery, setTurnStateSafe, speakWithBrowserVoice],
  );

  const speakFallbackMessage = useCallback(
    (message: string) => {
      currentTurnHadAssistantOutputRef.current = true;
      lastAssistantTextRef.current = message;
      lastOutputTranscriptRef.current = message;
      setLastAssistantMessage(message);
      addLog('assistant', message);
      return speakWithConsistentVoice(message);
    },
    [addLog, speakWithConsistentVoice],
  );

  const shouldUseLocalFallbackSpeech = useCallback(() => {
    return !currentTurnHadAudioOutputRef.current && !currentTurnHadAssistantOutputRef.current;
  }, []);

  const concludeHandledTurn = useCallback(
    (fallbackMessage?: string) => {
      clearFallbackSpeechTimeout();

      if (!fallbackMessage || !shouldUseLocalFallbackSpeech()) {
        finalizeTurnIfReady();
        return;
      }

      fallbackSpeechTimeoutRef.current = window.setTimeout(() => {
        fallbackSpeechTimeoutRef.current = null;

        void (async () => {
          if (shouldUseLocalFallbackSpeech()) {
            const spokeFallback = await speakFallbackMessage(fallbackMessage);
            if (!spokeFallback) {
              finalizeTurnIfReady();
            }
            return;
          }

          finalizeTurnIfReady();
        })();
      }, LOCAL_FALLBACK_SPEECH_DELAY_MS);
    },
    [clearFallbackSpeechTimeout, finalizeTurnIfReady, shouldUseLocalFallbackSpeech, speakFallbackMessage],
  );

  const scheduleAssistantTranscriptSpeech = useCallback(
    (message: string) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        return false;
      }

      clearAssistantSpeechTimeout();
      assistantSpeechTimeoutRef.current = window.setTimeout(() => {
        assistantSpeechTimeoutRef.current = null;

        void (async () => {
          if (currentTurnHadAudioOutputRef.current || localSpeechUtteranceRef.current || !lastAssistantTextRef.current.trim()) {
            finalizeTurnIfReady();
            return;
          }

          const spoke = await speakWithConsistentVoice(lastAssistantTextRef.current);
          if (!spoke) {
            finalizeTurnIfReady();
          }
        })();
      }, ASSISTANT_TRANSCRIPT_SPEECH_DELAY_MS);

      return true;
    },
    [clearAssistantSpeechTimeout, finalizeTurnIfReady, speakWithConsistentVoice],
  );

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

    pendingAddFallbackRef.current = null;
    const addition = applyTurnCartAdd(fallbackItem, fallbackArgs.quantity, fallbackArgs.notes);
    if (!addition.applied) {
      return false;
    }

    currentTurnLocallyHandledRef.current = true;
    resetPendingOrderConfirmation();
    addLog('system', `Fallback silencioso desde tool call: añadido ${addition.quantityApplied}x ${fallbackItem.name}.`);
    concludeHandledTurn(`He añadido ${addition.quantityApplied} ${fallbackItem.name} al pedido.`);
    return true;
  }, [addLog, applyTurnCartAdd, concludeHandledTurn, resetPendingOrderConfirmation]);

  const resolveHandledTurnSpeech = useCallback(
    (fallbackMessage: string, speakNow: boolean) => {
      pendingLocalFallbackMessageRef.current = fallbackMessage;
      if (speakNow) {
        concludeHandledTurn(fallbackMessage);
      }
    },
    [concludeHandledTurn],
  );

  const tryHandleLocalIntent = useCallback(async (options: { allowConfirm?: boolean; speakFallback?: boolean } = {}) => {
    const transcript = latestInputTranscriptRef.current.trim();
    if (!transcript) {
      return false;
    }

    const intent = parseLocalVoiceIntent(
      transcript,
      menuRef.current,
      cartItemsRef.current,
      pendingOrderConfirmationRef.current,
      confirmationPendingActivatedThisTurnRef.current,
    );
    if (intent.type === 'unknown') {
      return false;
    }

    if (intent.type === 'add') {
      const addition = applyTurnCartAdd(intent.item, intent.quantity, intent.notes);

      if (!addition.applied) {
        return false;
      }

      resetPendingOrderConfirmation();
      currentTurnLocallyHandledRef.current = true;
      addLog('system', `Fallback local silencioso: añadido ${addition.quantityApplied}x ${intent.item.name}.`);
      resolveHandledTurnSpeech(`He añadido ${addition.quantityApplied} ${intent.item.name} al pedido.`, options.speakFallback !== false);
      return true;
    }

    if (intent.type === 'addMany') {
      const additions = intent.items
        .map((entry) => ({
          ...entry,
          addition: applyTurnCartAdd(entry.item, entry.quantity, entry.notes),
        }))
        .filter((entry) => entry.addition.applied);

      if (additions.length === 0) {
        return false;
      }

      resetPendingOrderConfirmation();
      currentTurnLocallyHandledRef.current = true;
      addLog(
        'system',
        `Fallback local silencioso: añadidos ${additions.map((entry) => `${entry.addition.quantityApplied}x ${entry.item.name}`).join(', ')}.`,
      );
      resolveHandledTurnSpeech(
        `He añadido ${additions.map((entry) => `${entry.addition.quantityApplied} de ${entry.item.name}`).join(', ')} al pedido.`,
        options.speakFallback !== false,
      );
      return true;
    }

    if (intent.type === 'remove') {
      if (currentTurnRemovedFromOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      const removal = applyCartRemoval(intent.item, intent.quantity, intent.notes);
      if (removal.requiresClarification && removal.matchingLines?.length) {
        const clarificationMessage = buildRemoveClarificationMessage(intent.item.name, removal.matchingLines);
        addLog('error', clarificationMessage);
        concludeHandledTurn(clarificationMessage);
        return true;
      }
      if (removal.removedQuantity <= 0) {
        currentTurnLocallyHandledRef.current = false;
        return false;
      }
      resetPendingOrderConfirmation();
      currentTurnRemovedFromOrderRef.current = true;
      addLog('system', `Fallback local silencioso: quitadas ${removal.removedQuantity} unidades de ${intent.item.name}.`);
      concludeHandledTurn(`He quitado ${removal.removedQuantity} ${intent.item.name} del pedido.`);
      return true;
    }

    if (intent.type === 'removeMany') {
      if (currentTurnRemovedFromOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      const removal = applyCartRemovalBatch(intent.items);
      const clarificationItemName = removal.clarificationTarget?.itemName?.trim() || removal.matchingLines?.[0]?.menuItem.name || '';
      const clarificationMessage =
        removal.requiresClarification && removal.matchingLines?.length
          ? buildRemoveClarificationMessage(clarificationItemName, removal.matchingLines)
          : null;
      if (clarificationMessage) {
        addLog('error', clarificationMessage);
        concludeHandledTurn(clarificationMessage);
        return true;
      }
      if (removal.removedQuantity <= 0) {
        currentTurnLocallyHandledRef.current = false;
        return false;
      }
      resetPendingOrderConfirmation();
      currentTurnRemovedFromOrderRef.current = true;
      addLog(
        'system',
        `Fallback local silencioso: quitados ${intent.items.map((entry) => `${entry.quantity}x ${entry.item.name}`).join(', ')}.`,
      );
      concludeHandledTurn(`He actualizado el pedido y he quitado ${intent.items.map((entry) => `${entry.quantity} de ${entry.item.name}`).join(', ')}.`);
      return true;
    }

    if (intent.type === 'removeAllExcept') {
      if (currentTurnRemovedFromOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      const removal = applyCartRemovalBatch(intent.items);
      const clarificationItemName = removal.clarificationTarget?.itemName?.trim() || removal.matchingLines?.[0]?.menuItem.name || '';
      const removeAllClarificationMessage =
        removal.requiresClarification && removal.matchingLines?.length
          ? buildRemoveClarificationMessage(clarificationItemName, removal.matchingLines)
          : null;
      if (removeAllClarificationMessage) {
        addLog('error', removeAllClarificationMessage);
        concludeHandledTurn(removeAllClarificationMessage);
        return true;
      }
      if (removal.removedQuantity <= 0) {
        currentTurnLocallyHandledRef.current = false;
        return false;
      }
      resetPendingOrderConfirmation();
      currentTurnRemovedFromOrderRef.current = true;
      addLog(
        'system',
        `Fallback local silencioso: quitado todo excepto ${intent.keepItems.length > 0 ? intent.keepItems.map((item) => item.name).join(', ') : 'nada'}.`,
      );
      const keptItems = intent.keepItems.length > 0 ? intent.keepItems.map((item) => item.name).join(', ') : 'nada';
      concludeHandledTurn(`He quitado todo del pedido excepto ${keptItems}.`);
      return true;
    }

    if (intent.type === 'confirm') {
      if (options.allowConfirm === false) {
        return false;
      }

      if (currentTurnConfirmedOrderRef.current) {
        return false;
      }

      currentTurnLocallyHandledRef.current = true;
      const confirmation = await attemptConfirmCurrentOrder();
      if (!confirmation.success && !confirmation.confirmationPending) {
        currentTurnLocallyHandledRef.current = false;
        return false;
      }
      concludeHandledTurn(
        confirmation.success
          ? 'Pedido confirmado y enviado a cocina.'
          : buildOrderConfirmationPrompt(cartItemsRef.current),
      );
      return true;
    }

    return false;
  }, [addLog, applyTurnCartAdd, applyCartRemoval, applyCartRemovalBatch, attemptConfirmCurrentOrder, concludeHandledTurn, resetPendingOrderConfirmation, resolveHandledTurnSpeech]);

  const scheduleFastLocalIntent = useCallback(() => {
    if (
      (turnStateRef.current !== 'processing' && turnStateRef.current !== 'speaking')
    ) {
      return;
    }

    clearFastLocalIntentTimeout();
    fastLocalIntentTimeoutRef.current = window.setTimeout(() => {
      fastLocalIntentTimeoutRef.current = null;

      void tryHandleLocalIntent({ allowConfirm: false, speakFallback: false });
    }, FAST_LOCAL_INTENT_DELAY_MS);
  }, [clearFastLocalIntentTimeout, tryHandleLocalIntent]);

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
    clearTurnRecoveryTimeout();
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
        if (shouldReleaseCaptureAfterTurn()) {
          window.setTimeout(() => {
            if (turnStateRef.current !== 'recording') {
              teardownAudioCapture();
            }
          }, SAFARI_CAPTURE_RELEASE_MS);
        }
        setTurnStateSafe('processing');
        scheduleTurnRecovery('espera de respuesta');
        addLog('system', 'Audio enviado por límite de tiempo.');
      }
    }, MAX_RECORDING_MS);
  }, [addLog, cancelCurrentResponse, cancelLocalSpeech, clearRecordingTimeout, clearTurnRecoveryTimeout, resetAssistantTurnTracking, scheduleTurnRecovery, setPreferredAudioSession, setTurnStateSafe, teardownAudioCapture]);

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
        throw new Error('El modo push-to-talk solo está habilitado para Gemini en esta versión.');
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
            addLog('system', `Sesión de voz abierta con ${branding.assistantName} por Gemini.`);
            setStatusSafe('connected');
            if (isSafariBrowser()) {
              setPreferredAudioSession('playback');
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            const textParts = message.serverContent?.modelTurn?.parts
              ?.map((part) => ('text' in part ? part.text : undefined))
              .filter((part): part is string => Boolean(part));

            if (!currentTurnLocallyHandledRef.current && textParts && textParts.length > 0) {
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
              scheduleFastLocalIntent();
            }

            const outputTranscript = message.serverContent?.outputTranscription?.text?.trim();
            const outputSignature = outputTranscript ? normalizeVoiceText(outputTranscript) : '';
            if (!currentTurnLocallyHandledRef.current && outputTranscript && outputSignature && outputSignature !== lastAssistantOutputSignatureRef.current) {
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
                const toolCallId = typeof functionCall.id === 'string' && functionCall.id.trim() ? functionCall.id : '';
                if (toolCallId && processedToolCallIdsRef.current.has(toolCallId)) {
                  continue;
                }

                if (toolCallId) {
                  processedToolCallIdsRef.current.add(toolCallId);
                }
                const args = (functionCall.args as Record<string, unknown>) ?? {};
                const toolCallSignature = buildToolCallSignature(functionCall.name, args);
                const cachedResult = processedToolCallSignaturesRef.current.get(toolCallSignature);
                const result = cachedResult ?? (await runTool(functionCall.name, args));
                if (!cachedResult) {
                  processedToolCallSignaturesRef.current.set(toolCallSignature, result);
                } else {
                  addLog('system', `Tool call duplicada ignorada: ${functionCall.name}.`);
                }
                responses.push({
                  id: toolCallId || functionCall.id,
                  name: functionCall.name,
                  response: { result },
                });
              }

              if (responses.length > 0) {
                geminiSessionRef.current?.sendToolResponse({ functionResponses: responses });
              }
            }

            const audioParts = message.serverContent?.modelTurn?.parts?.filter(
              (part): part is typeof part & { inlineData: { data: string } } => 'inlineData' in part && Boolean(part.inlineData?.data),
            );
            if (!currentTurnLocallyHandledRef.current && audioParts && audioParts.length > 0 && audioContextRef.current) {
              clearAssistantSpeechTimeout();
              clearFallbackSpeechTimeout();
              cancelSynthesizedSpeech();
              currentTurnHadAssistantOutputRef.current = true;
              if (localSpeechUtteranceRef.current) {
                cancelLocalSpeech();
              }
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

                try {
                  const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), audioContext, 24_000);
                  const source = audioContext.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(playbackGainRef.current ?? audioContext.destination);
                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += audioBuffer.duration;
                  currentTurnHadAudioOutputRef.current = true;
                  setTurnStateSafe('speaking');
                  scheduleTurnRecovery('audio remoto');

                  sourcesRef.current.add(source);
                  source.onended = () => {
                    sourcesRef.current.delete(source);
                    if (sourcesRef.current.size > 0) {
                      scheduleTurnRecovery('audio remoto');
                    }
                    if (modelTurnCompleteRef.current) {
                      finalizeTurnIfReady();
                    }
                  };
                } catch (error) {
                  addLog(
                    'error',
                    error instanceof Error ? `No se pudo reproducir un fragmento de audio de Ramiro: ${error.message}` : 'No se pudo reproducir un fragmento de audio de Ramiro.',
                  );
                }
              }
            }

            if (message.serverContent?.interrupted) {
              clearAssistantSpeechTimeout();
              stopPlayback();
              cancelLocalSpeech();
              resetAssistantTurnTracking();
              addLog('system', 'Respuesta interrumpida para escuchar una nueva instrucción.');
              finalizeTurnIfReady();
            }

            if (message.serverContent?.turnComplete) {
              modelTurnCompleteRef.current = true;
              let handledLocally = tryHandlePendingAddFallback() || (await tryHandleLocalIntent());
              if (
                !handledLocally &&
                confirmationPendingActivatedThisTurnRef.current &&
                !currentTurnHadAssistantOutputRef.current &&
                pendingConfirmationPromptRef.current
              ) {
                handledLocally = true;
                concludeHandledTurn(pendingConfirmationPromptRef.current);
              }
              if (
                !handledLocally &&
                pendingLocalFallbackMessageRef.current &&
                !currentTurnHadAssistantOutputRef.current &&
                !currentTurnHadAudioOutputRef.current
              ) {
                handledLocally = true;
                concludeHandledTurn(pendingLocalFallbackMessageRef.current);
              }
              const assistantClaimsMutation = assistantTextClaimsMutation(lastAssistantTextRef.current);
              const hadVerifiedMutation =
                currentTurnAddedToOrderRef.current || currentTurnRemovedFromOrderRef.current || currentTurnConfirmedOrderRef.current;
              const canSpeakAssistantText =
                !handledLocally &&
                !currentTurnHadAudioOutputRef.current &&
                lastAssistantTextRef.current.trim() &&
                (!assistantClaimsMutation || hadVerifiedMutation);
              let scheduledAssistantSpeech = false;
              if (canSpeakAssistantText) {
                scheduledAssistantSpeech = scheduleAssistantTranscriptSpeech(lastAssistantTextRef.current);
              }
              if (!handledLocally && !scheduledAssistantSpeech) {
                finalizeTurnIfReady();
              }
            }
          },
          onclose: (event) => {
            const code = typeof event?.code === 'number' ? ` Código: ${event.code}.` : '';
            const reason = typeof event?.reason === 'string' && event.reason.trim() ? ` Motivo: ${event.reason}.` : '';
            addLog('system', `La conexión de voz de Gemini se ha cerrado.${code}${reason}`);

            if (!manualDisconnectRef.current) {
              void runVoiceDiagnostics();
              resetSession('error');
            } else {
              resetSession('disconnected');
            }
          },
          onerror: (error) => {
            addLog('error', error.message || 'Se ha producido un error en la sesión de Gemini.');
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
    concludeHandledTurn,
    ensureAudioPipeline,
    finalizeTurnIfReady,
    geminiTools,
    runTool,
    runVoiceDiagnostics,
    clearAssistantSpeechTimeout,
    clearFallbackSpeechTimeout,
    clearReconnectTimeout,
    cancelSynthesizedSpeech,
    resetSession,
    setPreferredAudioSession,
    setStatusSafe,
    setTurnStateSafe,
    stopPlayback,
    cancelLocalSpeech,
    scheduleAssistantTranscriptSpeech,
    scheduleFastLocalIntent,
    systemInstruction,
  ]);

  const beginPressToTalk = useCallback(async () => {
    if (!branding.voiceEnabled) {
      addLog('error', 'La voz no está disponible en este entorno. Puedes seguir usando la carta manual.');
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
      const message = connectionError instanceof Error ? connectionError.message : 'No se pudo iniciar la sesión de voz.';
      addLog('error', message);
      void runVoiceDiagnostics();
      setStatusSafe('error');
      setTurnStateSafe('error');
    }
  }, [addLog, branding.voiceEnabled, clearCaptureTeardownTimeout, ensureGeminiSession, runVoiceDiagnostics, setPreferredAudioSession, setStatusSafe, setTurnStateSafe, startRecordingInternal]);

  const prepareVoiceSession = useCallback(async () => {
    if (!branding.voiceEnabled) {
      throw new Error('La voz no está disponible en este entorno.');
    }

    clearCaptureTeardownTimeout();
    await ensureGeminiSession();
    await ensureAudioPipeline();
  }, [branding.voiceEnabled, clearCaptureTeardownTimeout, ensureAudioPipeline, ensureGeminiSession]);

  const endPressToTalk = useCallback(() => {
    pendingPressRef.current = false;

    if (turnStateRef.current !== 'recording' || !geminiSessionRef.current) {
      return;
    }

    clearRecordingTimeout();
    clearTurnRecoveryTimeout();
    shouldStreamAudioRef.current = false;
    geminiSessionRef.current.sendRealtimeInput({ activityEnd: {} });
    if (isSafariBrowser()) {
      setPreferredAudioSession('playback');
    }
    if (shouldReleaseCaptureAfterTurn()) {
      window.setTimeout(() => {
        if (turnStateRef.current !== 'recording') {
          teardownAudioCapture();
        }
      }, SAFARI_CAPTURE_RELEASE_MS);
    }
    setTurnStateSafe('processing');
    scheduleTurnRecovery('espera de respuesta');
    setVolumeLevel(0);
    addLog('system', 'Audio enviado a Ramiro.');
  }, [addLog, clearRecordingTimeout, clearTurnRecoveryTimeout, scheduleTurnRecovery, setPreferredAudioSession, setTurnStateSafe, teardownAudioCapture]);

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
        addLog('error', error instanceof Error ? error.message : 'No se pudo recuperar la sesión de voz.');
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
    requestMicrophoneAccess,
    prepareVoiceSession,
    beginPressToTalk,
    endPressToTalk,
    cancelCurrentResponse,
    disconnect,
    volumeLevel,
    logs,
    lastAssistantMessage,
  };
}
