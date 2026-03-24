import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FunctionDeclaration, GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';

import { buildSystemInstruction } from '../constants';
import type {
  AppBranding,
  CartItem,
  ConnectionStatus,
  GeminiSessionTokenResponse,
  LogMessage,
  MenuItem,
  OpenAiSessionTokenResponse,
  SessionTokenResponse,
} from '../types';
import { createOpenAiRealtimeAnswer } from '../utils/api';
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

interface OpenAiRealtimeEvent {
  type: string;
  event_id?: string;
  delta?: string;
  item?: {
    type?: string;
    content?: Array<{ text?: string; transcript?: string }>;
  };
  response?: {
    output?: Array<{
      type?: string;
      content?: Array<{ text?: string; transcript?: string }>;
    }>;
  };
  name?: string;
  call_id?: string;
  arguments?: string;
  error?: {
    message?: string;
  };
}

const openAiVoiceToolSchema = {
  type: 'object',
  properties: {
    count: { type: 'number', description: 'Numero de comensales' },
    name: { type: 'string', description: 'Nombre del cliente o reserva' },
  },
  required: ['count'],
};

const openAiAddToolSchema = {
  type: 'object',
  properties: {
    itemName: { type: 'string', description: 'Nombre del plato' },
    quantity: { type: 'number', description: 'Cantidad' },
    notes: { type: 'string', description: 'Observaciones' },
  },
  required: ['itemName', 'quantity'],
};

const openAiRemoveToolSchema = {
  type: 'object',
  properties: {
    itemName: { type: 'string', description: 'Nombre del plato a corregir' },
  },
  required: ['itemName'],
};

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
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef('');

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
    mediaStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }, [isMuted]);

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

  const getAudioContextClass = useCallback(() => {
    return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  }, []);

  const resetSession = useCallback((nextStatus: ConnectionStatus) => {
    const activeSession = sessionRef.current;
    sessionRef.current = null;
    activeSession?.close();

    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    remoteAudioRef.current?.pause();
    remoteAudioRef.current = null;

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
    transcriptRef.current = '';
    setLastAssistantMessage('');
    setVolumeLevel(0);
    setStatus(nextStatus);
  }, []);

  const disconnect = useCallback(() => {
    addLog('system', 'Sesion cerrada.');
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
      description: 'Anade un plato nuevo al pedido actual.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          itemName: { type: Type.STRING, description: 'Nombre del plato' },
          quantity: { type: Type.NUMBER, description: 'Cantidad solicitada' },
          notes: { type: Type.STRING, description: 'Observaciones' },
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
        functionDeclarations: [getMenuTool, setDinersTool, addToOrderTool, removeFromOrderTool, confirmOrderTool, endSessionTool],
      },
    ],
    [addToOrderTool, confirmOrderTool, endSessionTool, getMenuTool, removeFromOrderTool, setDinersTool],
  );

  const openAiTools = useMemo(
    () => [
      { type: 'function', name: 'getMenu', description: 'Devuelve la carta disponible.' },
      { type: 'function', name: 'setDiners', description: 'Actualiza el numero de comensales.', parameters: openAiVoiceToolSchema },
      { type: 'function', name: 'addToOrder', description: 'Anade platos al pedido actual.', parameters: openAiAddToolSchema },
      { type: 'function', name: 'removeFromOrder', description: 'Quita una unidad del plato indicado.', parameters: openAiRemoveToolSchema },
      { type: 'function', name: 'confirmOrder', description: 'Confirma el pedido y lo envia a cocina.' },
      { type: 'function', name: 'endSession', description: 'Cierra la sesion cuando la conversacion haya terminado.' },
    ],
    [],
  );

  const runTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      let result: ToolResult = { success: true };

      if (name === 'getMenu') {
        result = { success: true, count: menuRef.current.length, message: 'La carta ya esta en contexto.' };
      } else if (name === 'setDiners') {
        const count = Number(args.count ?? 1);
        const nextName = typeof args.name === 'string' ? args.name : undefined;
        onSetDiners(count, nextName);
        addLog('system', `Mesa actualizada a ${count} comensales.`);
        result = { success: true, message: `${count} comensales actualizados.` };
      } else if (name === 'addToOrder') {
        const itemName = typeof args.itemName === 'string' ? args.itemName : '';
        const quantity = Number(args.quantity ?? 1);
        const notes = typeof args.notes === 'string' ? args.notes : undefined;
        const item =
          menuRef.current.find((menuItem) => menuItem.available && menuItem.name.toLowerCase().trim() === itemName.toLowerCase().trim()) ??
          menuRef.current.find((menuItem) => menuItem.available && menuItem.name.toLowerCase().includes(itemName.toLowerCase()));

        if (!item) {
          result = { success: false, error: `El plato ${itemName} no esta disponible.` };
          addLog('error', result.error);
        } else {
          onAddToCart(item, quantity, notes);
          addLog('system', `Anadido ${quantity}x ${item.name}.`);
          result = { success: true, message: `${quantity}x ${item.name} anadidos.` };
        }
      } else if (name === 'removeFromOrder') {
        const itemName = typeof args.itemName === 'string' ? args.itemName : '';
        onRemoveFromOrder(itemName);
        addLog('system', `Corregido el pedido de ${itemName}.`);
        result = { success: true, message: `Se ha actualizado ${itemName}.` };
      } else if (name === 'confirmOrder') {
        const success = await onConfirmOrder(dinersCountRef.current, clientNameRef.current, cartItemsRef.current);
        result = success
          ? { success: true, message: 'Pedido confirmado y enviado.' }
          : { success: false, error: 'No se pudo confirmar el pedido.' };
        addLog(success ? 'system' : 'error', success ? 'Pedido confirmado desde voz.' : 'La confirmacion por voz ha fallado.');
      } else if (name === 'endSession') {
        result = { success: true, message: 'Sesion cerrada.' };
        window.setTimeout(() => {
          disconnect();
        }, 1200);
      }

      return result;
    },
    [addLog, disconnect, onAddToCart, onConfirmOrder, onRemoveFromOrder, onSetDiners],
  );

  const setupVolumeMeter = useCallback(
    (stream: MediaStream, sampleRate: number) => {
      const AudioContextClass = getAudioContextClass();
      if (!AudioContextClass) {
        throw new Error('Este navegador no soporta audio en tiempo real.');
      }

      const captureContext = new AudioContextClass({ sampleRate });
      inputContextRef.current = captureContext;

      const source = captureContext.createMediaStreamSource(stream);
      const processor = captureContext.createScriptProcessor(4096, 1, 1);
      inputProcessorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        let energy = 0;

        for (let index = 0; index < inputData.length; index += 1) {
          energy += inputData[index] * inputData[index];
        }

        setVolumeLevel(Math.sqrt(energy / inputData.length));
      };

      source.connect(processor);
      processor.connect(captureContext.destination);

      return { captureContext, processor };
    },
    [getAudioContextClass],
  );

  const connectGemini = useCallback(
    async (token: GeminiSessionTokenResponse, stream: MediaStream) => {
      const AudioContextClass = getAudioContextClass();
      if (!AudioContextClass) {
        throw new Error('Este navegador no soporta audio en tiempo real.');
      }

      const playbackContext = new AudioContextClass({ sampleRate: 24_000 });
      audioContextRef.current = playbackContext;

      const { captureContext, processor } = setupVolumeMeter(stream, 16_000);
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
          tools: geminiTools,
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
            addLog('system', `Sesion de voz abierta con ${branding.assistantName} por Gemini.`);
            setStatus('connected');

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

              const pcmAudio = createPcmBlob(inputData);
              void sessionPromise.then((session) => {
                session.sendRealtimeInput({ audio: pcmAudio });
              });
            };
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
                const result = await runTool(functionCall.name, (functionCall.args as Record<string, unknown>) ?? {});
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
              source.buffer = audioBuffer;
              source.connect(audioContext.destination);
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
              addLog('system', 'Respuesta interrumpida para escuchar una nueva instruccion.');
            }
          },
          onclose: (event) => {
            const reason =
              typeof event?.reason === 'string' && event.reason.trim().length > 0
                ? ` Motivo: ${event.reason}.`
                : '';
            addLog('system', `La conexion de voz de Gemini se ha cerrado.${reason}`);
            resetSession('disconnected');
          },
          onerror: (error) => {
            addLog('error', error.message || 'Se ha producido un error en la sesion de Gemini.');
            resetSession('error');
          },
        },
      });

      sessionRef.current = await sessionPromise;
      void captureContext.resume();
    },
    [addLog, branding.assistantName, geminiTools, getAudioContextClass, isMuted, resetSession, runTool, setupVolumeMeter, systemInstruction],
  );

  const connectOpenAi = useCallback(
    async (token: OpenAiSessionTokenResponse, stream: MediaStream) => {
      setupVolumeMeter(stream, 16_000);

      const peerConnection = new RTCPeerConnection();
      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      peerConnectionRef.current = peerConnection;
      remoteAudioRef.current = remoteAudio;

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;

      peerConnection.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
        void remoteAudio.play().catch(() => undefined);
      };

      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

      const sendEvent = (event: Record<string, unknown>) => {
        if (dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify(event));
        }
      };

      dataChannel.onopen = () => {
        addLog('system', `Sesion de voz abierta con ${branding.assistantName} por OpenAI.`);
        setStatus('connected');
        sendEvent({
          type: 'session.update',
          session: {
            instructions: systemInstruction,
            voice: token.voice,
            tools: openAiTools,
            tool_choice: 'auto',
          },
        });
      };

      dataChannel.onclose = () => {
        addLog('system', 'La conexion de voz de OpenAI se ha cerrado.');
        resetSession('disconnected');
      };

      dataChannel.onerror = () => {
        addLog('error', 'Se ha producido un error en la sesion de OpenAI.');
        resetSession('error');
      };

      dataChannel.onmessage = (messageEvent) => {
        void (async () => {
          const event = JSON.parse(messageEvent.data) as OpenAiRealtimeEvent;

          if (event.type === 'response.audio_transcript.delta' || event.type === 'response.output_text.delta' || event.type === 'response.output_audio_transcript.delta') {
            transcriptRef.current += event.delta ?? '';
            setLastAssistantMessage(transcriptRef.current.trim());
            return;
          }

          if (event.type === 'response.created') {
            transcriptRef.current = '';
            return;
          }

          if (event.type === 'response.output_item.done' || event.type === 'response.done') {
            const outputItems = event.item ? [event.item] : event.response?.output ?? [];
            const assistantText = outputItems
              .flatMap((item) => item.content ?? [])
              .map((content) => content.transcript || content.text || '')
              .join(' ')
              .trim();

            if (assistantText) {
              setLastAssistantMessage(assistantText);
              addLog('assistant', assistantText);
            }
            return;
          }

          if (event.type === 'response.function_call_arguments.done') {
            const toolArgs = event.arguments ? (JSON.parse(event.arguments) as Record<string, unknown>) : {};
            const result = await runTool(event.name || '', toolArgs);

            sendEvent({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: event.call_id,
                output: JSON.stringify({ result }),
              },
            });
            sendEvent({ type: 'response.create' });
            return;
          }

          if (event.type === 'error') {
            addLog('error', event.error?.message || 'OpenAI ha devuelto un error en tiempo real.');
          }
        })();
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const answerSdp = await createOpenAiRealtimeAnswer(token.endpoint, offer.sdp || '');
      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      sessionRef.current = {
        close: () => {
          dataChannel.close();
          peerConnection.close();
          remoteAudio.pause();
          remoteAudio.srcObject = null;
        },
      };
    },
    [addLog, branding.assistantName, openAiTools, resetSession, runTool, setupVolumeMeter, systemInstruction],
  );

  const connect = useCallback(async () => {
    if (!branding.voiceEnabled) {
      addLog('error', 'La voz no esta disponible en este entorno. Puedes seguir usando la carta manual.');
      setStatus('error');
      return;
    }

    try {
      addLog('system', `Iniciando a ${branding.assistantName}...`);
      setStatus('connecting');

      const token = await createSessionToken();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });

      if (token.provider === 'gemini') {
        await connectGemini(token, stream);
        return;
      }

      await connectOpenAi(token, stream);
    } catch (connectionError) {
      const message =
        connectionError instanceof Error ? connectionError.message : 'No se pudo iniciar la sesion de voz.';
      addLog('error', message);
      resetSession('error');
    }
  }, [addLog, branding.assistantName, branding.voiceEnabled, connectGemini, connectOpenAi, createSessionToken, isMuted, resetSession]);

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
