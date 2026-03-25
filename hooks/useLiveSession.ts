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
import { fetchVoiceDiagnostics } from '../utils/api';
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

const MAX_RECORDING_MS = 120_000;

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
  const [turnState, setTurnState] = useState<VoiceTurnState>('idle');
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
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

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((source) => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    modelTurnCompleteRef.current = false;
  }, []);

  const getAudioContextClass = useCallback(() => {
    return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  }, []);

  const resetSession = useCallback(
    (nextStatus: ConnectionStatus) => {
      clearRecordingTimeout();
      shouldStreamAudioRef.current = false;
      pendingPressRef.current = false;
      sessionPromiseRef.current = null;

      const activeSession = sessionRef.current;
      sessionRef.current = null;
      activeSession?.close();
      geminiSessionRef.current = null;

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

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      stopPlayback();
      transcriptRef.current = '';
      hasRunDiagnosticsRef.current = false;
      setLastAssistantMessage('');
      setVolumeLevel(0);
      setTurnStateSafe(nextStatus === 'error' ? 'error' : 'idle');
      setStatusSafe(nextStatus);
    },
    [clearRecordingTimeout, setStatusSafe, setTurnStateSafe, stopPlayback],
  );

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    addLog('system', 'Sesion cerrada.');
    resetSession('disconnected');
  }, [addLog, resetSession]);

  const runVoiceDiagnostics = useCallback(async () => {
    if (hasRunDiagnosticsRef.current) {
      return;
    }

    hasRunDiagnosticsRef.current = true;

    try {
      const diagnostics = await fetchVoiceDiagnostics();
      addLog(diagnostics.tokenCheck.ok ? 'system' : 'error', `Diagnostico token: ${diagnostics.tokenCheck.message}`);
      addLog(diagnostics.liveCheck.ok ? 'system' : 'error', `Diagnostico Live: ${diagnostics.liveCheck.message}`);
    } catch (error) {
      addLog(
        'error',
        error instanceof Error ? `No se ha podido leer el diagnostico: ${error.message}` : 'No se ha podido leer el diagnostico de voz.',
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
        menu,
      }),
    [branding.assistantName, branding.restaurantName, clientName, dinersCount, menu, tableNumber],
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

  const ensureAudioPipeline = useCallback(async () => {
    if (mediaStreamRef.current && inputProcessorRef.current) {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) {
      throw new Error('Este navegador no soporta audio en tiempo real.');
    }

    const captureContext = new AudioContextClass({ sampleRate: 16_000 });
    const playbackContext = new AudioContextClass({ sampleRate: 24_000 });
    inputContextRef.current = captureContext;
    audioContextRef.current = playbackContext;

    const source = captureContext.createMediaStreamSource(stream);
    const processor = captureContext.createScriptProcessor(4096, 1, 1);
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
    processor.connect(captureContext.destination);

    await captureContext.resume();
    await playbackContext.resume();
  }, [getAudioContextClass]);

  const finalizeTurnIfReady = useCallback(() => {
    if (sourcesRef.current.size > 0) {
      return;
    }

    if (turnStateRef.current !== 'recording') {
      setTurnStateSafe('idle');
      setVolumeLevel(0);
    }
  }, [setTurnStateSafe]);

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

    clearRecordingTimeout();
    pendingPressRef.current = true;
    cancelCurrentResponse();
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
        setTurnStateSafe('processing');
        addLog('system', 'Audio enviado por limite de tiempo.');
      }
    }, MAX_RECORDING_MS);
  }, [addLog, cancelCurrentResponse, clearRecordingTimeout, setTurnStateSafe]);

  const ensureGeminiSession = useCallback(async () => {
    if (statusRef.current === 'connected' && geminiSessionRef.current) {
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

      const token = await createSessionToken();
      if (token.provider !== 'gemini') {
        throw new Error('El modo push-to-talk solo esta habilitado para Gemini en esta version.');
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
          ...(branding.showDebugTools
            ? {
                inputAudioTranscription: {},
                outputAudioTranscription: {},
              }
            : {}),
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
            setStatusSafe('connected');
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

            const inputTranscript = message.serverContent?.inputTranscription?.text?.trim();
            if (inputTranscript) {
              addLog('system', `Tu voz: ${inputTranscript}`);
            }

            const outputTranscript = message.serverContent?.outputTranscription?.text?.trim();
            if (outputTranscript) {
              setLastAssistantMessage(outputTranscript);
              addLog('assistant', outputTranscript);
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

              geminiSessionRef.current?.sendToolResponse({ functionResponses: responses });
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.find((part) => 'inlineData' in part && part.inlineData?.data)?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
              const audioContext = audioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);

              const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), audioContext, 24_000);
              const source = audioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioContext.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              setTurnStateSafe('speaking');

              sourcesRef.current.add(source);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (modelTurnCompleteRef.current) {
                  finalizeTurnIfReady();
                }
              };
            }

            if (message.serverContent?.interrupted) {
              stopPlayback();
              addLog('system', 'Respuesta interrumpida para escuchar una nueva instruccion.');
            }

            if (message.serverContent?.turnComplete) {
              modelTurnCompleteRef.current = true;
              finalizeTurnIfReady();
            }
          },
          onclose: (event) => {
            geminiSessionRef.current = null;
            sessionRef.current = null;
            sessionPromiseRef.current = null;
            const code = typeof event?.code === 'number' ? ` Codigo: ${event.code}.` : '';
            const reason = typeof event?.reason === 'string' && event.reason.trim() ? ` Motivo: ${event.reason}.` : '';
            addLog('system', `La conexion de voz de Gemini se ha cerrado.${code}${reason}`);

            if (!manualDisconnectRef.current) {
              void runVoiceDiagnostics();
              setTurnStateSafe('error');
              setStatusSafe('error');
            } else {
              setTurnStateSafe('idle');
              setStatusSafe('disconnected');
            }
          },
          onerror: (error) => {
            addLog('error', error.message || 'Se ha producido un error en la sesion de Gemini.');
            void runVoiceDiagnostics();
            setTurnStateSafe('error');
            setStatusSafe('error');
          },
        },
      });

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
    ensureAudioPipeline,
    finalizeTurnIfReady,
    geminiTools,
    runTool,
    runVoiceDiagnostics,
    setStatusSafe,
    setTurnStateSafe,
    stopPlayback,
    systemInstruction,
  ]);

  const beginPressToTalk = useCallback(async () => {
    if (!branding.voiceEnabled) {
      addLog('error', 'La voz no esta disponible en este entorno. Puedes seguir usando la carta manual.');
      setStatusSafe('error');
      setTurnStateSafe('error');
      return;
    }

    pendingPressRef.current = true;

    try {
      await ensureGeminiSession();
      if (!pendingPressRef.current) {
        return;
      }

      startRecordingInternal();
    } catch (connectionError) {
      const message = connectionError instanceof Error ? connectionError.message : 'No se pudo iniciar la sesion de voz.';
      addLog('error', message);
      void runVoiceDiagnostics();
      setStatusSafe('error');
      setTurnStateSafe('error');
    }
  }, [addLog, branding.voiceEnabled, ensureGeminiSession, runVoiceDiagnostics, setStatusSafe, setTurnStateSafe, startRecordingInternal]);

  const endPressToTalk = useCallback(() => {
    pendingPressRef.current = false;

    if (turnStateRef.current !== 'recording' || !geminiSessionRef.current) {
      return;
    }

    clearRecordingTimeout();
    shouldStreamAudioRef.current = false;
    geminiSessionRef.current.sendRealtimeInput({ activityEnd: {} });
    setTurnStateSafe('processing');
    setVolumeLevel(0);
    addLog('system', 'Audio enviado a Ramiro.');
  }, [addLog, clearRecordingTimeout, setTurnStateSafe]);

  useEffect(() => () => resetSession('disconnected'), [resetSession]);

  return {
    status,
    turnState,
    beginPressToTalk,
    endPressToTalk,
    cancelCurrentResponse,
    disconnect,
    volumeLevel,
    logs,
    lastAssistantMessage,
  };
}
