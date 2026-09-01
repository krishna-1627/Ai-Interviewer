import { useState, useRef, useCallback } from 'react';

const isProd = import.meta.env.PROD;
const API_URL = import.meta.env.VITE_API_URL || (isProd 
  ? 'https://ai-interviewer-zhmd.onrender.com/api/interview' 
  : 'http://localhost:4000/api/interview');
const WS_URL = import.meta.env.VITE_WS_URL || (isProd 
  ? 'wss://ai-interviewer-zhmd.onrender.com/ws' 
  : 'ws://localhost:4000/ws');

export function useVoiceSession() {
  const [status, setStatus] = useState('idle');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isStandby, setIsStandby] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [language, setLanguage] = useState('en');
  const [transcript, setTranscript] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [analyser, setAnalyser] = useState(null);
  
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef(null);  // Track current Audio element for immediate stop
  const stoppedRef = useRef(false);      // Flag to halt playback loop on end

  const playAudioChunk = useCallback(async (blob) => {
    // If the session was stopped, don't play
    if (stoppedRef.current) return;

    // Use Web Audio API BufferSource for 100% reliable analyser frequency data
    if (audioContextRef.current && analyserRef.current) {
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch (e) {
          console.warn('[AudioContext] Resume error:', e);
        }
      }

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        if (stoppedRef.current) return;

        return new Promise((resolve) => {
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(analyserRef.current);
          analyserRef.current.connect(ctx.destination);

          currentAudioRef.current = source;

          source.onended = () => {
            if (currentAudioRef.current === source) {
              currentAudioRef.current = null;
            }
            resolve();
          };

          source.start(0);
        });
      } catch (err) {
        console.warn('[AudioContext] decodeAudioData failed, using fallback:', err);
      }
    }

    // Fallback to HTMLAudioElement
    const mp3Blob = new Blob([blob], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(mp3Blob);
    const audio = new Audio(url);
    currentAudioRef.current = audio;

    return new Promise((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        resolve();
      };
      audio.play().catch(() => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        resolve();
      });
    });
  }, []);

  /** Immediately stop all audio playback and clear the queue */
  const stopAllAudio = useCallback(() => {
    stoppedRef.current = true;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsAudioPlaying(false);
    if (currentAudioRef.current) {
      if (typeof currentAudioRef.current.stop === 'function') {
        try {
          currentAudioRef.current.stop();
        } catch (e) {}
      } else if (typeof currentAudioRef.current.pause === 'function') {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
      }
      currentAudioRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback((sid) => {
    stoppedRef.current = false;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.binaryType = 'blob';

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'init', sessionId: sid }));
    };

    ws.onmessage = async (event) => {
      if (stoppedRef.current) return;

      if (event.data instanceof Blob) {
        audioQueueRef.current.push(event.data);
        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          setIsAudioPlaying(true);
          while (audioQueueRef.current.length > 0 && !stoppedRef.current) {
            const chunk = audioQueueRef.current.shift();
            await playAudioChunk(chunk);
          }
          isPlayingRef.current = false;
          setIsAudioPlaying(false);
        }
      } else {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status') {
          setStatus(msg.status);
          if (msg.status === 'speaking' || msg.status === 'thinking') {
            // If system is moving forward, clear standby
            setIsStandby(false);
          }
        } else if (msg.type === 'standby') {
          setIsStandby(true);
        } else if (msg.type === 'transcript') {
          setTranscript((prev) => [...prev, { role: msg.role, text: msg.text }]);
        } else if (msg.type === 'question_update') {
          setQuestionIndex(msg.questionNumber);
          setIsStandby(false);
        } else if (msg.type === 'completed') {
          setStatus('completed');
          setIsStandby(false);
        } else if (msg.type === 'error') {
          setStatus('error');
          setErrorMsg(msg.message);
          setIsStandby(false);
        }
      }
    };

    ws.onerror = () => {
      setStatus('error');
      setErrorMsg('WebSocket connection error');
    };

    ws.onclose = () => {
      if (!stoppedRef.current) {
        setStatus('idle');
      }
    };
  }, [playAudioChunk]);

  const startSession = useCallback(async (lang = 'en', preCreatedSessionId = null) => {
    try {
      setStatus('connecting');
      setErrorMsg('');
      setIsStandby(false);
      setLanguage(lang);
      setQuestionIndex(0);

      // Initialize Web Audio API on user interaction
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;
        const analyserNode = ctx.createAnalyser();
        analyserNode.fftSize = 256;
        analyserRef.current = analyserNode;
        setAnalyser(analyserNode);
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      let sid = preCreatedSessionId;
      if (!sid) {
        const res = await fetch(`${API_URL}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: lang })
        });
        
        if (!res.ok) throw new Error('Failed to start session');
        
        const data = await res.json();
        sid = data.sessionId;
      }

      setSessionId(sid);
      connectWebSocket(sid);
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message);
    }
  }, [connectWebSocket]);

  const sendAudio = useCallback((blob) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(blob);
    }
  }, []);

  const confirmReady = useCallback(() => {
    setIsStandby(false);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('[VoiceSession] Sending confirm_ready control message');
      wsRef.current.send(JSON.stringify({ type: 'confirm_ready' }));
    }
  }, []);

  const endSession = useCallback(async () => {
    // IMMEDIATELY stop all audio
    stopAllAudio();
    setStatus('analyzing'); // Show immediate UI feedback
    setIsStandby(false);

    // Close AudioContext to release system resources
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(e => console.log('[AudioContext] Close error:', e));
      }
      audioContextRef.current = null;
      analyserRef.current = null;
      setAnalyser(null);
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    let finalFeedback = null;
    if (sessionId) {
      try {
        const res = await fetch(`${API_URL}/${sessionId}/end`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          finalFeedback = data.feedback;
        }
      } catch (err) {
        console.error('Failed to fetch feedback', err);
      }
    }
    setStatus('idle');
    setSessionId(null);
    setTranscript([]);
    return finalFeedback;
  }, [sessionId, stopAllAudio]);

  const nextQuestion = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'next_question' }));
    }
  }, []);

  const sendControlMessage = useCallback((msgObj) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msgObj));
    }
  }, []);

  return {
    status,
    isAudioPlaying,
    isStandby,
    sessionId,
    language,
    transcript,
    errorMsg,
    questionIndex,
    startSession,
    endSession,
    sendAudio,
    confirmReady,
    nextQuestion,
    sendControlMessage,
    analyser
  };
}
