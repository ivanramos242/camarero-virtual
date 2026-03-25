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
const VOICE_CLIENT_BUILD = 'ptt-v2-no-explicit-vad';
const PLAYBACK_GAIN = 2.15;
const CAPTURE_IDLE_TEARDOWN_MS = 12_000;

const VOICE_STOP_WORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'con',
  'sin',
  'para',
  'por',
  'favor',
  'quiero',
  'queria',
  'me',
  'pon',
  'ponme',
  'ponnos',
  'trae',
  'traeme',
  'traenos',
  'dame',
  'danos',
  'anade',
  'añade',
  'pedido',
  'plato',
  'platos',
  'racion',
  'ración',
]);

function normalizeVoiceText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeVoiceText(value: string) {
  return normalizeVoiceText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !VOICE_STOP_WORDS.has(token));
}

function resolveMenuItemFromVoiceQuery(items: MenuItem[], rawQuery: string) {
  const query = normalizeVoiceText(rawQuery);
  const queryTokens = tokenizeVoiceText(rawQuery);

  if (!query) {
    return null;
  }

  let bestMatch: { item: MenuItem; score: number } | null = null;

  for (const item of items) {
    if (!item.available) {
      continue;
    }

    const name = normalizeVoiceText(item.name);
    const category = normalizeVoiceText(item.category);
    const ingredients = item.ingredients.map(normalizeVoiceText);
    const haystack = [name, category, ...ingredients].join(' ');
    const haystackTokens = new Set(tokenizeVoiceText(`${item.name} ${item.category} ${item.ingredients.join(' ')}`));

    let score = 0;

    if (name === query) {
      score += 120;
    }

    if (name.includes(query) || query.includes(name)) {
      score += 80;
    }

    for (const token of queryTokens) {
      if (haystackTokens.has(token)) {
        score += name.includes(token) ? 22 : 10;
      } else if (haystack.includes(token)) {
        score += 6;
      }
    }

    if (queryTokens.length > 0) {
      const matchedTokens = queryTokens.filter((token) => haystackTokens.has(token)).length;
      score += (matchedTokens / queryTokens.length) * 35;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { item, score };
    }
  }

  return bestMatch && bestMatch.score >= 34 ? bestMatch.item : null;
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
  const [turnState, setTurnState] = useState<VoiceTurnState>('idle');
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const captureSinkRef = useRef<GainNode | null>(null);
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
  const captureTeardownTimeoutRef = useRef<number | null>(null);
  const playedAudioChunksRef = useRef<Set<string>>(new Set());
  const lastAssistantTextRef = useRef('');
  const lastOutputTranscriptRef = useRef('');

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

  const clearCaptureTeardownTimeout = useCallback(() => {
    if (captureTeardownTimeoutRef.current) {
      window.clearTimeout(captureTeardownTimeoutRef.current);
      captureTeardownTimeoutRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((source) => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    modelTurnCompleteRef.current = false;
    playedAudioChunksRef.current.clear();
  }, []);

  const resetAssistantTurnTracking = useCallback(() => {
    playedAudioChunksRef.current.clear();
    lastAssistantTextRef.current = '';
    lastOutputTranscriptRef.current = '';
  }, []);

  const teardownAudioCapture = useCallback(() => {
    clearCaptureTeardownTimeout();

    if (inputProcessorRef.current) {
      inputProcessorRef.current.disconnect();
      inputProcessorRef.current.onaudioprocess = null;
      inputProcessorRef.current = null;
    }

    if (inputContextRef.current) {
      void inputContextRef.current.close();
      inputContextRef.current = null;
    }

    if (captureSinkRef.current) {
      captureSinkRef.current.disconnect();
      captureSinkRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    shouldStreamAudioRef.current = false;
    setVolumeLevel(0);
  }, [clearCaptureTeardownTimeout]);

  const scheduleAudioCaptureTeardown = useCallback(() => {
    clearCaptureTeardownTimeout();
    captureTeardownTimeoutRef.current = window.setTimeout(() => {
      teardownAudioCapture();
    }, CAPTURE_IDLE_TEARDOWN_MS);
  }, [clearCaptureTeardownTimeout, teardownAudioCapture]);

  const getAudioContextClass = useCallback(() => {
    return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  }, []);

  const resetSession = useCallback(
    (nextStatus: ConnectionStatus) => {
      clearRecordingTimeout();
      clearCaptureTeardownTimeout();
      shouldStreamAudioRef.current = false;
      pendingPressRef.current = false;
      sessionPromiseRef.current = null;

      const activeSession = sessionRef.current;
      sessionRef.current = null;
      activeSession?.close();
      geminiSessionRef.current = null;

      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
      playbackGainRef.current = null;
      playbackCompressorRef.current = null;
      captureSinkRef.current = null;

      teardownAudioCapture();

      stopPlayback();
      transcriptRef.current = '';
      hasRunDiagnosticsRef.current = false;
      setLastAssistantMessage('');
      resetAssistantTurnTracking();
      setVolumeLevel(0);
      setTurnStateSafe(nextStatus === 'error' ? 'error' : 'idle');
      setStatusSafe(nextStatus);
    },
    [clearCaptureTeardownTimeout, clearRecordingTimeout, resetAssistantTurnTracking, setStatusSafe, setTurnStateSafe, stopPlayback, teardownAudioCapture],
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
        const item = resolveMenuItemFromVoiceQuery(menuRef.current, itemName);

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
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) {
      throw new Error('Este navegador no soporta audio en tiempo real.');
    }

    if (!audioContextRef.current || audioContextRef.current.state === 'closed' || !playbackGainRef.current) {
      const playbackContext = new AudioContextClass({ sampleRate: 24_000 });
      audioContextRef.current = playbackContext;

      const playbackGain = playbackContext.createGain();
      playbackGain.gain.value = PLAYBACK_GAIN;
      const playbackCompressor = playbackContext.createDynamicsCompressor();
      playbackCompressor.threshold.value = -18;
      playbackCompressor.knee.value = 10;
      playbackCompressor.ratio.value = 3;
      playbackCompressor.attack.value = 0.008;
      playbackCompressor.release.value = 0.08;
      playbackGain.connect(playbackCompressor);
      playbackCompressor.connect(playbackContext.destination);
      playbackGainRef.current = playbackGain;
      playbackCompressorRef.current = playbackCompressor;
      await playbackContext.resume();
    }

    if (mediaStreamRef.current && inputProcessorRef.current && inputContextRef.current?.state !== 'closed') {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const captureContext = new AudioContextClass({ sampleRate: 16_000 });
    inputContextRef.current = captureContext;

    const source = captureContext.createMediaStreamSource(stream);
    const processor = captureContext.createScriptProcessor(4096, 1, 1);
    const silentSink = captureContext.createGain();
    silentSink.gain.value = 0;
    captureSinkRef.current = silentSink;
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
    processor.connect(silentSink);
    silentSink.connect(captureContext.destination);

    await captureContext.resume();
  }, [getAudioContextClass]);

  const finalizeTurnIfReady = useCallback(() => {
    if (sourcesRef.current.size > 0) {
      return;
    }

    if (turnStateRef.current !== 'recording') {
      setTurnStateSafe('idle');
      setVolumeLevel(0);
      scheduleAudioCaptureTeardown();
    }
  }, [scheduleAudioCaptureTeardown, setTurnStateSafe]);

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
    resetAssistantTurnTracking();
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
  }, [addLog, cancelCurrentResponse, clearRecordingTimeout, resetAssistantTurnTracking, setTurnStateSafe]);

  const ensureGeminiSession = useCallback(async () => {
    if (statusRef.current === 'connected' && geminiSessionRef.current) {
      await ensureAudioPipeline();
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
      addLog('system', `Voice client build: ${VOICE_CLIENT_BUILD}`);

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
              if (assistantText && assistantText !== lastAssistantTextRef.current) {
                lastAssistantTextRef.current = assistantText;
                setLastAssistantMessage(assistantText);
                addLog('assistant', assistantText);
              }
            }

            const inputTranscript = message.serverContent?.inputTranscription?.text?.trim();
            if (inputTranscript) {
              addLog('system', `Tu voz: ${inputTranscript}`);
            }

            const outputTranscript = message.serverContent?.outputTranscription?.text?.trim();
            if (outputTranscript && outputTranscript !== lastOutputTranscriptRef.current) {
              lastOutputTranscriptRef.current = outputTranscript;
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

            const audioParts = message.serverContent?.modelTurn?.parts?.filter(
              (part): part is typeof part & { inlineData: { data: string } } => 'inlineData' in part && Boolean(part.inlineData?.data),
            );
            if (audioParts && audioParts.length > 0 && audioContextRef.current) {
              const audioContext = audioContextRef.current;
              if (audioContext.state === 'suspended') {
                await audioContext.resume();
              }

              for (const part of audioParts) {
                const base64Audio = part.inlineData.data;
                if (playedAudioChunksRef.current.has(base64Audio)) {
                  continue;
                }

                playedAudioChunksRef.current.add(base64Audio);
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);

                const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), audioContext, 24_000);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(playbackGainRef.current ?? audioContext.destination);
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
            }

            if (message.serverContent?.interrupted) {
              stopPlayback();
              resetAssistantTurnTracking();
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

      addLog(
        'system',
        `Gemini connect config cargada: ${JSON.stringify({
          responseModalities: ['AUDIO'],
          automaticActivityDetectionDisabled: true,
          activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
          hasInputAudioTranscription: Boolean(branding.showDebugTools),
          hasOutputAudioTranscription: Boolean(branding.showDebugTools),
          explicitVadSignal: false,
        })}`,
      );

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
    clearCaptureTeardownTimeout();

    try {
      await ensureGeminiSession();
      await ensureAudioPipeline();
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
  }, [addLog, branding.voiceEnabled, clearCaptureTeardownTimeout, ensureGeminiSession, runVoiceDiagnostics, setStatusSafe, setTurnStateSafe, startRecordingInternal]);

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
