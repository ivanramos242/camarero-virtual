import crypto from 'node:crypto';
import path from 'node:path';

import { GoogleGenAI } from '@google/genai';
import cookieParser from 'cookie-parser';
import express from 'express';
import { z } from 'zod';

import type {
  AdminSessionStatusResponse,
  CreateMenuItemRequest,
  CreateOrderRequest,
  MenuEventPayload,
  OrderStatus,
  OrdersEventPayload,
  ReorderMenuRequest,
  SessionStatusResponse,
  SessionTokenResponse,
  UpdateMenuItemAvailabilityRequest,
  UpdateMenuItemRequest,
} from '../types.js';
import { publicBranding, serverConfig } from './config.js';
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
import { createOrder, listOrders, seedLegacyOrdersFromSheetIfNeeded, toServiceError, updateOrderStatus } from './orders.js';
import { appStore } from './store.js';

const app = express();
const kitchenSessions = new Map<string, number>();
const adminSessions = new Map<string, number>();

const orderStatusValues = ['pending', 'cooking', 'ready', 'served'] as const satisfies readonly OrderStatus[];

const createOrderSchema = z.object({
  tableNumber: z.string().trim().min(1).max(16),
  clientName: z.string().trim().max(80).optional(),
  diners: z.coerce.number().int().min(1).max(24),
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
  imageUrl: z.union([z.string().trim().url(), z.literal(''), z.null()]).optional(),
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
  const newSessionExpiresAt = new Date(Date.now() + 1000 * 60).toISOString();

  const ai = new GoogleGenAI({
    apiKey: serverConfig.geminiApiKey,
    httpOptions: {
      apiVersion: 'v1alpha',
    },
  });

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: newSessionExpiresAt,
      liveConnectConstraints: {
        model: serverConfig.geminiLiveModel,
      },
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

app.use(express.json());
app.use(cookieParser());

app.get('/api/config', (_request, response) => {
  response.json(publicBranding);
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

app.get('/api/admin/menu', requireAdminAuth, async (_request, response) => {
  response.json(await getAdminMenu());
});

app.get('/api/admin/orders', requireAdminAuth, async (_request, response) => {
  response.json(await listOrders());
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

  app.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`Servidor escuchando en http://${serverConfig.host}:${serverConfig.port}`);
  });
};

bootstrap().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error);
  process.exitCode = 1;
});
