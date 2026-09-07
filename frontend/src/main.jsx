import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ChevronRight, CircleAlert, FileText, KeyRound, LoaderCircle, LockKeyhole, Settings2, Sparkles, UploadCloud, X } from 'lucide-react';
import './styles.css';

const CONFIG_KEY = 'resunizer-config';
const ACTIVE_KEY = 'resunizer-active-event';
const formatSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function App() {
  const [config, setConfig] = useState(() => JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'));
  const [configOpen, setConfigOpen] = useState(false);
  const [draft, setDraft] = useState(config);
  const [showToken, setShowToken] = useState(false);
  const [resume, setResume] = useState(null);
  const [jobDescription, setJobDescription] = useState('');
  const [status, setStatus] = useState('idle');
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  const configured = Boolean(config.atenxionUrl && config.atenxionToken);
  const openConfig = () => { setDraft(config); setConfigOpen(true); setError(''); };
  const saveConfig = (event) => {
    event.preventDefault();
    const url = draft.atenxionUrl.trim().replace(/\/$/, '');
    if (!url || !draft.atenxionToken.trim()) return;
    const next = { atenxionUrl: url, atenxionToken: draft.atenxionToken.trim() };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); setConfig(next); setConfigOpen(false);
  };

  const uploadResume = async (file) => {
    setError('');
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) return setError('Please choose a PDF or DOCX file.');
    if (file.size > 10 * 1024 * 1024) return setError('That file is larger than 10 MB.');
    setUploading(true);
    try {
      const form = new FormData(); form.append('resume', file);
      const response = await fetch('/api/resumes', { method: 'POST', body: form });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to upload your resume.');
      setResume(body.data);
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  };

  const analyze = async () => {
    setError('');
    if (!configured) { setError('Please configure the Atenxion URL and token first.'); return setConfigOpen(true); }
    if (!resume) return setError('Please upload a resume.');
    if (!jobDescription.trim()) return setError('Please enter a job description.');
    setStatus('starting');
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeId: resume.id, jobDescription, ...config }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'We couldn’t start the analysis.');
      localStorage.setItem(ACTIVE_KEY, body.data.event_id); setStatus('analyzing'); poll(body.data.event_id);
    } catch (e) { setStatus('idle'); setError(e.message); }
  };

  const poll = async (eventId) => {
    try {
      const response = await fetch(`/api/analysis/${encodeURIComponent(eventId)}`); const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to retrieve this analysis.');
      if (body.data.status === 'completed') { setAnalysis(body.data.result); setStatus('completed'); localStorage.removeItem(ACTIVE_KEY); return; }
      if (body.data.status === 'failed') { setStatus('failed'); setError(body.data.error || 'The analysis could not be completed.'); localStorage.removeItem(ACTIVE_KEY); return; }
      setTimeout(() => poll(eventId), 4000);
    } catch (e) { setStatus('failed'); setError(e.message); }
  };

  useEffect(() => { const active = localStorage.getItem(ACTIVE_KEY); if (active) { setStatus('analyzing'); poll(active); } }, []);
  const canAnalyze = Boolean(resume && jobDescription.trim() && configured) && !['starting', 'analyzing'].includes(status);

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark"><Sparkles size={17}/></span><span>Resunizer</span></a><div className="header-actions"><span className={`config-state ${configured ? 'ready' : ''}`}><span className="status-dot" />{configured ? 'Configured' : 'Not configured'}</span><button className="button button-quiet" onClick={openConfig}><Settings2 size={16}/> Configuration</button></div></header>
    <main className="main-content">
      {status === 'completed' && analysis ? <ResultView result={analysis} onReset={() => { setStatus('idle'); setAnalysis(null); setError(''); }} /> : status === 'analyzing' || status === 'starting' ? <Analyzing /> : <>
        <section className="intro"><div className="eyebrow"><span /> CAREER TOOLKIT</div><h1>Find the signal<br/><i>in your resume.</i></h1><p>See how your experience lines up with the role you want next. Get a clear, honest analysis in minutes.</p></section>
        <section className="work-card">
          <div className="step-heading"><span className="step-number">01</span><div><h2>Upload your resume</h2><p>Start with your most recent version.</p></div></div>
          <div className={`drop-zone ${resume ? 'has-file' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadResume(e.dataTransfer.files[0]); }} onClick={() => !resume && fileInput.current?.click()}>
            <input ref={fileInput} type="file" hidden accept=".pdf,.docx" onChange={e => uploadResume(e.target.files[0])}/>
            {uploading ? <LoaderCircle className="spin" size={28}/> : resume ? <><div className="file-icon"><FileText size={22}/></div><div className="file-meta"><strong>{resume.filename}</strong><span>{formatSize(resume.size)} · Ready to analyze</span></div><button className="replace-button" onClick={e => { e.stopPropagation(); setResume(null); fileInput.current?.click(); }}>Replace</button><CheckCircle2 className="file-check" size={19}/></> : <><div className="upload-icon"><UploadCloud size={23}/></div><strong>Drop your resume here</strong><span>or <u>browse files</u></span><small>PDF or DOCX · Max 10 MB</small></>}
          </div>
          <div className="step-heading description-heading"><span className="step-number">02</span><div><h2>Job description</h2><p>Paste the role you’re applying for.</p></div></div>
          <textarea value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="Paste the job description here..." maxLength={10000}/><div className="textarea-footer"><span>Be as specific as possible for a sharper match.</span><span>{jobDescription.length}/10,000</span></div>
          {error && <div className="error-banner"><CircleAlert size={17}/><span>{error}</span>{error.includes('configure') && <button onClick={openConfig}>Open Configuration</button>}</div>}
          <button className="button button-primary analyze-button" disabled={!canAnalyze} onClick={analyze}>Analyze Resume <ChevronRight size={18}/></button>
          {!configured && <div className="config-hint"><LockKeyhole size={14}/> Configure your Atenxion connection before analyzing.</div>}
        </section>
      </>}
    </main>
    <footer><span>Private by design · Your resume is used only for this analysis.</span><span className="footer-mark">RA / 01</span></footer>
    {configOpen && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setConfigOpen(false)}><form className="modal" onSubmit={saveConfig}><div className="modal-header"><div><span className="modal-kicker">CONNECTION</span><h2>Configuration</h2></div><button type="button" className="icon-button" onClick={() => setConfigOpen(false)}><X size={18}/></button></div><p className="modal-copy">Connect your workspace to the Atenxion analysis agent.</p><label>Atenxion Backend URL<div className="input-wrap"><Settings2 size={16}/><input required type="url" placeholder="https://backend.atenxion.ai" value={draft.atenxionUrl || ''} onChange={e => setDraft({...draft, atenxionUrl: e.target.value})}/></div></label><label>Atenxion Token<div className="input-wrap"><KeyRound size={16}/><input required type={showToken ? 'text' : 'password'} placeholder="Your access token" value={draft.atenxionToken || ''} onChange={e => setDraft({...draft, atenxionToken: e.target.value})}/><button type="button" className="show-button" onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide' : 'Show'}</button></div></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setConfigOpen(false)}>Cancel</button><button className="button button-primary" type="submit">Save Configuration</button></div></form></div>}
  </div>;
}

function Analyzing() { return <section className="state-panel"><div className="pulse-ring"><LoaderCircle className="spin" size={26}/></div><span className="eyebrow"><span /> IN PROGRESS</span><h1>Analyzing your resume</h1><p>We’re comparing your experience against the job description.<br/>This may take a minute or two.</p><div className="analyzing-label"><span className="loading-dots"/>Analyzing<span className="dots">...</span></div><small>Keep this page open — we’ll show your results as soon as they’re ready.</small></section>; }
function ResultView({ result, onReset }) { const score = Number(result.overallScore) || 0; return <section className="result-view"><div className="result-top"><div><div className="eyebrow"><span /> YOUR ANALYSIS</div><h1>Resume <i>analysis.</i></h1><p>Here’s how your experience matches the role.</p></div><button className="button button-quiet" onClick={onReset}>Analyze another <ChevronRight size={16}/></button></div><div className="score-card"><div className="score-copy"><span className="section-label">OVERALL SCORE</span><div className="score-number">{score}<small>/ 100</small></div><strong>{score >= 80 ? 'Strong Match' : score >= 60 ? 'Promising Match' : 'Needs Attention'}</strong><p>A strong foundation for this opportunity.</p></div><div className="score-ring" style={{'--score': `${score * 3.6}deg`}}><div><b>{score}</b><span>match</span></div></div></div><div className="result-grid"><ResultSection title="Skills detected" items={result.skillsDetected} chips/><ResultSection title="Experience" content={<><strong className="experience-years">{result.experience?.years ?? '—'} years</strong><p>{result.experience?.summary || 'No experience summary provided.'}</p></>}/><ResultSection title="Education" items={result.education}/><ResultSection title="Missing information" items={result.missingInformation} caution/><ResultSection title="Strengths" items={result.strengths} positive/><ResultSection title="Improvement suggestions" items={result.improvementSuggestions} /></div></section>; }
function ResultSection({ title, items = [], content, chips, caution, positive }) { return <article className={`result-section ${caution ? 'caution' : ''}`}><h3>{title}</h3>{content || (chips ? <div className="chips">{items.map((x, i) => <span key={i}>{x}</span>)}</div> : <ul>{items.map((x, i) => <li key={i} className={positive ? 'positive' : ''}>{x}</li>)}</ul>)}</article>; }
createRoot(document.getElementById('root')).render(<App/>);
