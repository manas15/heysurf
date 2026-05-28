import { getSettings } from '../shared/storage';

// ---- Types ----

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'speaking';
export type StateChangeCallback = (state: VoiceState) => void;

// ---- Module State ----

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
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

// ---- Mic Permission ----

export async function checkMicPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return result.state as 'granted' | 'denied' | 'prompt';
  } catch {
    // permissions.query may not be available in all contexts
    return 'prompt';
  }
}

function openPermissionPopup(): Promise<void> {
  return new Promise((resolve, reject) => {
    const popupUrl = chrome.runtime.getURL('assets/permission.html');
    chrome.windows.create(
      {
        url: popupUrl,
        type: 'popup',
        width: 420,
        height: 320,
        focused: true,
      },
      () => {
        // Listen for permission granted message
        const listener = (message: any) => {
          if (message.type === 'MIC_PERMISSION_GRANTED') {
            chrome.runtime.onMessage.removeListener(listener);
            resolve();
          }
        };
        chrome.runtime.onMessage.addListener(listener);

        // Timeout after 60 seconds
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error('Permission request timed out'));
        }, 60000);
      },
    );
  });
}

// ---- Recording ----

export async function startRecording(): Promise<void> {
  if (currentState === 'recording') return;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (err: any) {
    if (err.name === 'NotAllowedError') {
      // Try the permission popup fallback
      try {
        await openPermissionPopup();
        // Retry after permission granted
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch {
        throw new Error('Microphone permission denied');
      }
    } else {
      throw err;
    }
  }

  audioChunks = [];

  // Prefer webm/opus which Whisper accepts natively; fall back to whatever the browser supports
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : undefined;

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.start(250); // collect chunks every 250ms
  setState('recording');
}

export async function stopRecording(): Promise<string> {
  if (!mediaRecorder || currentState !== 'recording') {
    return '';
  }

  const blob = await new Promise<Blob>((resolve) => {
    mediaRecorder!.onstop = () => {
      const mimeType = mediaRecorder!.mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: mimeType });
      resolve(blob);
    };
    mediaRecorder!.stop();
  });

  // Stop all tracks to release the mic
  mediaRecorder!.stream.getTracks().forEach((t) => t.stop());
  mediaRecorder = null;
  audioChunks = [];

  if (blob.size === 0) {
    setState('idle');
    return '';
  }

  setState('transcribing');

  try {
    const transcript = await transcribeWithWhisper(blob);
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
    throw new Error('No API key configured. Please set your OpenAI API key in Settings.');
  }

  const ext = audioBlob.type.includes('webm') ? 'webm' : 'ogg';
  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${ext}`);
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
    throw new Error(`Whisper API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return (data.text || '').trim();
}

// ---- TTS (SpeechSynthesis) ----

/**
 * Split text into sentence-sized chunks to prevent TTS cutoff in extensions.
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const sentences = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g);
  if (!sentences) return [text];
  return sentences.map((s) => s.trim()).filter(Boolean);
}

export function speak(text: string) {
  // Cancel any ongoing speech first — fixes silent failure bug in extensions
  speechSynthesis.cancel();
  currentUtterances = [];

  const sentences = splitIntoSentences(text);

  for (const sentence of sentences) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = 1.0; // Will be overridden by caller's settings if needed
    currentUtterances.push(utterance);
  }

  if (currentUtterances.length === 0) return;

  setState('speaking');

  // Chain utterances: speak them sequentially
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
