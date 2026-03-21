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

  const sdpOffer = typeof request.body === 'string' ? request.body.trim() : '';
  if (!sdpOffer) {
    response.status(400).send('Falta la oferta SDP.');
    return;
  }

  try {
    const payload = new FormData();
    payload.append('sdp', sdpOffer);
    payload.append(
      'session',
      JSON.stringify({
        type: 'realtime',
        model: serverConfig.openAiRealtimeModel,
        voice: serverConfig.openAiVoice,
      }),
    );

    const openAiResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverConfig.openAiApiKey}`,
      },
      body: payload,
    });

    const answerSdp = await openAiResponse.text();

    if (!openAiResponse.ok) {
      console.error('[voice] OpenAI realtime ha fallado:', answerSdp);
      response.status(openAiResponse.status).send(answerSdp || 'No se pudo abrir la sesion OpenAI.');
      return;
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
