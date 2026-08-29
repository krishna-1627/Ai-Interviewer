/**
 * Central configuration — reads env vars once, validates what's needed
 * for the current phase, and exports a typed config object.
 */

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌  Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

export const config = {
  // Server
  port: parseInt(optionalEnv('PORT', '4000'), 10),
  defaultLanguage: optionalEnv('DEFAULT_LANGUAGE', 'en'),

  // LLM — Azure OpenAI (ChatGPT gpt-4o-mini)
  azureOpenAiKey: optionalEnv('AZURE_OPENAI_KEY'),
  azureOpenAiEndpoint: optionalEnv('AZURE_OPENAI_ENDPOINT'),
  azureDeploymentName: optionalEnv('AZURE_DEPLOYMENT_NAME', 'gpt-4o-mini'),
  llmProvider: optionalEnv('LLM_PROVIDER', 'azure_openai'),

  // STT — High-Speed Whisper STT
  sttApiKey: optionalEnv('GROQ_API_KEY') || optionalEnv('WHISPER_API_KEY'),

  // Embeddings — Google AI Studio (Gemini)
  googleAiStudioApiKey: optionalEnv('GOOGLE_AI_STUDIO_API_KEY'),

  // TTS — Deepgram Gemma
  deepgramApiKey: optionalEnv('DEEPGRAM_API_KEY'),
  deepgramVoiceModel: optionalEnv('DEEPGRAM_VOICE_MODEL', 'flux-gemma-en'),

  // Vector DB — Pinecone
  pineconeApiKey: optionalEnv('PINECONE_API_KEY'),
  pineconeIndex: optionalEnv('PINECONE_INDEX', 'ai-intern-qa'),
};
