import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FunctionDeclaration, GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';

import { buildSystemInstruction } from '../constants';
import type { AppBranding, CartItem, ConnectionStatus, LogMessage, MenuItem, SessionTokenResponse } from '../types';
import { base64ToUint8Array, createPcmBlob, decodeAudioData } from '../utils/audio';

interface UseLiveSessionProps {
  branding: AppBranding;
  tableNumber: string;
  menu: MenuItem[];
  createSessionToken: () => Promise<SessionTokenResponse>;
  onAddToCart: (item: MenuItem, quantity: number, notes?: string) => void;
  onRemoveFromOrder: (itemName: string) => void;
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
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const sessionRef = useRef<{ close: () => void } | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

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

  const resetSession = useCallback(
    (nextStatus: ConnectionStatus) => {
      const activeSession = sessionRef.current;
      sessionRef.current = null;

      if (activeSession) {
        activeSession.close();
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (inputProcessorRef.current) {
        inputProcessorRef.current.disconnect();
        inputProcessorRef.current = null;
      }

      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }

      if (inputContextRef.current) {
        void inputContextRef.current.close();
        inputContextRef.current = null;
      }

      sourcesRef.current.forEach((source) => source.stop());
      sourcesRef.current.clear();
      nextStartTimeRef.current = 0;
      setVolumeLevel(0);
      setStatus(nextStatus);
    },
    [],
  );

  const disconnect = useCallback(() => {
    addLog('system', 'Sesión cerrada.');
    resetSession('disconnected');
  }, [addLog, resetSession]);

  const systemInstruction = useMemo(
    () =>
      buildSystemInstruction({
        assistantName: branding.assistantName,
        restaurantName: branding.restaurantName,
        tableNumber,
        menu,
      }),
    [branding.assistantName, branding.restaurantName, menu, tableNumber],
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
          name: { type: Type.STRING, description: 'Nombre de la reserva o cliente' },
        },
        required: ['count'],
      },
    }),
    [],
  );

  const addToOrderTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'addToOrder',
      description: 'Añade un plato nuevo al pedido actual.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          itemName: { type: Type.STRING, description: 'Nombre exacto del plato' },
          quantity: { type: Type.NUMBER, description: 'Cantidad solicitada' },
          notes: { type: Type.STRING, description: 'Observaciones o cambios' },
        },
        required: ['itemName', 'quantity'],
      },
    }),
    [],
  );

  const removeFromOrderTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'removeFromOrder',
      description: 'Quita una unidad del plato indicado del pedido actual.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          itemName: { type: Type.STRING, description: 'Nombre del plato a corregir' },
        },
        required: ['itemName'],
      },
    }),
    [],
  );

  const confirmOrderTool: FunctionDeclaration = useMemo(
    () => ({
      name: 'confirmOrder',
      description: 'Confirma el pedido y lo envía a cocina.',
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

  const tools = useMemo(
    () => [
      {
        functionDeclarations: [getMenuTool, setDinersTool, addToOrderTool, removeFromOrderTool, confirmOrderTool, endSessionTool],
      },
    ],
    [addToOrderTool, confirmOrderTool, endSessionTool, getMenuTool, removeFromOrderTool, setDinersTool],
  );

  const connect = useCallback(async () => {
    if (!branding.voiceEnabled) {
      addLog('error', 'La voz no está disponible en este entorno. Puedes seguir usando la carta manual.');
      setStatus('error');
      return;
    }

    try {
      addLog('system', `Iniciando a ${branding.assistantName}...`);
      setStatus('connecting');

      const token = await createSessionToken();
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error('Este navegador no soporta audio en tiempo real.');
      }

      const playbackContext = new AudioContextClass({ sampleRate: 24_000 });
      const captureContext = new AudioContextClass({ sampleRate: 16_000 });
      audioContextRef.current = playbackContext;
      inputContextRef.current = captureContext;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const ai = new GoogleGenAI({
        apiKey: token.token,
        httpOptions: {
          apiVersion: token.apiVersion,
        },
      });

      const sessionPromise = ai.live.connect({
        model: token.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          tools,
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
            addLog('system', `Sesión de voz abierta con ${branding.assistantName}.`);
            setStatus('connected');

            const source = captureContext.createMediaStreamSource(stream);
            const processor = captureContext.createScriptProcessor(4096, 1, 1);
            inputProcessorRef.current = processor;

            processor.onaudioprocess = (event) => {
              if (isMuted) {
                return;
              }

              const inputData = event.inputBuffer.getChannelData(0);
              let energy = 0;
              for (let index = 0; index < inputData.length; index += 1) {
                energy += inputData[index] * inputData[index];
              }

              setVolumeLevel(Math.sqrt(energy / inputData.length));

              const pcmBlob = createPcmBlob(inputData);
              void sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(captureContext.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const textParts = message.serverContent?.modelTurn?.parts
              ?.map((part) => ('text' in part ? part.text : undefined))
              .filter((part): part is string => Boolean(part));

            if (textParts && textParts.length > 0) {
              const assistantText = textParts.join(' ').trim();
              setLastAssistantMessage(assistantText);
              addLog('assistant', assistantText);
            }

            if (message.toolCall) {
              const responses = [];

              for (const functionCall of message.toolCall.functionCalls) {
                let result: ToolResult = { success: true };

                if (functionCall.name === 'getMenu') {
                  result = { success: true, count: menuRef.current.length, message: 'La carta ya está en contexto.' };
                } else if (functionCall.name === 'setDiners') {
                  const args = functionCall.args as { count: number; name?: string };
                  onSetDiners(args.count, args.name);
                  addLog('system', `Mesa actualizada a ${args.count} comensales.`);
                  result = { success: true, message: `${args.count} comensales actualizados.` };
                } else if (functionCall.name === 'addToOrder') {
                  const args = functionCall.args as { itemName: string; quantity: number; notes?: string };
                  const item =
                    menuRef.current.find((menuItem) => menuItem.available && menuItem.name.toLowerCase().trim() === args.itemName.toLowerCase().trim()) ??
                    menuRef.current.find((menuItem) => menuItem.available && menuItem.name.toLowerCase().includes(args.itemName.toLowerCase()));

                  if (!item) {
                    result = { success: false, error: `El plato ${args.itemName} no está disponible.` };
                    addLog('error', result.error);
                  } else {
                    onAddToCart(item, args.quantity, args.notes);
                    addLog('system', `Añadido ${args.quantity}x ${item.name}.`);
                    result = { success: true, message: `${args.quantity}x ${item.name} añadidos.` };
                  }
                } else if (functionCall.name === 'removeFromOrder') {
                  const args = functionCall.args as { itemName: string };
                  onRemoveFromOrder(args.itemName);
                  addLog('system', `Corregido el pedido de ${args.itemName}.`);
                  result = { success: true, message: `Se ha actualizado ${args.itemName}.` };
                } else if (functionCall.name === 'confirmOrder') {
                  const success = await onConfirmOrder(dinersCountRef.current, clientNameRef.current, cartItemsRef.current);
                  result = success
                    ? { success: true, message: 'Pedido confirmado y enviado.' }
                    : { success: false, error: 'No se pudo confirmar el pedido.' };

                  addLog(success ? 'system' : 'error', success ? 'Pedido confirmado desde voz.' : 'La confirmación por voz ha fallado.');
                } else if (functionCall.name === 'endSession') {
                  result = { success: true, message: 'Sesión cerrada.' };
                  window.setTimeout(() => {
                    disconnect();
                  }, 1800);
                }

                responses.push({
                  id: functionCall.id,
                  name: functionCall.name,
                  response: { result },
                });
              }

              void sessionPromise.then((session) => {
                session.sendToolResponse({ functionResponses: responses });
              });
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
              const audioContext = audioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);

              const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), audioContext, 24_000);
              const source = audioContext.createBufferSource();
              const gainNode = audioContext.createGain();

              source.buffer = audioBuffer;
              source.connect(gainNode);
              gainNode.connect(audioContext.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;

              sourcesRef.current.add(source);
              source.onended = () => {
                sourcesRef.current.delete(source);
              };
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach((source) => source.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              addLog('system', 'Respuesta interrumpida para escuchar una nueva instrucción.');
            }
          },
          onclose: () => {
            addLog('system', 'La conexión de voz se ha cerrado.');
            resetSession('disconnected');
          },
          onerror: (error) => {
            addLog('error', error.message || 'Se ha producido un error en la sesión de voz.');
            resetSession('error');
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (connectionError) {
      const message =
        connectionError instanceof Error ? connectionError.message : 'No se pudo iniciar la sesión de voz.';
      addLog('error', message);
      resetSession('error');
    }
  }, [
    addLog,
    branding.assistantName,
    branding.restaurantName,
    branding.voiceEnabled,
    createSessionToken,
    disconnect,
    isMuted,
    onAddToCart,
    onConfirmOrder,
    onRemoveFromOrder,
    onSetDiners,
    resetSession,
    systemInstruction,
    tableNumber,
    tools,
  ]);

  useEffect(() => () => resetSession('disconnected'), [resetSession]);

  return {
    status,
    connect,
    disconnect,
    isMuted,
    setIsMuted,
    volumeLevel,
    logs,
    lastAssistantMessage,
  };
}
