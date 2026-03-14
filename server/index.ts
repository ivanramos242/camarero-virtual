import crypto from 'node:crypto';
import path from 'node:path';

import { GoogleGenAI } from '@google/genai';
import cookieParser from 'cookie-parser';
import express from 'express';
import { z } from 'zod';

import type { CreateOrderRequest, OrdersEventPayload, OrderStatus, SessionStatusResponse, SessionTokenResponse } from '../types.js';
import { publicBranding, serverConfig } from './config.js';
import { getMenu } from './menu.js';
import { createOrder, listOrders, seedLegacyOrdersFromSheetIfNeeded, toServiceError, updateOrderStatus } from './orders.js';
import { appStore } from './store.js';

const app = express();
const kitchenSessions = new Map<string, number>();

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

const safePasswordMatch = (providedPassword: string, expectedPassword: string) => {
  const expectedBuffer = Buffer.from(expectedPassword);
  const providedBuffer = Buffer.from(providedPassword);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

const getSessionIdFromCookies = (cookieValue: unknown) => (typeof cookieValue === 'string' ? cookieValue : undefined);

const isKitchenAuthenticated = (sessionId: string | undefined) => {
  if (!sessionId) {
    return false;
  }

  const expiresAt = kitchenSessions.get(sessionId);
  if (!expiresAt) {
    return false;
  }

  if (Date.now() > expiresAt) {
    kitchenSessions.delete(sessionId);
    return false;
  }

  return true;
};

const requireKitchenAuth: express.RequestHandler = (request, response, next) => {
  const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.sessionCookieName]);
  if (!isKitchenAuthenticated(sessionId)) {
    response.status(401).json({ message: 'Acceso restringido.' });
    return;
  }

  next();
};

app.use(express.json());
app.use(cookieParser());

app.get('/api/config', (_request, response) => {
  response.json(publicBranding);
});

app.get('/api/menu', async (_request, response) => {
  const menu = await getMenu();
  response.json(menu);
});

app.get('/api/orders', async (request, response) => {
  const tableNumber = typeof request.query.table === 'string' ? request.query.table.trim() : undefined;

  if (!tableNumber) {
    const sessionId = getSessionIdFromCookies(request.cookies?.[serverConfig.sessionCookieName]);
    if (!isKitchenAuthenticated(sessionId)) {
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

  if (!tableNumber && !isKitchenAuthenticated(sessionId)) {
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
    response.status(401).json({ message: 'Contraseña incorrecta.' });
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

app.post('/api/session/token', async (_request, response) => {
  if (!serverConfig.geminiApiKey) {
    response.status(503).json({ message: 'La voz no está configurada en el servidor.' });
    return;
  }

  try {
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

    const payload: SessionTokenResponse = {
      token: token.name ?? '',
      expiresAt,
      newSessionExpiresAt,
      model: serverConfig.geminiLiveModel,
      apiVersion: 'v1alpha',
    };

    response.json(payload);
  } catch (error) {
    console.error('[voice] No se pudo crear el token efímero:', error);
    response.status(500).json({ message: 'No se pudo abrir una sesión de voz.' });
  }
});

if (serverConfig.isProduction) {
  app.use(express.static(serverConfig.frontendDistPath));

  app.get('*', (request, response, next) => {
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

  app.listen(serverConfig.port, () => {
    console.log(`Servidor escuchando en http://127.0.0.1:${serverConfig.port}`);
  });
};

bootstrap().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error);
  process.exitCode = 1;
});
