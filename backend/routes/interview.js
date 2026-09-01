/**
 * Interview REST routes.
 *
 * POST /api/interview/start   — start a new interview session
 * POST /api/interview/end     — end an interview and get feedback
 * GET  /api/interview/:id     — get session state (for reconnection / debug)
 *
 * The real-time audio pipeline runs over WebSocket (see server/index.js).
 * These REST endpoints handle session lifecycle only.
 */

import { Router } from 'express';
import multer from 'multer';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';
import { createSession, getSession, updateSession } from '../session/sessionStore.js';
import { SUPPORTED_LANGUAGES } from '../i18n/locales.js';
import { startBackgroundQuestionGeneration } from '../pipeline/retrieval.js';

const pdfParse = pdfParseModule.PDFParse || pdfParseModule.default || pdfParseModule;

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

/**
 * Clean and truncate resume text to prioritize Skills, Experience, and Projects.
 */
export function truncateResume(text, maxChars = 1200) {
  if (!text || typeof text !== 'string') return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;

  const lower = cleaned.toLowerCase();
  const skillIdx = lower.indexOf('skill');
  const expIdx = lower.indexOf('experience');
  const projIdx = lower.indexOf('project');

  const indices = [skillIdx, expIdx, projIdx].filter((i) => i !== -1);
  let startPos = 0;
  if (indices.length > 0) {
    startPos = Math.min(...indices);
  }

  const slice = cleaned.slice(startPos, startPos + maxChars);
  return slice.trim() + '...';
}

/**
 * Clean and truncate Job Description text to focus on Requirements and Responsibilities.
 */
export function truncateJd(text, maxChars = 800) {
  if (!text || typeof text !== 'string') return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;

  const lower = cleaned.toLowerCase();
  const reqIdx = lower.indexOf('require');
  const respIdx = lower.indexOf('responsi');
  const qualIdx = lower.indexOf('qualifi');

  const indices = [reqIdx, respIdx, qualIdx].filter((i) => i !== -1);
  let startPos = 0;
  if (indices.length > 0) {
    startPos = Math.min(...indices);
  }

  const slice = cleaned.slice(startPos, startPos + maxChars);
  return slice.trim() + '...';
}

/**
 * Helper to extract text from a PDF or DOCX buffer.
 */
async function parseDocBuffer(file) {
  if (!file || !file.buffer) return '';
  const originalName = file.originalname ? file.originalname.toLowerCase() : '';
  const mimeType = file.mimetype || '';

  if (originalName.endsWith('.pdf') || mimeType === 'application/pdf') {
    if (pdfParseModule && typeof pdfParseModule.PDFParse === 'function') {
      const parser = new pdfParseModule.PDFParse({ data: file.buffer });
      const res = await parser.getText();
      return (typeof res === 'string' ? res : res?.text) || '';
    } else if (typeof pdfParse === 'function') {
      const pdfData = await pdfParse(file.buffer);
      return pdfData.text || '';
    } else {
      throw new Error('PDF parsing library failed to load.');
    }
  } else if (
    originalName.endsWith('.docx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    const docxResult = await mammoth.extractRawText({ buffer: file.buffer });
    return docxResult.value || '';
  } else {
    throw new Error(`Unsupported file type for ${file.originalname || 'uploaded file'}. Only PDF and DOCX files are allowed.`);
  }
}

/**
 * POST /api/interview/setup
 * Multipart/form-data:
 *   - resume: File (PDF/DOCX, max 5MB, required)
 *   - jdFile: File (PDF/DOCX, max 5MB, optional)
 *   - jdText: Text (string, optional fallback if jdFile not present)
 *   - jobTitle: Text (string, required)
 *   - companyName: Text (string, required)
 *   - language: Text (string, optional, default 'en')
 */
router.post('/setup', (req, res, next) => {
  upload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'jdFile', maxCount: 1 }
  ])(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds the 5MB maximum limit.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { jobTitle, companyName, language = 'en', jdText: fallbackJdText } = req.body;

    if (!jobTitle || !jobTitle.trim()) {
      return res.status(400).json({ error: 'Job Title is required.' });
    }
    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ error: 'Company Name is required.' });
    }

    const resumeFile = req.files?.resume?.[0];
    if (!resumeFile) {
      return res.status(400).json({ error: 'Resume file is required (PDF or DOCX, max 5MB).' });
    }

    const jdFile = req.files?.jdFile?.[0];
    if (!jdFile && (!fallbackJdText || !fallbackJdText.trim())) {
      return res.status(400).json({ error: 'Job Description is required (upload file or paste text).' });
    }

    // Extract Resume text
    let resumeText = '';
    try {
      resumeText = await parseDocBuffer(resumeFile);
    } catch (parseErr) {
      return res.status(400).json({ error: `Failed to parse Resume: ${parseErr.message}` });
    }

    // Extract Job Description text
    let jdText = '';
    if (jdFile) {
      try {
        jdText = await parseDocBuffer(jdFile);
      } catch (parseErr) {
        return res.status(400).json({ error: `Failed to parse Job Description: ${parseErr.message}` });
      }
    } else {
      jdText = fallbackJdText.trim();
    }

    const session = createSession({
      language: SUPPORTED_LANGUAGES.includes(language) ? language : 'en',
      resumeText,
      jdText,
      jobTitle: jobTitle.trim(),
      companyName: companyName.trim(),
    });

    // Start background question generation immediately so questions are ready before Q1 starts
    startBackgroundQuestionGeneration(session);

    res.json({
      sessionId: session.id,
      language: session.language,
      status: session.status,
      jobTitle: session.jobTitle,
      companyName: session.companyName,
      message: 'Interview session setup completed successfully.',
    });
  } catch (err) {
    console.error('[Route] Setup error:', err);
    res.status(500).json({ error: err.message || 'Internal server error during setup' });
  }
});

/**
 * POST /api/interview/start
 * Body: { language?: 'en' | 'hi' | 'de' }
 * Returns: { sessionId, language, status }
 */
router.post('/start', (req, res) => {
  const language = req.body.language || 'en';

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).json({
      error: `Unsupported language: ${language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
    });
  }

  const session = createSession({ language });

  res.json({
    sessionId: session.id,
    language: session.language,
    status: session.status,
    message: `Interview session created. Connect via WebSocket at /ws to begin.`,
  });
});

/**
 * GET /api/interview/:id
 * Returns current session state (for debugging / reconnection).
 */
router.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

import { generateFeedback } from '../pipeline/feedback.js';

/**
 * POST /api/interview/:id/end
 * Ends the interview and triggers feedback generation.
 */
router.post('/:id/end', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  updateSession(session.id, { status: 'completed' });

  try {
    const feedback = await generateFeedback(session);
    feedback.history = session.history; // Add history for PDF transcript
    res.json({
      sessionId: session.id,
      status: 'completed',
      feedback,
      message: 'Interview ended successfully.',
    });
  } catch (err) {
    console.error('[Route] Feedback error:', err);
    res.status(500).json({ error: 'Failed to generate feedback' });
  }
});

export default router;
