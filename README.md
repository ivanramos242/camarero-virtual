# camarero-virtual

App React + Vite para cliente y panel de cocina, con backend Express dentro del mismo repo.

## Arquitectura

- `frontend`: React, Vite, React Router y componentes de cliente/cocina.
- `backend`: Express + TypeScript.
- `persistencia`: JSON local en `data/store.json` como fuente de verdad.
- `integraciones`: Google Gemini Live para voz, CSV de Google Sheets para carta y webhook de n8n para replica operativa.

## Rutas

- `/`: acceso inicial y selector de mesa.
- `/mesa/:tableNumber`: experiencia cliente.
- `/kitchen/login`: login de cocina.
- `/kitchen`: panel protegido de cocina.
- `/api/*`: API del backend.

## Variables de entorno

Copia `.env.example` a `.env` y rellena lo necesario.

Variables importantes:

- `PORT`: puerto del backend.
- `HOST`: host de escucha del backend. En servidor debe ser `0.0.0.0`.
- `KITCHEN_PASSWORD`: contrasena del personal.
- `GEMINI_API_KEY`: clave del servidor para sesiones de voz.
- `GEMINI_LIVE_MODEL`: modelo Live que se quiere usar.
- `MENU_CSV_URL`: URL CSV publica de la carta.
- `ORDERS_CSV_URL`: URL CSV publica de pedidos legacy para import inicial.
- `N8N_WEBHOOK_URL`: webhook para replicar pedidos y estados.
- `RESTAURANT_NAME`, `ASSISTANT_NAME`, `KITCHEN_NAME`, `APP_TAGLINE`: branding visible.
- `SHOW_DEBUG_TOOLS`: muestra panel debug de voz en cliente.

## Desarrollo local

```bash
npm install
npm run dev
```

Esto levanta:

- Vite en `http://127.0.0.1:3000`
- API en `http://127.0.0.1:8787`

Vite proxifica `/api` al backend.

## Build

```bash
npm run lint
npm run build
```

Salidas:

- `dist/`: frontend de produccion.
- `dist-server/`: backend compilado.

## Produccion

```bash
npm run build
npm run start
```

En produccion el backend sirve tambien el frontend compilado desde `dist/`.

Para contenedor/EasyPanel:

- El contenedor escucha por defecto en `0.0.0.0:3000`.
- Si EasyPanel inyecta otro `PORT`, la app lo respetara automaticamente.
- Configura el puerto interno del servicio en EasyPanel a `3000` si no estas usando una variable `PORT` propia.

## Notas operativas

- La cocina ya no depende de memoria local del navegador.
- Los pedidos usan `crypto.randomUUID()` en servidor.
- El cliente no vacia el carrito hasta que el backend confirma el pedido.
- `/kitchen` requiere sesion por cookie `httpOnly`.
- La voz ya no expone la `GEMINI_API_KEY` en el bundle del navegador.
