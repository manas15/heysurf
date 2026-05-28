import { getSettings } from '../shared/storage';

// ---- Types ----

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'speaking';
export type StateChangeCallback = (state: VoiceState) => void;

// ---- Module State ----

let currentState: VoiceState = 'idle';
let stateChangeCallback: StateChangeCallback | null = null;
let currentUtterances: SpeechSynthesisUtterance[] = [];

// ---- State Management ----

function setState(state: VoiceState) {
  currentState = state;
  stateChangeCallback?.(state);
}

export function getState(): VoiceState {
  return currentState;
}

export function onStateChange(cb: StateChangeCallback) {
  stateChangeCallback = cb;
}

// ---- Offscreen Document Management ----

async function ensureOffscreenDocument(): Promise<void> {
  // Check if offscreen document already exists
  const contexts = await (chrome.runtime as any).getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (contexts && contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA' as any],
    justification: 'Microphone audio capture for voice commands',
  });
}

// ---- Recording (via offscreen document) ----

export async function startRecording(): Promise<void> {
  if (currentState === 'recording') return;

  try {
    await ensureOffscreenDocument();
  } catch (err: any) {
    throw new Error('Could not set up audio capture: ' + (err.message || err));
  }

  const response = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START_RECORDING' });
  if (!response?.success) {
    throw new Error(response?.error || 'Failed to start recording');
  }

  setState('recording');
}

export async function stopRecording(): Promise<string> {
  if (currentState !== 'recording') return '';

  const response = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_RECORDING' });

  if (!response?.success) {
    setState('idle');
    throw new Error(response?.error || 'Failed to stop recording');
  }

  const audioBase64: string = response.audioBase64;
  if (!audioBase64) {
    setState('idle');
    return '';
  }

  setState('transcribing');

  try {
    // Convert base64 back to blob
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/webm' });

    const transcript = await transcribeWithWhisper(audioBlob);
    setState('idle');
    return transcript;
  } catch (err) {
    setState('idle');
    throw err;
  }
}

// ---- Whisper Transcription ----

async function transcribeWithWhisper(audioBlob: Blob): Promise<string> {
  const settings = await getSettings();
  const apiKey = settings.llm.apiKey;

  if (!apiKey) {
    throw new Error('No API key configured. Open settings to add your key.');
  }

  // Whisper only works with OpenAI keys. For other providers, use OpenAI key if available
  // or fall back to the configured key (some OpenAI-compatible providers support whisper)
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return (data.text || '').trim();
}

// ---- TTS (SpeechSynthesis) ----

function splitIntoSentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g);
  if (!sentences) return [text];
  return sentences.map((s) => s.trim()).filter(Boolean);
}

export function speak(text: string) {
  speechSynthesis.cancel();
  currentUtterances = [];

  const sentences = splitIntoSentences(text);

  for (const sentence of sentences) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = 1.0;
    currentUtterances.push(utterance);
  }

  if (currentUtterances.length === 0) return;

  setState('speaking');

  const speakNext = (index: number) => {
    if (index >= currentUtterances.length) {
      setState('idle');
      return;
    }
    const utterance = currentUtterances[index];
    utterance.onend = () => speakNext(index + 1);
    utterance.onerror = () => speakNext(index + 1);
    speechSynthesis.speak(utterance);
  };

  speakNext(0);
}

export function speakWithSettings(text: string, rate: number, voiceURI?: string) {
  speechSynthesis.cancel();
  currentUtterances = [];

  const sentences = splitIntoSentences(text);
  const voices = speechSynthesis.getVoices();
  const voice = voiceURI ? voices.find((v) => v.voiceURI === voiceURI) : undefined;

  for (const sentence of sentences) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = rate;
    if (voice) utterance.voice = voice;
    currentUtterances.push(utterance);
  }

  if (currentUtterances.length === 0) return;

  setState('speaking');

  const speakNext = (index: number) => {
    if (index >= currentUtterances.length) {
      setState('idle');
      return;
    }
    const utterance = currentUtterances[index];
    utterance.onend = () => speakNext(index + 1);
    utterance.onerror = () => speakNext(index + 1);
    speechSynthesis.speak(utterance);
  };

  speakNext(0);
}

export function stopSpeaking() {
  speechSynthesis.cancel();
  currentUtterances = [];
  if (currentState === 'speaking') {
    setState('idle');
  }
}
