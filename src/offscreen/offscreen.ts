// Offscreen document for microphone audio capture.
// getUserMedia works reliably here (unlike in side panels on some Chrome versions).

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'OFFSCREEN_START_RECORDING': {
      startRecording()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    case 'OFFSCREEN_STOP_RECORDING': {
      stopRecording()
        .then((base64) => sendResponse({ success: true, audioBase64: base64 }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
  }
});

async function startRecording(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  audioChunks = [];

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

  mediaRecorder.start(250);
}

async function stopRecording(): Promise<string> {
  if (!mediaRecorder) return '';

  const blob = await new Promise<Blob>((resolve) => {
    mediaRecorder!.onstop = () => {
      const mt = mediaRecorder!.mimeType || 'audio/webm';
      resolve(new Blob(audioChunks, { type: mt }));
    };
    mediaRecorder!.stop();
  });

  // Release mic
  mediaRecorder!.stream.getTracks().forEach((t) => t.stop());
  mediaRecorder = null;
  audioChunks = [];

  if (blob.size === 0) return '';

  // Convert to base64 to pass through chrome messaging
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
