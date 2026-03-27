import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { ActivityHandling, GoogleGenAI, Modality } from '@google/genai';
import cookieParser from 'cookie-parser';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';

import type {
  AdminSettings,
  AdminTable,
  AdminSessionStatusResponse,
  CreateAdminTableRequest,
  CreateMenuItemRequest,
  CreateOrderRequest,
  MenuEventPayload,
  OrderStatus,
  OrdersEventPayload,
  ReorderMenuRequest,
  SessionStatusResponse,
  SessionTokenResponse,
  TableQrResponse,
  TablesQrBatchResponse,
  UploadImageResponse,
  UpdateAdminSettingsRequest,
  UpdateAdminTableRequest,
  UpdateAdminTableStatusRequest,
  UpdateMenuItemAvailabilityRequest,
  UpdateMenuItemRequest,
} from '../types.js';
import { publicBranding, serverConfig, serverSecretsState, serverVoiceState } from './config.js';
import {
  createMenuItem,
  deleteMenuItem,
  getAdminMenu,
  getMenu,
  reorderMenu,
  toMenuServiceError,
  updateMenuItem,
  updateMenuItemAvailability,
} from './menu.js';
import { clearServedOrders, createOrder, listOrders, seedLegacyOrdersFromSheetIfNeeded, toServiceError, updateOrderStatus } from './orders.js';
import { appStore } from './store.js';
import { createTable, deleteTable, getTableQr, getTablesQrBatch, listTables, toTablesServiceError, updateTable, updateTableStatus } from './tables.js';

const app = express();
const kitchenSessions = new Map<string, number>();
const adminSessions = new Map<string, number>();
const kitchenAnnouncementCache = new Map<string, { payload: { audioBase64: string; mimeType: string; sampleRate: number }; expiresAt: number }>();

const orderStatusValues = ['pending', 'cooking', 'ready', 'served'] as const satisfies readonly OrderStatus[];
const allowedUploadMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const createOrderSchema = z.object({
  tableNumber: z.string().trim().min(1).max(16),
  clientName: z.string().trim().max(80).optional(),
  diners: z.coerce.number().int().min(1).max(24),
  customerEmail: z.union([z.string().trim().email().max(160), z.literal('')]).optional(),
  reviewConsent: z.coerce.boolean().optional(),
  source: z.enum(['voice', 'manual']).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().trim().min(1),
        quantity: z.coerce.number().int().min(1).max(50),
        notes: z.string().trim().max(160).optional(),
      }),
    )
    .min(1),
});

const updateOrderSchema = z.object({
  status: z.enum(orderStatusValues),
});

const loginSchema = z.object({
  password: z.string().min(1),
});

const kitchenAnnouncementSchema = z.object({
  text: z.string().trim().min(1).max(1500),
});

const menuImageUrlSchema = z.union([
  z.string().trim().url(),
  z.string().trim().startsWith('/uploads/'),
  z.literal(''),
  z.null(),
]);

const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(280).optional().default(''),
  price: z.coerce.number().min(0).max(10_000),
  category: z.string().trim().min(1).max(80),
  sortOrder: z.coerce.number().int().min(0).optional(),
  allergens: z.array(z.string().trim().min(1).max(40)).optional(),
  dietary: z.array(z.string().trim().min(1).max(40)).optional(),
  available: z.coerce.boolean().optional(),
  ingredients: z.array(z.string().trim().min(1).max(80)).optional(),
  imageUrl: menuImageUrlSchema.optional(),
});

const menuItemUpdateSchema = menuItemSchema.partial();

const availabilitySchema = z.object({
  available: z.coerce.boolean(),
});

const reorderMenuSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().trim().min(1),
      sortOrder: z.coerce.number().int().min(0),
    }),
  ),
});

const tableSchema = z.object({
  number: z.string().trim().min(1).max(16),
  label: z.string().trim().max(80).optional(),
});

const tableUpdateSchema = tableSchema.partial();

const tableStatusSchema = z.object({
  active: z.coerce.boolean(),
});

const tableQrQuerySchema = z.object({
  origin: z.string().trim().url(),
});

const tableQrBodySchema = z.object({
  origin: z.string().trim().url(),
});

const tablesQrBatchSchema = z.object({
  origin: z.string().trim().url(),
  tableIds: z.array(z.string().trim().min(1)).min(1),
});

const adminSettingsSchema = z.object({
  showWifiPopup: z.coerce.boolean(),
  wifiSsid: z.string().trim().max(120),
  wifiPassword: z.string().trim().max(120),
});

const uploadsStorage = multer.diskStorage({
  destination: async (_request, _file, callback) => {
    try {
      await mkdir(serverConfig.uploadsDirPath, { recursive: true });
      callback(null, serverConfig.uploadsDirPath);
    } catch (error) {
      callback(error instanceof Error ? error : new Error('No se pudo preparar la carpeta de uploads.'), serverConfig.uploadsDirPath);
    }
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname) || '.jpg';
    callback(null, `${crypto.randomUUID()}${extension.toLowerCase()}`);
  },
});

const uploadImage = multer({
  storage: uploadsStorage,
  limits: {
    fileSize: serverConfig.uploadMaxFileSizeBytes,
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedUploadMimeTypes.has(file.mimetype)) {
      callback(new Error('Solo se permiten imagenes JPG, PNG, WEBP o GIF.'));
      return;
    }

    callback(null, true);
  },
});

const safePasswordMatch = (providedPassword: string, expectedPassword: string) => {
  const expectedBuffer = Buffer.from(expectedPassword);
  const providedBuffer = Buffer.from(providedPassword);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

const getSessionIdFromCookies = (cookieValue: unknown) => (typeof cookieValue === 'string' ? cookieValue : undefined);

const isSessionAuthenticated = (sessions: Map<string, number>, sessionId: string | undefined) => {
  if (!sessionId) {
    return false;
  }

  const expiresAt = sessions.get(sessionId);
  if (!expiresAt) {
    return false;
  }

  if (Date.now() > expiresAt) {
    sessions.delete(sessionId);
    return false;
  }

  return true;
};

const isKitchenAuthenticated = (sessionId: string | undefined) => isSessionAuthenticated(kitchenSessions, sessionId);
const isAdminAuthenticated = (sessionId: string | undefined) => isSessionAuthenticated(adminSessions, sessionId);

const requireKitchenAuth: express.RequestHandler = (request, response, next) => {
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.sessionCookieName]);
  if (!isKitchenAuthenticated(sessionId)) {
    response.status(401).json({ message: 'Acceso restringido.' });
    return;
  }

  next();
};

const requireAdminAuth: express.RequestHandler = (request, response, next) => {
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.adminSessionCookieName]);
  if (!isAdminAuthenticated(sessionId)) {
    response.status(401).json({ message: 'Acceso restringido.' });
    return;
  }

  next();
};

const buildGeminiSessionToken = async (): Promise<SessionTokenResponse> => {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
  const newSessionExpiresAt = new Date(Date.now() + 1000 * 60 * 5).toISOString();

  const ai = new GoogleGenAI({
    apiKey: serverConfig.geminiApiKey,
    httpOptions: {
      apiVersion: 'v1alpha',
    },
  });

  const token = await ai.authTokens.create({
    config: {
      uses: 3,
      expireTime: expiresAt,
      newSessionExpireTime: newSessionExpiresAt,
      liveConnectConstraints: {
        model: serverConfig.geminiLiveModel,
        config: {
          responseModalities: [Modality.AUDIO],
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: true,
            },
            activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          },
        },
        },
      lockAdditionalFields: [],
    },
  });

  return {
    provider: 'gemini',
    token: token.name ?? '',
    expiresAt,
    newSessionExpiresAt,
    model: serverConfig.geminiLiveModel,
    apiVersion: 'v1alpha',
  };
};

const buildOpenAiSessionConfig = (): SessionTokenResponse => ({
  provider: 'openai',
  mode: 'unified',
  model: serverConfig.openAiRealtimeModel,
  endpoint: '/api/session/openai',
  voice: serverConfig.openAiVoice,
});

function buildKitchenAnnouncementPrompt(text: string) {
  return [
    'Lee este aviso para cocina en espanol de Espana.',
    'Habla con energia, picardia y personalidad.',
    'Menos tranquilo y mas vivo, como un companero espabilado de cocina.',
    'Ritmo agil, tono divertido, claro y directo.',
    'No inventes nada ni anadas informacion.',
    `Aviso: ${text}`,
  ].join(' ');
}

async function synthesizeKitchenAnnouncement(text: string) {
  if (!serverConfig.geminiApiKey) {
    throw new Error('La voz de Ramiro no esta disponible en el servidor.');
  }

  const cacheKey = crypto.createHash('sha256').update(`${serverConfig.geminiKitchenTtsModel}:Puck:${text}`).digest('hex');
  const cached = kitchenAnnouncementCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  if (cached) {
    kitchenAnnouncementCache.delete(cacheKey);
  }

  const ai = new GoogleGenAI({
    apiKey: serverConfig.geminiApiKey,
    httpOptions: {
      apiVersion: 'v1beta',
    },
  });

  const response = await ai.models.generateContent({
    model: serverConfig.geminiKitchenTtsModel,
    contents: buildKitchenAnnouncementPrompt(text),
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Puck',
          },
        },
      },
    },
  });

  const audioPart = response.candidates?.[0]?.content?.parts?.find(
    (part): part is typeof part & { inlineData: { data: string; mimeType?: string } } => 'inlineData' in part && Boolean(part.inlineData?.data),
  );

  if (!audioPart?.inlineData?.data) {
    throw new Error(`Gemini no devolvio audio para el aviso de cocina con el modelo ${serverConfig.geminiKitchenTtsModel}.`);
  }

  const payload = {
    audioBase64: audioPart.inlineData.data,
    mimeType: audioPart.inlineData.mimeType || 'audio/pcm;rate=24000',
    sampleRate: 24_000,
  };

  kitchenAnnouncementCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + 1000 * 60 * 30,
  });

  return payload;
}

const runGeminiLiveDiagnostics = async () => {
  if (!serverConfig.geminiApiKey) {
    return {
      provider: publicBranding.voiceProvider,
      geminiConfigured: false,
      openAiConfigured: Boolean(serverConfig.openAiApiKey),
      configuredModel: serverConfig.geminiLiveModel,
      tokenCheck: {
        ok: false,
        message: 'No hay clave Gemini configurada.',
      },
      liveCheck: {
        ok: false,
        message: 'No se puede probar Gemini Live sin clave.',
      },
    };
  }

  let tokenCheck: { ok: boolean; message: string } = {
    ok: false,
    message: 'No se ha probado el token.',
  };

  try {
    await buildGeminiSessionToken();
    tokenCheck = {
      ok: true,
      message: 'El servidor puede crear un token efimero de Gemini.',
    };
  } catch (error) {
    tokenCheck = {
      ok: false,
      message: error instanceof Error ? error.message : 'Gemini no ha permitido crear el token efimero.',
    };
  }

  let liveCheck: { ok: boolean; message: string } = {
    ok: false,
    message: 'No se ha probado la sesion Live.',
  };

  try {
    const ai = new GoogleGenAI({
      apiKey: serverConfig.geminiApiKey,
      httpOptions: {
        apiVersion: 'v1alpha',
      },
    });

    liveCheck = await new Promise<{ ok: boolean; message: string }>((resolve) => {
      let settled = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const finish = (payload: { ok: boolean; message: string }) => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(payload);
      };

      timeoutId = setTimeout(() => {
        finish({
          ok: false,
          message: 'Timeout al abrir la sesion Live desde servidor.',
        });
      }, 8_000);

      void ai.live
        .connect({
          model: serverConfig.geminiLiveModel,
          config: {
            responseModalities: [Modality.AUDIO],
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: true,
              },
              activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            },
          },
          callbacks: {
            onopen: () => {
              finish({
                ok: true,
                message: 'El servidor ha abierto una sesion Gemini Live correctamente.',
              });
            },
            onclose: (event) => {
              finish({
                ok: false,
                message: `Gemini Live ha cerrado la sesion de prueba. Codigo ${event.code}${event.reason ? `, motivo: ${event.reason}` : ''}.`,
              });
            },
            onerror: (error) => {
              finish({
                ok: false,
                message: error.message || 'Gemini Live ha fallado durante la prueba de conexion.',
              });
            },
            onmessage: () => undefined,
          },
        })
        .then((session) => {
          if (!settled) {
            session.close();
          }
        })
        .catch((error) => {
          finish({
            ok: false,
            message: error instanceof Error ? error.message : 'No se ha podido abrir la sesion Live desde servidor.',
          });
        });
    });
  } catch (error) {
    liveCheck = {
      ok: false,
      message: error instanceof Error ? error.message : 'No se ha podido inicializar la prueba Live.',
    };
  }

  return {
    provider: publicBranding.voiceProvider,
    geminiConfigured: true,
    openAiConfigured: Boolean(serverConfig.openAiApiKey),
    configuredModel: serverConfig.geminiLiveModel,
    tokenCheck,
    liveCheck,
  };
};

const getAdminSettings = async (): Promise<AdminSettings> => {
  const store = await appStore.read();
  return {
    showWifiPopup: store.settings.showWifiPopup || false,
    wifiSsid: store.settings.wifiSsid || '',
    wifiPassword: store.settings.wifiPassword || '',
  };
};

const buildPublicConfig = async () => {
  const settings = await getAdminSettings();
  return {
    ...publicBranding,
    showWifiPopup: settings.showWifiPopup,
    wifiSsid: settings.wifiSsid,
    wifiPassword: settings.wifiPassword,
  };
};

app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(serverConfig.uploadsDirPath));

app.get('/api/config', async (_request, response) => {
  response.json(await buildPublicConfig());
});

app.get('/api/debug/voice', async (_request, response) => {
  try {
    if (!serverConfig.geminiApiKey) {
      response.json({
        provider: publicBranding.voiceProvider,
        geminiConfigured: false,
        openAiConfigured: Boolean(serverConfig.openAiApiKey),
        configuredModel: serverConfig.geminiLiveModel,
        tokenCheck: {
          ok: false,
          message: 'Gemini no esta configurado.',
        },
        liveCheck: {
          ok: false,
          message: 'No se ha ejecutado la prueba Live.',
        },
      });
      return;
    }

    response.json(await runGeminiLiveDiagnostics());
  } catch (error) {
    response.status(500).json({
      provider: publicBranding.voiceProvider,
      geminiConfigured: Boolean(serverConfig.geminiApiKey),
      openAiConfigured: Boolean(serverConfig.openAiApiKey),
      configuredModel: serverConfig.geminiLiveModel,
      tokenCheck: {
        ok: false,
        message: 'No se ha podido completar el diagnostico.',
      },
      liveCheck: {
        ok: false,
        message: error instanceof Error ? error.message : 'Error inesperado en el diagnostico.',
      },
    });
  }
});

app.get('/api/menu', async (_request, response) => {
  const menu = await getMenu();
  response.json(menu);
});

app.get('/api/menu/events', async (request, response) => {
  const scope = typeof request.query.scope === 'string' ? request.query.scope.trim() : 'public';
  const wantsAdminScope = scope === 'admin';

  if (wantsAdminScope) {
    const adminSessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.adminSessionCookieName]);
    if (!isAdminAuthenticated(adminSessionId)) {
      response.status(401).json({ message: 'Acceso restringido.' });
      return;
    }
  }

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const sendSnapshot = async () => {
    const payload: MenuEventPayload = {
      type: 'snapshot',
      menu: wantsAdminScope ? await getAdminMenu() : await getMenu(),
    };

    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  await sendSnapshot();

  const unsubscribe = appStore.subscribeToMenu(async () => {
    await sendSnapshot();
  });

  const heartbeat = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, serverConfig.sseHeartbeatMs);

  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    response.end();
  });
});

app.get('/api/orders', async (request, response) => {
  const tableNumber = typeof request.query.table === 'string' ? request.query.table.trim() : undefined;

  if (!tableNumber) {
    const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.sessionCookieName]);
    const adminSessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.adminSessionCookieName]);
    if (!isKitchenAuthenticated(sessionId) && !isAdminAuthenticated(adminSessionId)) {
      response.status(401).json({ message: 'Acceso restringido.' });
      return;
    }
  }

  const orders = await listOrders(tableNumber);
  response.json(orders);
});

app.get('/api/orders/events', async (request, response) => {
  const tableNumber = typeof request.query.table === 'string' ? request.query.table.trim() : undefined;
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.sessionCookieName]);
  const adminSessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.adminSessionCookieName]);

  if (!tableNumber && !isKitchenAuthenticated(sessionId) && !isAdminAuthenticated(adminSessionId)) {
    response.status(401).json({ message: 'Acceso restringido.' });
    return;
  }

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const sendSnapshot = async () => {
    const payload: OrdersEventPayload = {
      type: 'snapshot',
      orders: await listOrders(tableNumber),
      tableNumber,
    };

    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  await sendSnapshot();

  const unsubscribe = appStore.subscribeToOrders(async () => {
    await sendSnapshot();
  });

  const heartbeat = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, serverConfig.sseHeartbeatMs);

  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    response.end();
  });
});

app.post('/api/orders', async (request, response) => {
  try {
    const payload = createOrderSchema.parse(request.body) as CreateOrderRequest;
    const order = await createOrder(payload);
    response.status(201).json(order);
  } catch (error) {
    const serviceError = toServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.patch('/api/orders/:orderId/status', requireKitchenAuth, async (request, response) => {
  try {
    const { status } = updateOrderSchema.parse(request.body);
    const orderId = Array.isArray(request.params.orderId) ? request.params.orderId[0] : request.params.orderId;
    const order = await updateOrderStatus(orderId, status);
    response.json(order);
  } catch (error) {
    const serviceError = toServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.delete('/api/orders/served', requireKitchenAuth, async (_request, response) => {
  try {
    const orders = await clearServedOrders();
    response.json(orders);
  } catch (error) {
    const serviceError = toServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.post('/api/kitchen/announce', requireKitchenAuth, async (request, response) => {
  try {
    const { text } = kitchenAnnouncementSchema.parse(request.body);
    const payload = await synthesizeKitchenAnnouncement(text);
    response.json(payload);
  } catch (error) {
    const serviceError = toServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.get('/api/auth/session', (request, response) => {
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.sessionCookieName]);
  const session: SessionStatusResponse = {
    authenticated: isKitchenAuthenticated(sessionId),
    kitchenName: publicBranding.kitchenName,
  };

  response.json(session);
});

app.post('/api/auth/login', (request, response) => {
  const { password } = loginSchema.parse(request.body);

  if (!safePasswordMatch(password, serverConfig.kitchenPassword)) {
    response.status(401).json({ message: 'Contrasena incorrecta.' });
    return;
  }

  const sessionId = crypto.randomUUID();
  kitchenSessions.set(sessionId, Date.now() + serverConfig.sessionDurationMs);

  response.cookie(serverConfig.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: serverConfig.isProduction,
    maxAge: serverConfig.sessionDurationMs,
  });

  response.status(204).end();
});

app.post('/api/auth/logout', (request, response) => {
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.sessionCookieName]);
  if (sessionId) {
    kitchenSessions.delete(sessionId);
  }

  response.clearCookie(serverConfig.sessionCookieName);
  response.status(204).end();
});

app.get('/api/admin/auth/session', (request, response) => {
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.adminSessionCookieName]);
  const session: AdminSessionStatusResponse = {
    authenticated: isAdminAuthenticated(sessionId),
    restaurantName: publicBranding.restaurantName,
  };

  response.json(session);
});

app.post('/api/admin/auth/login', (request, response) => {
  const { password } = loginSchema.parse(request.body);

  if (!safePasswordMatch(password, serverConfig.adminPassword)) {
    response.status(401).json({ message: 'Contrasena incorrecta.' });
    return;
  }

  const sessionId = crypto.randomUUID();
  adminSessions.set(sessionId, Date.now() + serverConfig.sessionDurationMs);

  response.cookie(serverConfig.adminSessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: serverConfig.isProduction,
    maxAge: serverConfig.sessionDurationMs,
  });

  response.status(204).end();
});

app.post('/api/admin/auth/logout', (request, response) => {
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.adminSessionCookieName]);
  if (sessionId) {
    adminSessions.delete(sessionId);
  }

  response.clearCookie(serverConfig.adminSessionCookieName);
  response.status(204).end();
});

app.post('/api/admin/uploads/image', requireAdminAuth, (request, response) => {
  uploadImage.single('image')(request, response, (error) => {
    if (error) {
      const message =
        error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
          ? 'La imagen supera el limite de 5 MB.'
          : error instanceof Error
            ? error.message
            : 'No se pudo subir la imagen.';
      response.status(400).json({ message });
      return;
    }

    if (!request.file) {
      response.status(400).json({ message: 'Falta el archivo de imagen.' });
      return;
    }

    const payload: UploadImageResponse = {
      imageUrl: `/uploads/${request.file.filename}`,
    };

    response.status(201).json(payload);
  });
});

app.get('/api/admin/menu', requireAdminAuth, async (_request, response) => {
  response.json(await getAdminMenu());
});

app.get('/api/admin/tables', requireAdminAuth, async (_request, response) => {
  response.json(await listTables());
});

app.get('/api/admin/orders', requireAdminAuth, async (_request, response) => {
  response.json(await listOrders());
});

app.get('/api/admin/settings', requireAdminAuth, async (_request, response) => {
  response.json(await getAdminSettings());
});

app.patch('/api/admin/settings', requireAdminAuth, async (request, response) => {
  const payload = adminSettingsSchema.parse(request.body) as UpdateAdminSettingsRequest;
  const nextState = await appStore.update((current) => ({
    ...current,
    settings: {
      showWifiPopup: payload.showWifiPopup,
      wifiSsid: payload.wifiSsid,
      wifiPassword: payload.wifiPassword,
    },
  }));

  response.json(nextState.settings);
});

app.post('/api/admin/tables', requireAdminAuth, async (request, response) => {
  try {
    const payload = tableSchema.parse(request.body) as CreateAdminTableRequest;
    const tables = await createTable(payload);
    response.status(201).json(tables);
  } catch (error) {
    const serviceError = toTablesServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.patch('/api/admin/tables/:tableId', requireAdminAuth, async (request, response) => {
  try {
    const payload = tableUpdateSchema.parse(request.body) as UpdateAdminTableRequest;
    const tableId = Array.isArray(request.params.tableId) ? request.params.tableId[0] : request.params.tableId;
    const tables = await updateTable(tableId, payload);
    response.json(tables);
  } catch (error) {
    const serviceError = toTablesServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.patch('/api/admin/tables/:tableId/status', requireAdminAuth, async (request, response) => {
  try {
    const payload = tableStatusSchema.parse(request.body) as UpdateAdminTableStatusRequest;
    const tableId = Array.isArray(request.params.tableId) ? request.params.tableId[0] : request.params.tableId;
    const tables = await updateTableStatus(tableId, payload.active);
    response.json(tables);
  } catch (error) {
    const serviceError = toTablesServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.delete('/api/admin/tables/:tableId', requireAdminAuth, async (request, response) => {
  try {
    const tableId = Array.isArray(request.params.tableId) ? request.params.tableId[0] : request.params.tableId;
    const tables = await deleteTable(tableId);
    response.json(tables);
  } catch (error) {
    const serviceError = toTablesServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.get('/api/admin/tables/:tableId/qr', requireAdminAuth, async (request, response) => {
  try {
    const { origin } = tableQrQuerySchema.parse(request.query);
    const tableId = Array.isArray(request.params.tableId) ? request.params.tableId[0] : request.params.tableId;
    const payload: TableQrResponse = await getTableQr(tableId, { origin });
    response.json(payload);
  } catch (error) {
    const serviceError = toTablesServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.post('/api/admin/tables/:tableId/print', requireAdminAuth, async (request, response) => {
  try {
    const { origin } = tableQrBodySchema.parse(request.body);
    const tableId = Array.isArray(request.params.tableId) ? request.params.tableId[0] : request.params.tableId;
    const payload: TableQrResponse = await getTableQr(tableId, { origin });
    response.json(payload);
  } catch (error) {
    const serviceError = toTablesServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.post('/api/admin/tables/print-batch', requireAdminAuth, async (request, response) => {
  try {
    const payload = tablesQrBatchSchema.parse(request.body);
    const batch: TablesQrBatchResponse = await getTablesQrBatch(payload);
    response.json(batch);
  } catch (error) {
    const serviceError = toTablesServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.post('/api/admin/menu/items', requireAdminAuth, async (request, response) => {
  try {
    const payload = menuItemSchema.parse(request.body) as CreateMenuItemRequest;
    const menu = await createMenuItem(payload);
    response.status(201).json(menu);
  } catch (error) {
    const serviceError = toMenuServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.patch('/api/admin/menu/items/:itemId', requireAdminAuth, async (request, response) => {
  try {
    const payload = menuItemUpdateSchema.parse(request.body) as UpdateMenuItemRequest;
    const itemId = Array.isArray(request.params.itemId) ? request.params.itemId[0] : request.params.itemId;
    const menu = await updateMenuItem(itemId, payload);
    response.json(menu);
  } catch (error) {
    const serviceError = toMenuServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.patch('/api/admin/menu/items/:itemId/availability', requireAdminAuth, async (request, response) => {
  try {
    const payload = availabilitySchema.parse(request.body) as UpdateMenuItemAvailabilityRequest;
    const itemId = Array.isArray(request.params.itemId) ? request.params.itemId[0] : request.params.itemId;
    const menu = await updateMenuItemAvailability(itemId, payload.available);
    response.json(menu);
  } catch (error) {
    const serviceError = toMenuServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.delete('/api/admin/menu/items/:itemId', requireAdminAuth, async (request, response) => {
  try {
    const itemId = Array.isArray(request.params.itemId) ? request.params.itemId[0] : request.params.itemId;
    const menu = await deleteMenuItem(itemId);
    response.json(menu);
  } catch (error) {
    const serviceError = toMenuServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.post('/api/admin/menu/reorder', requireAdminAuth, async (request, response) => {
  try {
    const payload = reorderMenuSchema.parse(request.body) as ReorderMenuRequest;
    const menu = await reorderMenu(payload);
    response.json(menu);
  } catch (error) {
    const serviceError = toMenuServiceError(error);
    response.status(serviceError.status).json({ message: serviceError.message });
  }
});

app.post('/api/session/token', async (_request, response) => {
  try {
    if (serverConfig.geminiApiKey) {
      try {
        const payload = await buildGeminiSessionToken();
        response.json(payload);
        return;
      } catch (error) {
        console.error('[voice] Gemini no ha podido abrir sesion, se intentara OpenAI:', error);

        if (!serverConfig.openAiApiKey) {
          response.status(502).json({
            message: 'Gemini esta configurado pero la clave no es valida o no tiene acceso al modelo Live.',
          });
          return;
        }
      }
    }

    if (serverConfig.openAiApiKey) {
      response.json(buildOpenAiSessionConfig());
      return;
    }

    response.status(503).json({ message: 'La voz no esta configurada en el servidor.' });
  } catch (error) {
    console.error('[voice] No se pudo preparar la sesion de voz:', error);
    response.status(500).json({ message: 'No se pudo abrir una sesion de voz.' });
  }
});

app.post('/api/session/openai', express.text({ type: ['application/sdp', 'text/plain'] }), async (request, response) => {
  if (!serverConfig.openAiApiKey) {
    response.status(503).send('OpenAI no esta configurado en el servidor.');
    return;
  }

  const sdpOffer = typeof request.body === 'string' ? request.body : '';
  if (!sdpOffer.trim()) {
    response.status(400).send('Falta la oferta SDP.');
    return;
  }

  try {
    const openAiResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverConfig.openAiApiKey}`,
        'Content-Type': 'application/sdp',
      },
      body: sdpOffer,
    });

    const answerSdp = await openAiResponse.text();
    const requestId = openAiResponse.headers.get('x-request-id');

    if (!openAiResponse.ok) {
      console.error('[voice] OpenAI realtime ha fallado:', {
        status: openAiResponse.status,
        requestId,
        body: answerSdp,
      });
      response.status(openAiResponse.status).send(answerSdp || 'No se pudo abrir la sesion OpenAI.');
      return;
    }

    if (requestId) {
      response.setHeader('X-OpenAI-Request-Id', requestId);
    }
    response.setHeader('Content-Type', 'application/sdp');
    response.send(answerSdp);
  } catch (error) {
    console.error('[voice] No se pudo negociar la sesion OpenAI:', error);
    response.status(500).send('No se pudo abrir la sesion OpenAI.');
  }
});

if (serverConfig.isProduction) {
  app.use(express.static(serverConfig.frontendDistPath));

  app.use((request, response, next) => {
    if (request.path.startsWith('/api')) {
      next();
      return;
    }

    response.sendFile(path.join(serverConfig.frontendDistPath, 'index.html'));
  });
}

const bootstrap = async () => {
  await seedLegacyOrdersFromSheetIfNeeded();
  await getMenu();

  console.log(
    `[config] Voz: ${publicBranding.voiceProvider} | Gemini: ${serverSecretsState.hasGeminiApiKey ? 'configurado' : 'ausente'} | OpenAI: ${serverSecretsState.hasOpenAiApiKey ? 'configurado' : 'ausente'} | Modelo Gemini: ${serverVoiceState.effectiveGeminiLiveModel}`,
  );

  if (serverVoiceState.geminiLiveModelWasMigrated) {
    console.warn(
      `[voice] Modelo Gemini migrado automaticamente de ${serverVoiceState.configuredGeminiLiveModel} a ${serverVoiceState.effectiveGeminiLiveModel}.`,
    );
  }

  app.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`Servidor escuchando en http://${serverConfig.host}:${serverConfig.port}`);
  });
};

bootstrap().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error);
  process.exitCode = 1;
});
