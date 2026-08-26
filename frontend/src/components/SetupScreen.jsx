import { useState, useRef } from 'react';
import './SetupScreen.css';

const isProd = import.meta.env.PROD;
const API_URL = import.meta.env.VITE_API_URL || (isProd
  ? 'https://ai-interviewer-zhmd.onrender.com/api/interview'
  : 'http://localhost:4000/api/interview');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default function SetupScreen({ onStartSession, language, onLanguageChange }) {
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');

  // Resume state
  const [resumeFile, setResumeFile] = useState(null);
  const [isResumeDragging, setIsResumeDragging] = useState(false);

  // JD state (File or Text)
  const [jdMode, setJdMode] = useState('file'); // 'file' | 'text'
  const [jdFile, setJdFile] = useState(null);
  const [jdText, setJdText] = useState('');
  const [isJdDragging, setIsJdDragging] = useState(false);

  // Form submission / UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resumeInputRef = useRef(null);
  const jdInputRef = useRef(null);

  // Helper for file type validation
  const isValidFileType = (file) => {
    if (!file) return false;
    const name = file.name.toLowerCase();
    const type = file.type;
    return (
      name.endsWith('.pdf') ||
      name.endsWith('.docx') ||
      type === 'application/pdf' ||
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      type === 'application/msword'
    );
  };

  // ── Resume Handlers ──
  const handleResumeSelect = (file) => {
    setError('');
    if (!file) return;
    if (!isValidFileType(file)) {
      setError('Resume must be a PDF or DOCX file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Resume file size must be under 5MB.');
      return;
    }
    setResumeFile(file);
  };

  const handleResumeDrop = (e) => {
    e.preventDefault();
    setIsResumeDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleResumeSelect(e.dataTransfer.files[0]);
    }
  };

  // ── JD Handlers ──
  const handleJdSelect = (file) => {
    setError('');
    if (!file) return;
    if (!isValidFileType(file)) {
      setError('Job Description must be a PDF or DOCX file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Job Description file size must be under 5MB.');
      return;
    }
    setJdFile(file);
  };

  const handleJdDrop = (e) => {
    e.preventDefault();
    setIsJdDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleJdSelect(e.dataTransfer.files[0]);
    }
  };

  // Validation: Check if all 4 required fields are provided
  const isJdValid = jdMode === 'file' ? !!jdFile : jdText.trim().length > 0;
  const isFormValid =
    !!resumeFile &&
    isJdValid &&
    jobTitle.trim().length > 0 &&
    companyName.trim().length > 0 &&
    !loading;

  // Form Submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid) return;

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('resume', resumeFile);
      if (jdMode === 'file' && jdFile) {
        formData.append('jdFile', jdFile);
      } else {
        formData.append('jdText', jdText.trim());
      }
      formData.append('jobTitle', jobTitle.trim());
      formData.append('companyName', companyName.trim());
      formData.append('language', language || 'en');

      const res = await fetch(`${API_URL}/setup`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to setup interview session.');
      }

      // Success! Notify parent with session details
      onStartSession(data);
    } catch (err) {
      console.error('[SetupScreen] Submission error:', err);
      setError(err.message || 'An unexpected error occurred during setup.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container card" id="setup-panel">
      {/* Header */}
      <div className="setup-header">
        <div className="setup-icon-wrap">
          <div className="setup-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <div className="setup-icon-ring" />
        </div>
        <h2>Setup Your Interview</h2>
        <p className="setup-desc">
          Provide your candidate details & job description so our AI Interviewer can personalize your screening session.
        </p>
      </div>

      {/* Inline Error State */}
      {error && (
        <div className="setup-error-banner" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="setup-form">
        {/* Job Title & Company Row */}
        <div className="setup-grid">
          <div className="field">
            <label className="field-label" htmlFor="job-title-input">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              </svg>
              Job Title <span className="required-star">*</span>
            </label>
            <input
              id="job-title-input"
              type="text"
              className="field-input"
              placeholder="e.g. Senior Frontend Engineer"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="company-name-input">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18"></path>
                <path d="M9 8h1"></path>
                <path d="M9 12h1"></path>
                <path d="M9 16h1"></path>
                <path d="M14 8h1"></path>
                <path d="M14 12h1"></path>
                <path d="M14 16h1"></path>
                <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
              </svg>
              Company Name <span className="required-star">*</span>
            </label>
            <input
              id="company-name-input"
              type="text"
              className="field-input"
              placeholder="e.g. Stripe, Acme Corp"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={loading}
              required
            />
          </div>
        </div>

        {/* Resume Upload Box */}
        <div className="field">
          <label className="field-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span>Candidate Resume</span> <span className="field-label-sub">(PDF/DOCX, max 5MB)</span> <span className="required-star">*</span>
          </label>

          <input
            type="file"
            ref={resumeInputRef}
            onChange={(e) => e.target.files && handleResumeSelect(e.target.files[0])}
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: 'none' }}
          />

          <div
            className={`dropzone ${isResumeDragging ? 'drag-over' : ''} ${resumeFile ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsResumeDragging(true); }}
            onDragLeave={() => setIsResumeDragging(false)}
            onDrop={handleResumeDrop}
            onClick={() => !resumeFile && resumeInputRef.current?.click()}
          >
            {resumeFile ? (
              <div className="dropzone-success">
                <div className="dropzone-success-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <div className="dropzone-file-info">
                  <span className="dropzone-filename">{resumeFile.name}</span>
                  <span className="dropzone-filesize">({(resumeFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                </div>
                <button
                  type="button"
                  className="dropzone-remove-btn"
                  onClick={(e) => { e.stopPropagation(); setResumeFile(null); }}
                  title="Remove file"
                  disabled={loading}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="dropzone-prompt">
                <div className="dropzone-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                </div>
                <div className="dropzone-text">
                  <strong>Drag & drop resume</strong> or <span>browse files</span>
                </div>
                <span className="dropzone-hint">PDF or DOCX up to 5MB</span>
              </div>
            )}
          </div>
        </div>

        {/* Job Description Upload Box with Paste Text Toggle */}
        <div className="field">
          <div className="field-label-row">
            <label className="field-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              </svg>
              <span>Job Description</span> <span className="field-label-sub">(PDF/DOCX, max 5MB)</span> <span className="required-star">*</span>
            </label>
            <button
              type="button"
              className="toggle-link"
              onClick={() => {
                setError('');
                setJdMode(jdMode === 'file' ? 'text' : 'file');
              }}
              disabled={loading}
            >
              {jdMode === 'file' ? 'Paste text' : 'Upload file'}
            </button>
          </div>

          {jdMode === 'file' ? (
            <>
              <input
                type="file"
                ref={jdInputRef}
                onChange={(e) => e.target.files && handleJdSelect(e.target.files[0])}
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: 'none' }}
              />
              <div
                className={`dropzone ${isJdDragging ? 'drag-over' : ''} ${jdFile ? 'has-file' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsJdDragging(true); }}
                onDragLeave={() => setIsJdDragging(false)}
                onDrop={handleJdDrop}
                onClick={() => !jdFile && jdInputRef.current?.click()}
              >
                {jdFile ? (
                  <div className="dropzone-success">
                    <div className="dropzone-success-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </div>
                    <div className="dropzone-file-info">
                      <span className="dropzone-filename">{jdFile.name}</span>
                      <span className="dropzone-filesize">({(jdFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                    </div>
                    <button
                      type="button"
                      className="dropzone-remove-btn"
                      onClick={(e) => { e.stopPropagation(); setJdFile(null); }}
                      title="Remove file"
                      disabled={loading}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="dropzone-prompt">
                    <div className="dropzone-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                      </svg>
                    </div>
                    <div className="dropzone-text">
                      <strong>Drag & drop Job Description</strong> or <span>browse files</span>
                    </div>
                    <span className="dropzone-hint">PDF or DOCX up to 5MB</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <textarea
              className="field-textarea"
              placeholder="Paste the full job description or key responsibilities here..."
              rows={4}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              disabled={loading}
            />
          )}
        </div>

        {/* Language Selection */}
        <div className="field">
          <label className="field-label" htmlFor="lang-select-setup">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            Interview Language
          </label>
          <select
            id="lang-select-setup"
            className="field-select"
            value={language || 'en'}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={loading}
          >
            <option value="en">🇬🇧 English (UK)</option>
            <option value="hi">🇮🇳 Hindi (IN)</option>
            <option value="de">🇩🇪 German (DE)</option>
          </select>
        </div>

        <div className="setup-divider" />

        {/* Start Interview Submit Button */}
        <button
          type="submit"
          className="btn btn-primary btn-lg setup-submit-btn"
          disabled={!isFormValid}
          id="start-interview-btn"
        >
          {loading ? (
            <>
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              <span>Start Interview</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
