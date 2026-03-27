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
- `/admin/login`: login de administracion.
- `/admin`: panel protegido para carta y revision operativa.
- `/admin/tables/:tableId/print`: ficha imprimible de QR por mesa.
- `/api/*`: API del backend.

## Variables de entorno

Copia `.env.example` a `.env` y rellena lo necesario.

Variables importantes:
- `KITCHEN_PASSWORD`: contrasena del personal.
- `ADMIN_PASSWORD`: contrasena del panel de administracion.
- `GEMINI_API_KEY`: clave del servidor para sesiones de voz.
- `GEMINI_LIVE_MODEL`: modelo Live que se quiere usar. Recomendado: `gemini-2.5-flash-native-audio-preview-12-2025`.
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

- No hace falta definir `PORT` ni `HOST` en variables de entorno.
- La app escucha en `0.0.0.0` y usa `3000` por defecto en produccion.
- Si EasyPanel inyecta `PORT`, la app lo respetara automaticamente.
- En EasyPanel el proxy port debe apuntar al puerto interno real de la app.

## Notas operativas

- La cocina ya no depende de memoria local del navegador.
- Los pedidos usan `crypto.randomUUID()` en servidor.
- El cliente no vacia el carrito hasta que el backend confirma el pedido.
- `/kitchen` requiere sesion por cookie `httpOnly`.
- `/admin` requiere sesion propia por cookie `httpOnly`.
- La carta editable vive ya en `data/store.json` y se actualiza en tiempo real por SSE.
- Las mesas y sus QRs se gestionan desde admin y se guardan en `data/store.json`.
- Las imagenes subidas desde admin se guardan en `data/uploads/` y se sirven por `/uploads/*`.
- Los QRs se generan con el dominio actual del navegador en admin; si cambia el dominio, basta con reimprimirlos.
- La voz ya no expone la `GEMINI_API_KEY` en el bundle del navegador.

## Funcionamiento actual de Ramiro

Estado actual recomendado: mantener esta arquitectura salvo que haya un problema muy concreto y medible.

### Flujo general

- El cliente usa push-to-talk: mantiene pulsado, habla y al soltar se envia el turno.
- Ramiro responde por audio con Gemini Live.
- El pedido se actualiza dentro de la propia app.
- La confirmacion final del pedido es obligatoria en dos pasos.

### Regla principal

- Ramiro lleva la conversacion y usa tools para `anadir`, `quitar` y `confirmar`.
- La app mantiene una red de seguridad local silenciosa para rescatar acciones si Gemini ha dicho que algo se hizo pero el carrito no quedo actualizado.
- No se usa voz local de fallback. La unica voz que debe oirse es la de Ramiro.

### Como se anaden y corrigen platos

- La carta completa se inyecta en el contexto de Gemini con nombres, IDs, categorias, ingredientes, alergenos y precio.
- Ramiro intenta usar `menuItemId` exacto cuando puede.
- Si el modelo no acierta el nombre exacto, la app hace matching local tolerante:
  - normaliza acentos y texto
  - elimina palabras vacias tipicas de voz
  - compara por nombre, categoria e ingredientes
- Si Gemini intenta una tool pero el carrito no cambia, la capa local puede rescatar la accion en silencio.

### Confirmacion del pedido

- `confirmOrder` no debe enviar a cocina en el primer intento.
- Primero se marca una confirmacion pendiente y Ramiro debe resumir el pedido.
- Solo cuando el cliente confirma explicitamente despues de ese resumen se envia a cocina.
- Si el carrito cambia, la confirmacion pendiente se invalida y hay que resumir otra vez.

### Anti-duplicados

- La app deduplica texto del modelo, transcripcion de salida y chunks de audio repetidos.
- Si Ramiro ya ha respondido en un turno, los rescates locales no vuelven a hablar por encima.

### Safari e iPhone

- Safari usa una capa especifica de `audioSession`:
  - al grabar: `play-and-record`
  - al responder: `playback`
- Al soltar el boton se libera la captura del micro con un pequeño retraso para ayudar a que el audio salga por el altavoz principal y no por el auricular pequeno.
- Este ajuste se mantiene porque ahora mismo da buen resultado en iPhone/Safari.

### Estado que conviene mantener

- Mantener tools de Gemini para pedido.
- Mantener el rescate local silencioso solo como red de seguridad.
- No volver a meter una segunda voz del navegador.
- No volver a meter una capa determinista agresiva por encima de Ramiro salvo que haya logs concretos que lo justifiquen.

### Si vuelve a fallar

Antes de tocar arquitectura otra vez, revisar por turno:

- transcript del cliente
- tool calls recibidas
- accion final aplicada al carrito
- mensaje de Ramiro
- si la confirmacion estaba pendiente o no

Si se hace una mejora futura, debe ser incremental y medible. La base actual ya esta pensada para equilibrio entre:

- buena conversacion
- acciones fiables
- una sola voz
- compatibilidad movil
