import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';

import type { AppBranding } from '../types.js';

const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const DEFAULT_GEMINI_KITCHEN_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const deprecatedGeminiLiveModelMap: Record<string, string> = {
  'gemini-live-2.5-flash-preview': DEFAULT_GEMINI_LIVE_MODEL,
};

const normalizeApiKey = (rawValue?: string) => {
  const trimmedValue = rawValue?.trim();
  if (!trimmedValue) {
    return '';
  }

  const normalizedValue = trimmedValue
    .replace(/^["']|["']$/g, '')
    .replace(/^apikey[:=\s]*/i, '')
    .trim();

  const invalidMarkers = [
    'pega_aqui',
    'your_',
    'tu_',
    'example',
    'xxxx',
    'test',
    'demo',
    'placeholder',
    'borrada',
  ];

  const lowerValue = normalizedValue.toLowerCase();
  const looksLikePlaceholder =
    invalidMarkers.some((marker) => lowerValue.includes(marker)) ||
    lowerValue.includes('api key') ||
    lowerValue.includes('<') ||
    lowerValue.includes('>');

  return looksLikePlaceholder ? '' : normalizedValue;
};

const buildCsvUrl = (explicitUrl?: string, sheetId?: string) => {
  const trimmedUrl = explicitUrl?.trim();
  if (trimmedUrl) {
    return trimmedUrl;
  }

  const trimmedSheetId = sheetId?.trim();
  if (!trimmedSheetId) {
    return undefined;
  }

  return `https://docs.google.com/spreadsheets/d/${trimmedSheetId}/gviz/tq?tqx=out:csv`;
};

const toPort = (rawValue: string | undefined, fallback: number) => {
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const resolveGeminiLiveModel = (rawValue?: string) => {
  const trimmedValue = rawValue?.trim();
  if (!trimmedValue) {
    return DEFAULT_GEMINI_LIVE_MODEL;
  }

  return deprecatedGeminiLiveModelMap[trimmedValue] ?? trimmedValue;
};

export const serverConfig = {
  isProduction: process.env.NODE_ENV === 'production',
  host: '0.0.0.0',
  port: toPort(process.env.PORT, process.env.NODE_ENV === 'production' ? 3000 : 8787),
  sessionCookieName: 'ramiro_kitchen_session',
  adminSessionCookieName: 'ramiro_admin_session',
  sessionDurationMs: 1000 * 60 * 60 * 12,
  sseHeartbeatMs: 20_000,
  menuCacheTtlMs: 60_000,
  frontendDistPath: path.join(process.cwd(), 'dist'),
  dataFilePath: path.join(process.cwd(), 'data', 'store.json'),
  uploadsDirPath: path.join(process.cwd(), 'data', 'uploads'),
  uploadMaxFileSizeBytes: 5 * 1024 * 1024,
  geminiApiKey: normalizeApiKey(process.env.GEMINI_API_KEY),
  geminiLiveModel: resolveGeminiLiveModel(process.env.GEMINI_LIVE_MODEL),
  geminiKitchenTtsModel: process.env.GEMINI_KITCHEN_TTS_MODEL?.trim() || DEFAULT_GEMINI_KITCHEN_TTS_MODEL,
  openAiApiKey: normalizeApiKey(process.env.OPENAI_API_KEY),
  openAiRealtimeModel: process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime',
  openAiVoice: process.env.OPENAI_REALTIME_VOICE?.trim() || 'alloy',
  kitchenPassword: process.env.KITCHEN_PASSWORD?.trim() || 'ramiro-cocina',
  adminPassword: process.env.ADMIN_PASSWORD?.trim() || 'ramiro-admin',
  menuCsvUrl: buildCsvUrl(process.env.MENU_CSV_URL, process.env.MENU_SHEET_ID),
  legacyOrdersCsvUrl: buildCsvUrl(process.env.ORDERS_CSV_URL, process.env.ORDERS_SHEET_ID),
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL?.trim() || undefined,
};

const resolvedVoiceProvider = serverConfig.geminiApiKey
  ? 'gemini'
  : serverConfig.openAiApiKey
    ? 'openai'
    : 'none';

export const publicBranding: AppBranding = {
  restaurantName: process.env.RESTAURANT_NAME?.trim() || 'Ramiro',
  assistantName: process.env.ASSISTANT_NAME?.trim() || 'Ramiro',
  kitchenName: process.env.KITCHEN_NAME?.trim() || 'Cocina',
  tagline: process.env.APP_TAGLINE?.trim() || 'Servicio digital para sala y cocina',
  supportManualOrdering: true,
  showDebugTools: process.env.SHOW_DEBUG_TOOLS === 'true',
  voiceEnabled: resolvedVoiceProvider !== 'none',
  voiceProvider: resolvedVoiceProvider,
  showWifiPopup: process.env.SHOW_WIFI_POPUP === 'true',
  wifiSsid: process.env.WIFI_SSID?.trim() || '',
  wifiPassword: process.env.WIFI_PASSWORD?.trim() || '',
};

export const serverSecretsState = {
  hasGeminiApiKey: Boolean(serverConfig.geminiApiKey),
  hasOpenAiApiKey: Boolean(serverConfig.openAiApiKey),
};

export const serverVoiceState = {
  configuredGeminiLiveModel: process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_GEMINI_LIVE_MODEL,
  effectiveGeminiLiveModel: serverConfig.geminiLiveModel,
  geminiLiveModelWasMigrated:
    Boolean(process.env.GEMINI_LIVE_MODEL?.trim()) &&
    serverConfig.geminiLiveModel !== process.env.GEMINI_LIVE_MODEL?.trim(),
};
