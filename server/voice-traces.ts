import type { VoiceTraceEntry } from '../types.js';

const MAX_TRACE_ENTRIES = 200;

const traces: VoiceTraceEntry[] = [];

export function recordVoiceTrace(trace: VoiceTraceEntry) {
  traces.unshift(trace);
  if (traces.length > MAX_TRACE_ENTRIES) {
    traces.length = MAX_TRACE_ENTRIES;
  }
}

export function listVoiceTraces(limit = 60) {
  return traces.slice(0, Math.max(1, Math.min(limit, MAX_TRACE_ENTRIES)));
}
