/**
 * In-memory session store for interview sessions.
 * Uses a Map<sessionId, sessionState> — adequate for a prototype.
 * Swap for Redis if persistence/horizontal scaling is needed.
 */

import { randomUUID } from 'crypto';

/** @type {Map<string, object>} */
const sessions = new Map();

/**
 * Create a new interview session.
 * @param {object} options
 * @param {string} [options.language='en'] - Interview language
 * @param {string} [options.resumeText=''] - Extracted resume text
 * @param {string} [options.jdText=''] - Extracted job description text
 * @param {string} [options.jobTitle=''] - Candidate targeted job title
 * @param {string} [options.companyName=''] - Candidate targeted company
 * @returns {object} The created session state
 */
export function createSession({ language = 'en', resumeText = '', jdText = '', jobTitle = '', companyName = '' } = {}) {
  // Build a compact, token-efficient 1-paragraph summary (~200 tokens max)
  let candidateContextSummary = '';
  if (jobTitle || companyName || resumeText || jdText) {
    const parts = [];
    if (jobTitle) parts.push(`Target Role: ${jobTitle}${companyName ? ` at ${companyName}` : ''}`);
    
    // Clean & truncate resume to 800 chars (~180 tokens)
    if (resumeText) {
      const cleanResume = resumeText.replace(/\s+/g, ' ').trim();
      parts.push(`Resume Excerpt: ${cleanResume.slice(0, 800)}...`);
    }
    
    // Clean & truncate JD to 500 chars (~120 tokens)
    if (jdText) {
      const cleanJd = jdText.replace(/\s+/g, ' ').trim();
      parts.push(`JD Excerpt: ${cleanJd.slice(0, 500)}...`);
    }
    candidateContextSummary = parts.join(' | ');
  }

  const session = {
    id: randomUUID(),
    language,
    resumeText: resumeText.slice(0, 1000),
    jdText: jdText.slice(0, 1000),
    candidateContextSummary,
    jobTitle,
    companyName,
    currentQuestionIndex: 0,
    followUpCount: 0,
    turnCount: 0,
    apiCallCount: 0,
    llmCallCount: 0,
    sttCallCount: 0,
    isTimeUp: false,
    greetingPhase: 'not_started', // 'not_started' | 'greeting_asked' | 'standby' | 'interview_started'
    dynamicQuestions: null,
    _generatingPromise: null,
    conclusionPhase: 'none', // 'none' | 'wrap_up_asked' | 'answering'
    history: [], // { role: 'interviewer'|'candidate', content: string, evaluation: object }
    questionResults: [], // per-question notes for feedback generation
    status: 'active', // 'active' | 'completed'
    createdAt: new Date().toISOString(),
  };
  sessions.set(session.id, session);
  console.log(`[Session] Created ${session.id} (lang=${language}, role=${jobTitle}@${companyName}, summaryLength=${candidateContextSummary.length})`);
  return session;
}

/**
 * Get a session by ID.
 * @param {string} sessionId
 * @returns {object|undefined}
 */
export function getSession(sessionId) {
  return sessions.get(sessionId);
}

/**
 * Update a session's state (shallow merge).
 * @param {string} sessionId
 * @param {object} updates - Fields to merge into the session
 * @returns {object} The updated session
 */
export function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  Object.assign(session, updates);
  return session;
}

/**
 * Increment LLM API call count for a session.
 * @param {string} sessionId
 */
export function incrementLlmCallCount(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.llmCallCount = (session.llmCallCount || 0) + 1;
    session.apiCallCount = (session.apiCallCount || 0) + 1;
  }
}

/**
 * Increment STT API call count for a session.
 * @param {string} sessionId
 */
export function incrementSttCallCount(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.sttCallCount = (session.sttCallCount || 0) + 1;
    session.apiCallCount = (session.apiCallCount || 0) + 1;
  }
}

/**
 * Increment the generic API call count (defaults to LLM).
 * @param {string} sessionId
 */
export function incrementApiCallCount(sessionId) {
  incrementLlmCallCount(sessionId);
}

/**
 * Delete a session.
 * @param {string} sessionId
 * @returns {boolean} Whether the session existed
 */
export function deleteSession(sessionId) {
  console.log(`[Session] Deleted ${sessionId}`);
  return sessions.delete(sessionId);
}

/**
 * List all active sessions (for debugging).
 * @returns {object[]}
 */
export function listSessions() {
  return Array.from(sessions.values());
}
