// ---------------------------------------------------------------------------
// Audio Transcription Service — Whisper API / Local Whisper
// ---------------------------------------------------------------------------
// Supports:
//   1. OpenAI Whisper API (requires OPENAI_API_KEY)
//   2. Groq Whisper API (requires GROQ_API_KEY — fast & free tier)
//   3. Local Whisper-compatible endpoint (WHISPER_API_URL env var)
// ---------------------------------------------------------------------------

import { getApiKey } from '../config';

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  provider: 'openai' | 'groq' | 'local';
}

/**
 * Transcribe an audio buffer using the best available Whisper provider.
 * Priority: 1) Groq (fastest, free tier), 2) OpenAI, 3) Local endpoint.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  fileName?: string
): Promise<TranscriptionResult> {
  // Try Groq first (whisper-large-v3-turbo — very fast)
  const groqKey = getApiKey('groq');
  if (groqKey) {
    try {
      return await transcribeWithGroq(audioBuffer, mimeType, fileName, groqKey);
    } catch (error: any) {
      console.warn('[Transcription] Groq failed, trying next provider:', error.message);
    }
  }

  // Try OpenAI Whisper
  const openaiKey = getApiKey('openai');
  if (openaiKey) {
    try {
      return await transcribeWithOpenAI(audioBuffer, mimeType, fileName, openaiKey);
    } catch (error: any) {
      console.warn('[Transcription] OpenAI failed, trying next provider:', error.message);
    }
  }

  // Try local Whisper endpoint
  const localUrl = process.env.WHISPER_API_URL;
  if (localUrl) {
    try {
      return await transcribeWithLocal(audioBuffer, mimeType, fileName, localUrl);
    } catch (error: any) {
      console.warn('[Transcription] Local Whisper failed:', error.message);
    }
  }

  throw new Error(
    'No hay servicio de transcripción disponible. Configura una API key de OpenAI, Groq, o establece WHISPER_API_URL para un servidor Whisper local.'
  );
}

// ---------------------------------------------------------------------------
// Build multipart/form-data manually (no external dependency)
// ---------------------------------------------------------------------------

function buildMultipartFormData(
  audioBuffer: Buffer,
  mimeType: string,
  fileName: string,
  model: string,
  extraFields?: Record<string, string>
): { body: Buffer; contentType: string } {
  const boundary = `----FormBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  const parts: Buffer[] = [];

  // File part
  const ext = getExtensionForMime(mimeType);
  const finalFileName = fileName || `audio.${ext}`;
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${finalFileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
  );
  parts.push(audioBuffer);
  parts.push(Buffer.from('\r\n'));

  // Model part
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
    )
  );

  // Extra fields
  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
        )
      );
    }
  }

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function getExtensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/mp3': 'mp3',
  };
  // Handle codec suffixes like audio/ogg; codecs=opus
  const baseMime = mimeType.split(';')[0].trim().toLowerCase();
  return map[baseMime] || 'ogg';
}

// ---------------------------------------------------------------------------
// OpenAI Whisper
// ---------------------------------------------------------------------------

async function transcribeWithOpenAI(
  audioBuffer: Buffer,
  mimeType: string,
  fileName: string | undefined,
  apiKey: string
): Promise<TranscriptionResult> {
  const { body, contentType } = buildMultipartFormData(
    audioBuffer,
    mimeType,
    fileName || 'audio.ogg',
    'whisper-1',
    { response_format: 'verbose_json' }
  );

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': contentType,
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`OpenAI Whisper HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json() as any;
  return {
    text: data.text || '',
    language: data.language,
    duration: data.duration,
    provider: 'openai',
  };
}

// ---------------------------------------------------------------------------
// Groq Whisper (whisper-large-v3-turbo)
// ---------------------------------------------------------------------------

async function transcribeWithGroq(
  audioBuffer: Buffer,
  mimeType: string,
  fileName: string | undefined,
  apiKey: string
): Promise<TranscriptionResult> {
  const { body, contentType } = buildMultipartFormData(
    audioBuffer,
    mimeType,
    fileName || 'audio.ogg',
    'whisper-large-v3-turbo',
    { response_format: 'verbose_json' }
  );

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': contentType,
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Groq Whisper HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json() as any;
  return {
    text: data.text || '',
    language: data.language,
    duration: data.duration,
    provider: 'groq',
  };
}

// ---------------------------------------------------------------------------
// Local Whisper (e.g. faster-whisper-server, whisper.cpp server)
// ---------------------------------------------------------------------------

async function transcribeWithLocal(
  audioBuffer: Buffer,
  mimeType: string,
  fileName: string | undefined,
  baseUrl: string
): Promise<TranscriptionResult> {
  // Most local Whisper servers follow the OpenAI-compatible API
  const { body, contentType } = buildMultipartFormData(
    audioBuffer,
    mimeType,
    fileName || 'audio.ogg',
    'whisper-1',
    { response_format: 'verbose_json' }
  );

  const url = baseUrl.replace(/\/+$/, '');
  const endpoint = url.includes('/v1/') ? url : `${url}/v1/audio/transcriptions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
    },
    body,
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Local Whisper HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json() as any;
  return {
    text: data.text || '',
    language: data.language,
    duration: data.duration,
    provider: 'local',
  };
}
