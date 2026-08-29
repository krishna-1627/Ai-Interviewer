/**
 * TTS Integration (Phase 7) — Deepgram Gemma (flux-gemma-en)
 * High-realism, ultra-low latency British feminine voice synthesis.
 * Sends single continuous MP3 audio binary buffer to WebSocket client.
 */

import { config } from '../config/env.js';

const DEEPGRAM_API_KEY = config.deepgramApiKey || process.env.DEEPGRAM_API_KEY;
const VOICE_MODEL = config.deepgramVoiceModel || process.env.DEEPGRAM_VOICE_MODEL || 'flux-gemma-en';

/**
 * Synthesize text to speech using Deepgram Flux Gemma and send
 * the resulting MP3 audio buffer to a WebSocket connection.
 *
 * @param {string} text - The AI's response text to synthesize
 * @param {import('ws').WebSocket} ws - The connected WebSocket client
 * @param {string} lang - The language code (defaults to 'en')
 * @returns {Promise<void>} Resolves when sending is complete
 */
export async function synthesizeAndStream(text, ws, lang = 'en') {
  if (!text || text.trim() === '') return;

  const apiKey = DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.error('[TTS] Error: DEEPGRAM_API_KEY is not configured in .env');
    return;
  }

  try {
    console.log(`[TTS] Synthesizing speech with Deepgram (${VOICE_MODEL}, ${text.length} chars)...`);

    const apiVersion = VOICE_MODEL.startsWith('flux') ? 'v2' : 'v1';
    const response = await fetch(`https://api.deepgram.com/${apiVersion}/speak?model=${VOICE_MODEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Deepgram TTS request failed (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    if (ws.readyState === ws.OPEN) {
      ws.send(audioBuffer, { binary: true });
      console.log(`[TTS] Sent ${audioBuffer.length} bytes of audio over WebSocket.`);
    }
  } catch (err) {
    console.error('[TTS] Synthesis failed:', err.message || err);
    throw err;
  }
}
