/**
 * i18n / locale configuration.
 *
 * Maps supported languages to:
 * - STT language hints (for Whisper STT)
 * - TTS voice IDs (for ElevenLabs — placeholders until Phase 7)
 * - UI labels and prompt language instructions
 */

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'de'];

export const locales = {
  en: {
    label: 'English (UK)',
    sttLanguage: 'en',
    ttsVoiceId: '', // Placeholder — set real ElevenLabs voice ID in Phase 7
    promptInstruction: 'Conduct the interview in British English.',
    greeting: 'Hello! Welcome to the AI Intern technical screening. Let\'s get started.',
    farewell: 'Thank you for completing the interview. Let me prepare your feedback.',
  },
  hi: {
    label: 'हिन्दी (Hindi)',
    sttLanguage: 'hi',
    ttsVoiceId: '', // Placeholder — set real ElevenLabs voice ID in Phase 7
    promptInstruction: 'Conduct the interview in Hindi (हिन्दी).',
    greeting: 'नमस्ते! AI इंटर्न तकनीकी स्क्रीनिंग में आपका स्वागत है। चलिए शुरू करते हैं।',
    farewell: 'इंटरव्यू पूरा करने के लिए धन्यवाद। मैं आपकी फीडबैक तैयार कर रहा हूँ।',
  },
  de: {
    label: 'Deutsch (German)',
    sttLanguage: 'de',
    ttsVoiceId: '', // Placeholder — set real ElevenLabs voice ID in Phase 7
    promptInstruction: 'Conduct the interview in German (Deutsch).',
    greeting: 'Hallo! Willkommen zum technischen Screening für die KI-Praktikumsstelle. Lassen Sie uns beginnen.',
    farewell: 'Vielen Dank für die Teilnahme am Interview. Ich erstelle jetzt Ihr Feedback.',
  },
};

/**
 * Get locale config for a language, falling back to English.
 * @param {string} lang - Language code
 * @returns {object} Locale config
 */
export function getLocale(lang) {
  return locales[lang] || locales.en;
}
