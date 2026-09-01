/**
 * WebSocket Orchestrator (Phase 4)
 * Manages the flow of audio from the client -> STT -> LLM -> TTS -> client.
 */

import { getSession, updateSession } from '../session/sessionStore.js';
import { transcribeAudio } from './stt.js';
import { generateResponse } from '../agents/live_runtime_agents/interviewer_agent.js';
import { synthesizeAndStream } from './tts.js';
import { evaluateAnswer } from '../agents/live_runtime_agents/evaluator_agent.js';
import { getActiveQuestion, startBackgroundQuestionGeneration } from './retrieval.js';

function getGreetingText(session) {
  const lang = session.language || 'en';
  const jobTitle = session.jobTitle ? session.jobTitle.trim() : '';
  const companyName = session.companyName ? session.companyName.trim() : '';

  if (lang === 'de') {
    const rolePart = jobTitle ? `für die Stelle als ${jobTitle}` : 'für Ihr technisches Interview';
    const companyPart = companyName ? `bei ${companyName}` : '';
    return `Hallo und herzlich willkommen! Ich bin heute Ihr KI-Interviewer ${companyPart} ${rolePart}. Sollen wir beginnen?`.replace(/\s+/g, ' ').trim();
  }

  if (lang === 'hi') {
    const rolePart = jobTitle ? `${jobTitle} पद` : 'तकनीकी इंटरव्यू';
    const companyPart = companyName ? `${companyName} में` : '';
    return `नमस्ते! इंटरव्यू में आपका स्वागत है। मैं आज ${companyPart} ${rolePart} के लिए आपका AI इंटरव्यूअर हूँ। क्या हम शुरू करें?`.replace(/\s+/g, ' ').trim();
  }

  // English default
  const rolePart = jobTitle ? `for the ${jobTitle} position` : 'for your technical screening';
  const companyPart = companyName ? `at ${companyName}` : '';
  return `Hello and welcome! I am your AI interviewer today ${rolePart} ${companyPart}. Shall we begin?`.replace(/\s+/g, ' ').trim();
}

function getStandbyText(session) {
  const lang = session.language || 'en';
  if (lang === 'de') {
    return "Kein Problem! Nehmen Sie sich Zeit. Sobald Sie bereit sind, klicken Sie auf Ihrem Bildschirm auf 'Ich bin bereit', um zu beginnen.";
  }
  if (lang === 'hi') {
    return "कोई बात नहीं! आप अपना समय लें। जब भी आप तैयार हों, स्क्रीन पर 'I'm Ready' बटन पर क्लिक करके शुरू करें।";
  }
  return "No problem at all! Take your time. Whenever you're ready, click the 'I'm Ready' button on your screen to begin.";
}

function isNegativeOrNotReady(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();

  // Negative / hesitation cues across EN, HI, DE
  const cues = [
    'no', 'not yet', 'wait', 'hold on', 'give me a moment', 'give me a minute',
    'one second', 'one sec', 'not ready', 'stop', 'pause', 'need time',
    'nahi', 'nahin', 'ruk', 'ruko', 'thoda wait', 'abhi nahi', 'tyar nahi',
    'nein', 'noch nicht', 'warte', 'warten', 'moment', 'augenblick', 'nicht bereit'
  ];

  return cues.some((cue) => {
    const regex = new RegExp(`\\b${cue}\\b`, 'i');
    return regex.test(lower);
  });
}

/**
 * Handle a new WebSocket connection.
 * @param {import('ws').WebSocket} ws
 */
export function handleConnection(ws) {
  let session = null;

  console.log('[WS] Client connected');

  ws.on('message', async (data, isBinary) => {
    try {
      if (!isBinary) {
        // Control message (JSON)
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'init') {
          session = getSession(msg.sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid session ID' }));
            ws.close();
            return;
          }
          console.log(`[WS] Initialized pipeline for session ${session.id}`);

          // Ensure background question generation is started
          startBackgroundQuestionGeneration(session);

          ws.send(JSON.stringify({ type: 'status', status: 'ready' }));

          // ── GREETING WARM-UP PHASE ──
          if (session.greetingPhase === 'not_started') {
            session.greetingPhase = 'greeting_asked';
            const greeting = getGreetingText(session);
            session.history.push({ role: 'interviewer', content: greeting });

            ws.send(JSON.stringify({ type: 'transcript', text: greeting, role: 'ai' }));
            ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));
            await synthesizeAndStream(greeting, ws, session.language);
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          }
        }
        else if (msg.type === 'confirm_ready') {
          if (session && session.greetingPhase !== 'interview_started') {
            console.log(`[Orchestrator] Candidate confirmed ready via UI button for session ${session.id}`);
            session.greetingPhase = 'interview_started';
            ws.send(JSON.stringify({ type: 'question_update', questionNumber: 1 }));
            ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));

            const aiResponse = await generateResponse('I am ready to begin the interview.', session);
            ws.send(JSON.stringify({ type: 'transcript', text: aiResponse.text, role: 'ai' }));
            ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));
            await synthesizeAndStream(aiResponse.text, ws, session.language);
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          }
        }
        else if (msg.type === 'next_question') {
          if (session) {
            session.currentQuestionIndex++;
            ws.send(JSON.stringify({ type: 'question_update', questionNumber: session.currentQuestionIndex + 1 }));
            ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));
            const aiResponse = await generateResponse('I am ready for the next question.', session);
            ws.send(JSON.stringify({ type: 'transcript', text: aiResponse.text, role: 'ai' }));
            ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));
            await synthesizeAndStream(aiResponse.text, ws, session.language);
            
            if (session.status === 'completed' || aiResponse.isComplete) {
              ws.send(JSON.stringify({ type: 'completed' }));
            } else {
              ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
            }
          }
        }
        else if (msg.type === 'time_up') {
          if (session) {
            console.log(`[Orchestrator] Time is up for session ${session.id}. Initiating soft stop.`);
            session.isTimeUp = true;
          }
        }
      } else {
        // Binary message (User's audio chunk)
        if (!session) {
          console.warn('[WS] Received audio before init');
          return;
        }

        console.log(`[WS] Received audio blob (${data.length} bytes)`);
        
        // 1. STT
        ws.send(JSON.stringify({ type: 'status', status: 'transcribing' }));
        
        const questionIndex = session.currentQuestionIndex + 1;
        const questionId = `q${questionIndex.toString().padStart(2, '0')}`;
        const activeQuestion = await getActiveQuestion(questionId, session.language, session, true);

        const sttContext = {
          companyName: session.companyName,
          jobTitle: session.jobTitle,
          projectName: session.candidateImpressiveProject?.name,
          rubricKeyphrases: activeQuestion?.rubricKeyphrases || activeQuestion?.rubric_keyphrases || []
        };

        const transcript = await transcribeAudio(data, session.language, session.id, sttContext);
        
        console.log(`[WS] STT transcript value: ${JSON.stringify(transcript)}`);

        // Check word count
        const wordCount = transcript ? transcript.trim().split(/\s+/).filter(Boolean).length : 0;
        
        // Guard during technical questions (for greeting turn, 1-word answers like "Yes", "No", "Ready" are allowed)
        if (session.greetingPhase === 'interview_started' && (!transcript || wordCount < 3)) {
          console.log(`[WS] Transcript too short (${wordCount} word(s)) — treating as silence.`);
          ws.send(JSON.stringify({ type: 'transcript', text: "(No speech detected, please try again)", role: 'system' }));
          ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          return;
        }

        if (!transcript || wordCount === 0) {
          ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          return;
        }
        
        ws.send(JSON.stringify({ type: 'transcript', text: transcript, role: 'user' }));

        // ── 1.1 HANDLE GREETING RESPONSE ──
        if (session.greetingPhase === 'greeting_asked' || session.greetingPhase === 'standby') {
          if (isNegativeOrNotReady(transcript)) {
            // Candidate said No / Wait -> Enter Standby
            session.greetingPhase = 'standby';
            const standbyText = getStandbyText(session);

            session.history.push({ role: 'candidate', content: transcript });
            session.history.push({ role: 'interviewer', content: standbyText });

            ws.send(JSON.stringify({ type: 'transcript', text: standbyText, role: 'ai' }));
            ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));
            await synthesizeAndStream(standbyText, ws, session.language);
            ws.send(JSON.stringify({ type: 'standby' }));
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
            return;
          } else {
            // Candidate confirmed Yes / Ready -> Start Question 1
            session.greetingPhase = 'interview_started';
            ws.send(JSON.stringify({ type: 'question_update', questionNumber: 1 }));
            ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));

            const aiResponse = await generateResponse(transcript, session);
            ws.send(JSON.stringify({ type: 'transcript', text: aiResponse.text, role: 'ai' }));
            ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));
            await synthesizeAndStream(aiResponse.text, ws, session.language);
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
            return;
          }
        }

        // 2. Evaluate Answer (only during active technical interview, not during time-up wrap-up phase)
        ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));
        
        let evaluation = null;
        let routingDecision = { action: 'advance', missedKeyphrases: [] };
        
        if (!session.isTimeUp && activeQuestion) {
          evaluation = await evaluateAnswer(transcript, activeQuestion, session.language, session.id);
          console.log(`[Orchestrator] Evaluation coverage: ${evaluation.coveragePercent}%`);
          
          if (evaluation.coveragePercent >= 60) {
            // Good answer -> advance
            routingDecision.action = 'advance';
            session.followUpCount = 0;
          } else if (evaluation.coveragePercent < 30) {
            // ROUTER LOGIC: Candidate bombed the initial question -> advance (skip follow-up)
            routingDecision.action = 'advance';
            session.followUpCount = 0;
            console.log(`[Router] Score < 30%. Skipping follow-up and moving to next question.`);
          } else if (session.followUpCount < 1) {
            // Partial answer (30-59%) -> ask follow-up
            routingDecision.action = 'follow_up';
            routingDecision.missedKeyphrases = evaluation.keyphraseResults.filter(k => k.status !== 'hit').map(k => k.keyphrase);
            session.followUpCount++;
          } else {
            // Already asked a follow-up -> advance
            routingDecision.action = 'advance';
            session.followUpCount = 0;
          }
          
          // Store evaluation on session
          session.history.push({ role: 'candidate', content: transcript, evaluation, questionId });
        } else {
          session.history.push({ role: 'candidate', content: transcript });
        }

        // 3. LLM Interviewer Response
        const aiResponse = await generateResponse(transcript, session, routingDecision);
        ws.send(JSON.stringify({ type: 'transcript', text: aiResponse.text, role: 'ai' }));

        // 4. TTS
        ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));
        await synthesizeAndStream(aiResponse.text, ws, session.language);
        
        if (routingDecision.action === 'advance' && activeQuestion) {
          session.currentQuestionIndex++;
          ws.send(JSON.stringify({ type: 'question_update', questionNumber: session.currentQuestionIndex + 1 }));
        }

        if (session.status === 'completed' || aiResponse.isComplete) {
          ws.send(JSON.stringify({ type: 'completed' }));
        } else {
          ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
        }
      }
    } catch (err) {
      console.error('[WS] Error in pipeline:', err);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    session = null;
  });
}
