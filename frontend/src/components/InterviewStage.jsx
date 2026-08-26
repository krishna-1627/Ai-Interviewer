import { useEffect, useRef, useState, useCallback } from 'react';
import { useVoiceSession } from '../hooks/useVoiceSession.js';
import './InterviewStage.css';

export default function InterviewStage({ language, sessionId, onEnd }) {
  const {
    status,
    isAudioPlaying,
    transcript,
    errorMsg,
    questionIndex,
    startSession,
    endSession,
    sendAudio,
    nextQuestion,
    sendControlMessage,
    analyser
  } = useVoiceSession();

  const startedRef = useRef(false);
  const videoRef = useRef(null);
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);

  // Mic recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  
  // VAD / Silence detection refs
  const micAudioContextRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const vadIntervalRef = useRef(null);
  const hasUserSpokenRef = useRef(false);
  const speechStartTimeRef = useRef(null);
  const silenceStartRef = useRef(null);
  
  // Local UI state for bottom controls
  const [captionsOn, setCaptionsOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);

  // Recording state
  const [recordDuration, setRecordDuration] = useState(0);
  const timerRef = useRef(null);

  // Active Interview Time state (10 mins limit = 600s)
  const [activeDuration, setActiveDuration] = useState(0);
  const [timeUpSent, setTimeUpSent] = useState(false);
  
  // Tick active time when status is 'ready' or 'speaking' (Pauses automatically during 'processing' / system latency)
  useEffect(() => {
    let interval = null;
    if (status === 'ready' || status === 'speaking') {
      interval = setInterval(() => {
        setActiveDuration(prev => {
          const newTime = prev + 1;
          if (newTime >= 600 && !timeUpSent) {
            console.log('[Timer] 10 minutes reached! Initiating soft stop...');
            sendControlMessage({ type: 'time_up' });
            setTimeUpSent(true);
          }
          return newTime;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, timeUpSent, sendControlMessage]);

  const isAgentSpeaking = status === 'speaking' || isAudioPlaying;

  // Live Audio Canvas Visualizer (Gold Circular Microphone Visualizer)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId = null;
    
    // Resize handler with high DPI support
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    
    resizeCanvas();
    
    // Resize Observer to handle container resizing dynamically
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }
    
    let phase = 0;
    
    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      if (width === 0 || height === 0) return;
      
      // Clear with dark fade effect for motion blur trails (matching #141414)
      ctx.fillStyle = 'rgba(20, 20, 20, 0.25)';
      ctx.fillRect(0, 0, width, height);
      
      // Get frequency/amplitude data from AnalyserNode
      const bufferLength = analyser ? analyser.frequencyBinCount : 0;
      const dataArray = (analyser && isAudioPlaying) ? new Uint8Array(bufferLength) : null;
      let volume = 0;
      
      if (dataArray && analyser) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        volume = sum / bufferLength; // Range: 0 to 255
      }
      
      // Normalize volume to 0..1 range with responsive thresholding
      const normalizedVolume = isAudioPlaying ? Math.min(1, Math.max(0, (volume - 8) / 90)) : 0;
      
      // Dynamic target amplitude: reactive to AI speech volume, steady fluid idle
      const targetAmp = isAudioPlaying ? (4.0 + normalizedVolume * 8.5) : 2.2;
      
      // Smooth amplitude transitions using linear interpolation
      if (canvas.currentAmp === undefined) canvas.currentAmp = targetAmp;
      canvas.currentAmp += (targetAmp - canvas.currentAmp) * 0.20;
      const currentAmp = canvas.currentAmp;
      
      const centerX = width / 2;
      const centerY = height / 2;
      const minDimension = Math.min(width, height);
      
      const baseRadius = minDimension * 0.28; // Radius of outer ring
      const rBrackets = minDimension * 0.21; // Radius of left/right bracket arcs
      const rInner = minDimension * 0.17;    // Radius of inner circle
      const micSize = minDimension * 0.12;    // Scale of central microphone
      
      // 1. Draw central microphone icon (crisp vector)
      const drawMicrophone = (ctx, cx, cy, size) => {
        ctx.save();
        ctx.strokeStyle = '#ffc800'; // Rich Gold
        ctx.fillStyle = 'rgba(255, 200, 0, 0.08)'; // Gold tint
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const w = size * 0.52; // Width of capsule
        const h = size * 0.95; // Height of capsule
        const rx = cx - w / 2;
        const ry = cy - h / 2 - size * 0.1; // Lift slightly

        // Capsule path (manual rounded rectangle)
        ctx.beginPath();
        const r = w / 2;
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + w - r, ry);
        ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + r);
        ctx.lineTo(rx + w, ry + h * 0.7 - r);
        ctx.quadraticCurveTo(rx + w, ry + h * 0.7, rx + w - r, ry + h * 0.7);
        ctx.lineTo(rx + r, ry + h * 0.7);
        ctx.quadraticCurveTo(rx, ry + h * 0.7, rx, ry + h * 0.7 - r);
        ctx.lineTo(rx, ry + r);
        ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Grill details
        ctx.beginPath();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(255, 200, 0, 0.6)';
        // Horizontal divider
        ctx.moveTo(rx + 3, ry + h * 0.35);
        ctx.lineTo(rx + w - 3, ry + h * 0.35);
        // Vertical lines
        ctx.moveTo(cx - w * 0.18, ry + 5);
        ctx.lineTo(cx - w * 0.18, ry + h * 0.7 - 5);
        ctx.moveTo(cx, ry + 3);
        ctx.lineTo(cx, ry + h * 0.7 - 3);
        ctx.moveTo(cx + w * 0.18, ry + 5);
        ctx.lineTo(cx + w * 0.18, ry + h * 0.7 - 5);
        ctx.stroke();

        // Cradle (U-shape)
        ctx.beginPath();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#ffc800';
        ctx.arc(cx, cy - size * 0.1, w * 0.85, 0, Math.PI, false);
        ctx.stroke();

        // Cradle Stem
        ctx.beginPath();
        ctx.moveTo(cx, cy - size * 0.1 + w * 0.85);
        ctx.lineTo(cx, cy + h * 0.42);
        ctx.stroke();

        // Base Plate
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.65, cy + h * 0.42);
        ctx.lineTo(cx + w * 0.65, cy + h * 0.42);
        ctx.stroke();

        ctx.restore();
      };
      
      drawMicrophone(ctx, centerX, centerY, micSize);
      
      // 2. Draw inner concentric solid ring
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.arc(centerX, centerY, rInner, 0, Math.PI * 2);
      ctx.stroke();
      
      // 3. Draw symmetric bracket arcs (left & right)
      ctx.save();
      ctx.strokeStyle = '#ffc800';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      
      // Left arc (120 to 240 degrees)
      ctx.beginPath();
      ctx.arc(centerX, centerY, rBrackets, 2 * Math.PI / 3, 4 * Math.PI / 3);
      ctx.stroke();
      
      // Right arc (-60 to 60 degrees)
      ctx.beginPath();
      ctx.arc(centerX, centerY, rBrackets, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.restore();
      
      // 4. J.A.R.V.I.S HUD Outer Orbit Ring (Subtle tech elements)
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.22)';
      ctx.lineWidth = 1.0;
      ctx.setLineDash([3, 9]);
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + 14, phase * 0.25, phase * 0.25 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 4 Corner HUD Tech Notches
      const numNotches = 4;
      for (let n = 0; n < numNotches; n++) {
        const notchAngle = (n * Math.PI / 2) + (Math.PI / 4) + (phase * 0.1);
        const r1 = baseRadius + 11;
        const r2 = baseRadius + 17;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 200, 0, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(centerX + Math.cos(notchAngle) * r1, centerY + Math.sin(notchAngle) * r1);
        ctx.lineTo(centerX + Math.cos(notchAngle) * r2, centerY + Math.sin(notchAngle) * r2);
        ctx.stroke();
      }
      ctx.restore();
      
      // 5. Draw Dynamic J.A.R.V.I.S Fluid Voice Waves (Outer Circle)
      const drawJarvisWave = (radius, color, lineWidth, harmonics, speedMultiplier, offsetPhase) => {
        ctx.beginPath();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        
        const points = 240;
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          
          // Sample real audio frequencies symmetrically across the perimeter
          let freqOffset = 0;
          if (dataArray && dataArray.length > 0) {
            const symAngle = Math.abs(Math.sin(angle));
            const binIndex = Math.min(dataArray.length - 1, Math.floor(symAngle * 48));
            const binVal = dataArray[binIndex] / 255;
            freqOffset = binVal * (currentAmp * 0.85);
          }
          
          const currentPhase = phase * speedMultiplier + offsetPhase;
          let waveOffset = 0;
          for (let h = 0; h < harmonics.length; h++) {
            const { n, a, s } = harmonics[h];
            waveOffset += Math.sin(angle * n - currentPhase * s) * a;
          }
          
          // Scale displacement with speech intensity (traveling harmonic wave)
          const r = radius + (waveOffset * (currentAmp / 3.2)) + freqOffset;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.stroke();
      };
      
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.shadowBlur = isAudioPlaying ? 10 : 6;
      ctx.shadowColor = 'rgba(255, 200, 0, 0.5)';
      
      // Wave 1: Amber Gold base wave (4 & 8 harmonic traveling waves)
      drawJarvisWave(
        baseRadius - 2,
        'rgba(255, 175, 0, 0.65)',
        1.8,
        [
          { n: 4, a: 2.8, s: 1.0 },
          { n: 7, a: 1.4, s: -1.2 },
          { n: 11, a: 0.8, s: 1.5 }
        ],
        1.2,
        0
      );
      
      // Wave 2: Main Vibrant Gold wave (Primary speech ripple)
      drawJarvisWave(
        baseRadius,
        'rgba(255, 210, 0, 0.95)',
        2.8,
        [
          { n: 5, a: 3.6, s: 1.2 },
          { n: 8, a: 1.8, s: -0.9 },
          { n: 13, a: 1.0, s: 1.6 }
        ],
        1.4,
        Math.PI / 3
      );
      
      // Wave 3: Bright Pale/White-Gold highlight wave
      drawJarvisWave(
        baseRadius + 2,
        'rgba(255, 248, 220, 0.85)',
        1.6,
        [
          { n: 6, a: 2.5, s: 0.9 },
          { n: 9, a: 1.2, s: -1.4 },
          { n: 14, a: 0.7, s: 1.3 }
        ],
        1.1,
        -Math.PI / 4
      );
      
      ctx.restore();
      
      // Phase speed updates: fluid rotation pace that accelerates with speech
      phase += isAudioPlaying ? (0.05 * (1 + normalizedVolume * 1.6)) : 0.02;
    };
    
    draw();
    
    return () => {
      resizeObserver.disconnect();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [analyser, isAudioPlaying]);

  // Active question text
  const activeQuestionText = transcript.slice().reverse().find(m => m.role === 'ai')?.text 
    || "Connecting to your interviewer...";

  // Latest candidate speech for caption overlay
  const latestCandidateSpeech = transcript.slice().reverse().find(m => m.role === 'user')?.text
    || (isRecording ? "Listening to your response..." : "Click mic button to speak...");

  // Caption overlay refs for live auto-scrolling
  const aiCaptionRef = useRef(null);
  const userCaptionRef = useRef(null);
  const aiAnchorRef = useRef(null);
  const userAnchorRef = useRef(null);

  // Auto-scroll AI caption overlay to keep latest lines in view
  useEffect(() => {
    console.log('[Caption Scroll AI] Question text updated, auto-scrolling:', activeQuestionText.slice(0, 40));
    const timer = setTimeout(() => {
      if (aiCaptionRef.current) {
        aiCaptionRef.current.scrollTop = aiCaptionRef.current.scrollHeight;
        aiCaptionRef.current.scrollTo({
          top: aiCaptionRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
      if (aiAnchorRef.current) {
        aiAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [activeQuestionText]);

  // Auto-scroll candidate caption overlay to keep latest lines in view
  useEffect(() => {
    console.log('[Caption Scroll User] Candidate transcript updated, auto-scrolling:', latestCandidateSpeech.slice(0, 40));
    const timer = setTimeout(() => {
      if (userCaptionRef.current) {
        userCaptionRef.current.scrollTop = userCaptionRef.current.scrollHeight;
        userCaptionRef.current.scrollTo({
          top: userCaptionRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
      if (userAnchorRef.current) {
        userAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [latestCandidateSpeech]);

  // Start session & camera
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      startSession(language, sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safely attach stream to video DOM element
  const attachStream = useCallback(() => {
    if (videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch(e => console.log('[Camera] Auto-play info:', e.message));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      .then(stream => {
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        attachStream();
      })
      .catch((err) => {
        console.warn('[Camera] Video+Audio failed, falling back to Audio-only:', err);
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            if (cancelled) {
              stream.getTracks().forEach(t => t.stop());
              return;
            }
            streamRef.current = stream;
          })
          .catch(e => console.error('[Camera] MediaDevices failed:', e));
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [attachStream]);

  // Re-attach stream whenever cameraOn state changes
  useEffect(() => {
    if (cameraOn) {
      attachStream();
    }
  }, [cameraOn, attachStream]);

  // Callback ref for <video> element mounting
  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  // Auto-scroll transcript if visible
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, status]);

  const handleNextQuestion = useCallback(() => {
    nextQuestion();
  }, [nextQuestion]);

  // VAD / Silence detection cleanup
  const cleanupVad = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (micAudioContextRef.current) {
      if (micAudioContextRef.current.state !== 'closed') {
        micAudioContextRef.current.close().catch(() => {});
      }
      micAudioContextRef.current = null;
      micAnalyserRef.current = null;
    }
    hasUserSpokenRef.current = false;
    speechStartTimeRef.current = null;
    silenceStartRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    cleanupVad();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [cleanupVad]);

  // Mic recording handler with Web Audio API Voice Activity & Silence Detection
  const startRecording = useCallback(() => {
    if (status !== 'ready' || !streamRef.current || isRecording) return;

    audioChunksRef.current = [];
    let options = { mimeType: 'audio/webm;codecs=opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) options = {};

    const audioTracks = streamRef.current.getAudioTracks();
    audioTracks.forEach(t => { t.enabled = true; });
    const audioStream = new MediaStream(audioTracks);

    // Initialize VAD Analyzer Node for Voice Detection
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const micCtx = new AudioCtx();
      micAudioContextRef.current = micCtx;
      const source = micCtx.createMediaStreamSource(audioStream);
      const analyserNode = micCtx.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.3;
      source.connect(analyserNode);
      micAnalyserRef.current = analyserNode;
    } catch (e) {
      console.warn('[VAD] Failed to initialize mic analyzer:', e);
    }

    const recorder = new MediaRecorder(audioStream, options);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > 0) {
        console.log(`[Mic] Submitting answer blob (${blob.size} bytes)...`);
        sendAudio(blob);
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start(250);
    setIsRecording(true);
    
    // Start local duration timer
    setRecordDuration(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRecordDuration(prev => prev + 1);
    }, 1000);

    // Start VAD Silence Detection
    hasUserSpokenRef.current = false;
    speechStartTimeRef.current = null;
    silenceStartRef.current = null;

    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
    vadIntervalRef.current = setInterval(() => {
      if (!micAnalyserRef.current) return;
      const bufferLength = micAnalyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      micAnalyserRef.current.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avgVol = sum / bufferLength;

      const SPEECH_THRESHOLD = 14; // Speech energy threshold
      const SILENCE_DURATION_MS = 2000; // 2.0 seconds of silence to auto-finish answer

      if (avgVol >= SPEECH_THRESHOLD) {
        // Candidate is speaking
        if (!hasUserSpokenRef.current) {
          hasUserSpokenRef.current = true;
          speechStartTimeRef.current = Date.now();
        }
        silenceStartRef.current = null;
      } else if (hasUserSpokenRef.current) {
        // Candidate was speaking, now in silence
        const now = Date.now();
        if (!silenceStartRef.current) {
          silenceStartRef.current = now;
        } else if (now - silenceStartRef.current >= SILENCE_DURATION_MS) {
          // Confirm candidate spoke for at least ~800ms before auto-submitting
          const totalSpeechTime = (silenceStartRef.current || now) - (speechStartTimeRef.current || now);
          if (totalSpeechTime >= 800) {
            console.log('[VAD] 2 seconds of silence detected after answer. Auto-submitting response...');
            stopRecording();
          }
        }
      }
    }, 100);
  }, [status, isRecording, sendAudio, stopRecording]);

  // Hands-free Auto-Recording: Starts automatically when AI finishes speaking and status is 'ready'
  useEffect(() => {
    if (status === 'ready' && !isAudioPlaying && !isRecording && streamRef.current) {
      const autoStartTimer = setTimeout(() => {
        if (status === 'ready' && !isAudioPlaying && !isRecording) {
          console.log('[Auto-Record] AI finished speaking. Starting mic auto-recording...');
          startRecording();
        }
      }, 400);
      return () => clearTimeout(autoStartTimer);
    }
  }, [status, isAudioPlaying, isRecording, startRecording]);

  // Clean up VAD when unmounting
  useEffect(() => {
    return () => {
      cleanupVad();
    };
  }, [cleanupVad]);

  // Safety: If status leaves 'ready' (e.g. AI starts speaking or backend is processing), ensure recording is stopped
  useEffect(() => {
    if (status !== 'ready' && isRecording) {
      stopRecording();
    }
  }, [status, isRecording, stopRecording]);

  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      videoTracks.forEach(t => { t.enabled = !cameraOn; });
    }
    setCameraOn(prev => !prev);
  };

  const handleEnd = useCallback(async () => {
    const feedback = await endSession();
    onEnd(feedback);
  }, [endSession, onEnd]);

  // Auto-end interview when status becomes 'completed' and AI has finished speaking
  useEffect(() => {
    if (status === 'completed' && !isAudioPlaying) {
      const t = setTimeout(() => {
        handleEnd();
      }, 1000);
      return () => clearTimeout(t);
    }
  }, [status, isAudioPlaying, handleEnd]);

  // Format duration as mm:ss
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (status === 'error') {
    return (
      <div className="call-error-panel card">
        <div className="error-icon">⚠️</div>
        <h2>Connection Error</h2>
        <div className="error-msg">{errorMsg}</div>
        <button className="btn btn-primary" onClick={handleEnd}>Return to Lobby</button>
      </div>
    );
  }

  const isBusy = status !== 'ready' && !isRecording;

  return (
    <div className="call-screen-container">
      {/* ── Call Header ── */}
      <header className="call-header">
        {/* Brand Group: Mic Icon + Title & Live Status */}
        <div className="header-brand-wrap">
          <div className="header-mic-badge">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="22"></line>
            </svg>
          </div>
          <div className="header-title-group">
            <h1 className="header-title">Voice Interview Agent</h1>
            <div className="header-status-sub">
              <span>Interview in progress</span>
            </div>
          </div>
        </div>

        {/* Action Controls: Timer + End Button */}
        <div className="header-actions-wrap">
          <div 
            className={`call-timer-pill ${activeDuration >= 540 ? 'time-warning' : ''}`}
            style={activeDuration >= 540 ? { color: '#ef4444', borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' } : {}}
            title="Interview Timer (10 minutes total)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>{formatTime(activeDuration)} / 10:00</span>
          </div>

          <button className="call-end-pill-btn" onClick={handleEnd} title="End Interview">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(135deg)' }}>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
            <span>End Interview</span>
          </button>
        </div>
      </header>

      {/* ── Main Content: Two Side-by-Side Video Panels ── */}
      <main className="call-main-grid">
        {/* Left Panel: AI Interviewer */}
        <div className={`video-panel ai-panel ${isAgentSpeaking ? 'is-speaking' : ''}`}>
          <canvas 
            ref={canvasRef}
            className="video-feed-img ai-avatar-canvas"
            style={{ width: '100%', height: '100%', display: 'block', backgroundColor: '#141414' }}
          />
          
          {/* Top-Left Overlay Tag */}
          <div className="panel-tag ai-tag">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 10v3M6 6v11M10 3v17M14 8v7M18 5v13M22 10v3" />
            </svg>
            <span>AI INTERVIEWER</span>
          </div>

          {/* Top-Right Icon Badge */}
          <div className="panel-badge-tr">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 10v3M6 6v11M10 3v17M14 8v7M18 5v13M22 10v3" />
            </svg>
          </div>

          {/* Bottom Gradient Overlay: Question Caption */}
          <div className="panel-bottom-overlay">
            <div className="panel-overlay-label teal-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 10v3M6 6v11M10 3v17M14 8v7M18 5v13M22 10v3" />
              </svg>
              <span>AI INTERVIEWER</span>
            </div>
            {captionsOn && (
              <div className="panel-caption-box">
                <div ref={aiCaptionRef} className="panel-caption-scroll">
                  <div className="panel-caption-content">
                    {activeQuestionText}
                  </div>
                  <div ref={aiAnchorRef} className="caption-bottom-anchor" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Candidate (You) */}
        <div className={`video-panel user-panel ${isRecording ? 'is-speaking' : ''}`}>
          {cameraOn ? (
            <video
              ref={setVideoRef}
              autoPlay
              muted
              playsInline
              className="video-feed-element"
            />
          ) : (
            <div className="camera-off-placeholder">
              <div className="candidate-avatar-large">C</div>
              <span>Camera Off</span>
            </div>
          )}

          {/* Top-Left Overlay Tag */}
          <div className="panel-tag user-tag">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>YOU</span>
          </div>

          {/* Top-Right Icon Badge */}
          <div className="panel-badge-tr">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 10v3M6 6v11M10 3v17M14 8v7M18 5v13M22 10v3" />
            </svg>
          </div>

          {/* Bottom Gradient Overlay: Speech Caption */}
          <div className="panel-bottom-overlay">
            <div className="panel-overlay-label teal-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 10v3M6 6v11M10 3v17M14 8v7M18 5v13M22 10v3" />
              </svg>
              <span>YOU</span>
            </div>
            {captionsOn && (
              <div className="panel-caption-box">
                <div ref={userCaptionRef} className="panel-caption-scroll">
                  <div className="panel-caption-content">
                    {latestCandidateSpeech}
                  </div>
                  <div ref={userAnchorRef} className="caption-bottom-anchor" />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Bottom Control Bar: 5 items centered in a row ── */}
      <footer className="call-control-bar">
        {/* 1. Captions Button */}
        <button
          className={`control-box ${captionsOn ? 'active' : ''}`}
          onClick={() => setCaptionsOn(!captionsOn)}
          title="Toggle Captions"
        >
          <div className="control-icon-badge teal-badge">
            <span>CC</span>
          </div>
          <div className="control-label-group">
            <span className="control-title">Captions</span>
            <span className="control-status">{captionsOn ? 'On' : 'Off'}</span>
          </div>
        </button>

        {/* 2. Settings Button */}
        <button
          className="control-box"
          onClick={() => alert('Settings menu coming soon!')}
          title="Settings"
        >
          <div className="control-icon-badge dark-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </div>
          <div className="control-label-group">
            <span className="control-title">Settings</span>
            <span className="control-status">Default</span>
          </div>
        </button>

        {/* 3. Center: Prominent Circular Mic Button */}
        <div className={`center-mic-wrap ${isRecording ? 'is-recording' : ''}`}>
          <button
            className={`center-mic-btn ${isRecording ? 'recording' : 'active'}`}
            onClick={() => isRecording ? stopRecording() : startRecording()}
            disabled={status !== 'ready'}
            aria-label={isRecording ? 'Stop & send response' : 'Click to speak'}
            title={isRecording ? 'Stop & send response' : 'Click to speak'}
          >
            {isRecording ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="3"></rect>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="22"></line>
              </svg>
            )}
          </button>
          <div className="mic-glowing-ring" />
        </div>

        {/* 4. Camera Button */}
        <button
          className="control-box"
          onClick={toggleCamera}
          title="Toggle Camera"
        >
          <div className={`control-icon-badge ${cameraOn ? 'dark-badge' : 'danger-badge'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </div>
          <div className="control-label-group">
            <span className="control-title">Camera</span>
            <span className="control-status">{cameraOn ? 'On' : 'Off'}</span>
          </div>
        </button>

        {/* 5. Speaker Button */}
        <button
          className="control-box"
          onClick={() => setSpeakerOn(!speakerOn)}
          title="Toggle Speaker"
        >
          <div className={`control-icon-badge ${speakerOn ? 'dark-badge' : 'danger-badge'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          </div>
          <div className="control-label-group">
            <span className="control-title">Speaker</span>
            <span className="control-status">{speakerOn ? 'On' : 'Off'}</span>
          </div>
        </button>
      </footer>
    </div>
  );
}
