import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const uploadDir = path.join(root, 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const valid = file.mimetype === 'application/pdf' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.(pdf|docx)$/i.test(file.originalname);
    cb(valid ? null : new Error('Only PDF and DOCX files are supported.'), valid);
  }
});

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
const publicFileUrl = (filename) => {
  const base = (process.env.PUBLIC_FILE_BASE || '').replace(/\/$/, '');
  return `${base || '/files'}/${filename}`;
};
const normalizeUrl = (value) => { try { const u = new URL(String(value).trim()); if (!/^https?:$/.test(u.protocol)) throw new Error(); return u.toString().replace(/\/$/, ''); } catch { return null; } };

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/resumes', (req, res) => {
  upload.single('resume')(req, res, (error) => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, error: error.message });
    if (!req.file) return res.status(400).json({ success: false, error: 'Please upload a PDF or DOCX resume.' });
    const resumeId = id('resume');
    const extension = path.extname(req.file.originalname).toLowerCase();
    const storedFilename = `${resumeId}${extension}`;
    const storedPath = path.join(uploadDir, storedFilename);
    fs.renameSync(req.file.path, storedPath);
    const createdAt = now();
    getDb().prepare('INSERT INTO resumes (id, filename, stored_filename, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(resumeId, req.file.originalname, storedFilename, req.file.mimetype, req.file.size, createdAt);
    return res.status(201).json({ success: true, data: { id: resumeId, filename: req.file.originalname, size: req.file.size, file: publicFileUrl(storedFilename) } });
  });
});

app.delete('/api/resumes/:id', (req, res) => {
  const db = getDb();
  const resume = db.prepare('SELECT * FROM resumes WHERE id = ?').get(req.params.id);
  if (!resume) return res.status(404).json({ success: false, error: 'Resume not found.' });
  const active = db.prepare('SELECT COUNT(*) AS count FROM analyses WHERE resume_id = ? AND status IN (\'pending\', \'analyzing\')').get(resume.id);
  if (active.count) return res.status(409).json({ success: false, error: 'This resume is being analyzed.' });
  try { fs.unlinkSync(path.join(uploadDir, resume.stored_filename)); } catch { /* already removed */ }
  db.prepare('DELETE FROM resumes WHERE id = ?').run(resume.id);
  res.json({ success: true });
});

app.get('/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const record = getDb().prepare('SELECT * FROM resumes WHERE stored_filename = ?').get(filename);
  if (!record) return res.status(404).json({ success: false, error: 'File not found.' });
  res.type(record.mime_type).sendFile(path.join(uploadDir, filename));
});

app.post('/api/analyze', async (req, res) => {
  const { resumeId, jobDescription, atenxionUrl, atenxionToken } = req.body || {};
  const db = getDb();
  const resume = resumeId && db.prepare('SELECT * FROM resumes WHERE id = ?').get(resumeId);
  const url = normalizeUrl(atenxionUrl);
  if (!resume) return res.status(400).json({ success: false, error: 'Please upload a resume.' });
  if (!String(jobDescription || '').trim()) return res.status(400).json({ success: false, error: 'Please enter a job description.' });
  if (!url) return res.status(400).json({ success: false, error: 'Please provide a valid Atenxion URL.' });
  if (!String(atenxionToken || '').trim()) return res.status(400).json({ success: false, error: 'Please provide an Atenxion token.' });
  const eventId = id('event');
  const timestamp = now();
  db.prepare('INSERT INTO analyses (id, event_id, resume_id, resume_filename, resume_file, job_description, atenxion_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id('analysis'), eventId, resume.id, resume.filename, publicFileUrl(resume.stored_filename), String(jobDescription).trim(), url, 'pending', timestamp, timestamp);
  const endpoint = `${url}/api/trigger/agent-trigger`;
  try {
    db.prepare('UPDATE analyses SET status = ?, updated_at = ? WHERE event_id = ?').run('analyzing', now(), eventId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const trigger = await fetch(endpoint, { method: 'POST', headers: { Authorization: String(atenxionToken).trim(), 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: eventId, jobDescription: String(jobDescription).trim(), attachments: [publicFileUrl(resume.stored_filename)] }), signal: controller.signal });
    clearTimeout(timeout);
    if (!trigger.ok) throw new Error(`Trigger returned ${trigger.status}`);
    return res.status(202).json({ success: true, data: { event_id: eventId, status: 'analyzing' } });
  } catch (error) {
    db.prepare('UPDATE analyses SET status = ?, error = ?, updated_at = ? WHERE event_id = ?').run('failed', error.name === 'AbortError' ? 'The Atenxion request timed out.' : 'Unable to start the analysis.', now(), eventId);
    return res.status(502).json({ success: false, error: 'We couldn\'t start the analysis. Please check your Atenxion configuration and try again.', event_id: eventId });
  }
});

app.get('/api/analysis/:eventId', (req, res) => {
  const row = getDb().prepare('SELECT * FROM analyses WHERE event_id = ?').get(req.params.eventId);
  if (!row) return res.status(404).json({ success: false, error: 'Analysis not found.' });
  const data = { event_id: row.event_id, status: row.status };
  if (row.result) data.result = JSON.parse(row.result);
  if (row.error) data.error = row.error;
  res.json({ success: true, data });
});

app.post('/api/analysis/result', (req, res) => {
  const body = req.body || {};
  if (!body.event_id || typeof body.event_id !== 'string') return res.status(400).json({ success: false, error: 'event_id is required.' });
  const row = getDb().prepare('SELECT event_id FROM analyses WHERE event_id = ?').get(body.event_id);
  if (!row) return res.status(404).json({ success: false, error: 'Unknown event_id.' });
  if (typeof body.overallScore !== 'number' || !Array.isArray(body.skillsDetected) || !body.experience || !Array.isArray(body.education) || !Array.isArray(body.missingInformation) || !Array.isArray(body.strengths) || !Array.isArray(body.improvementSuggestions)) return res.status(400).json({ success: false, error: 'Invalid analysis result payload.' });
  const result = { overallScore: body.overallScore, skillsDetected: body.skillsDetected, experience: body.experience, education: body.education, missingInformation: body.missingInformation, strengths: body.strengths, improvementSuggestions: body.improvementSuggestions };
  getDb().prepare('UPDATE analyses SET result = ?, status = ?, updated_at = ?, error = NULL WHERE event_id = ?').run(JSON.stringify(result), 'completed', now(), body.event_id);
  res.json({ success: true, event_id: body.event_id, status: 'completed' });
});

app.get('/api/openapi.json', (_req, res) => res.json(openApi));

const openApi = {
  openapi: '3.0.3',
  info: { title: 'Resume Analyzer Callback API', version: '1.0.0', description: 'Receives completed resume analysis results from an external Atenxion agent.' },
  servers: [{ url: '/' }],
  paths: {
    '/api/analysis/result': {
      post: {
        summary: 'Submit a completed resume analysis', operationId: 'submitAnalysisResult',
        requestBody: { required: true, content: { 'application/json': {
          schema: { $ref: '#/components/schemas/AnalysisResultRequest' },
          example: { event_id: 'event_32619ea0db73', overallScore: 87, skillsDetected: ['Python', 'FastAPI', 'PostgreSQL', 'Docker'], experience: { summary: '4 years of backend development experience', years: 4 }, education: ['Bachelor of Computer Science'], missingInformation: ['AWS experience is not clearly mentioned'], strengths: ['Strong Python backend experience'], improvementSuggestions: ['Add measurable results to project descriptions'] }
        } } },
        responses: { 200: { description: 'Result accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }, 400: { description: 'Invalid payload' }, 404: { description: 'Unknown event_id' } }
      }
    }
  },
  components: { schemas: {
    Experience: { type: 'object', required: ['summary', 'years'], properties: { summary: { type: 'string' }, years: { type: 'number' } } },
    AnalysisResultRequest: { type: 'object', required: ['event_id', 'overallScore', 'skillsDetected', 'experience', 'education', 'missingInformation', 'strengths', 'improvementSuggestions'], properties: { event_id: { type: 'string' }, overallScore: { type: 'number', minimum: 0, maximum: 100 }, skillsDetected: { type: 'array', items: { type: 'string' } }, experience: { $ref: '#/components/schemas/Experience' }, education: { type: 'array', items: { type: 'string' } }, missingInformation: { type: 'array', items: { type: 'string' } }, strengths: { type: 'array', items: { type: 'string' } }, improvementSuggestions: { type: 'array', items: { type: 'string' } } } },
    SuccessResponse: { type: 'object', properties: { success: { type: 'boolean' }, event_id: { type: 'string' }, status: { type: 'string', example: 'completed' } } }
  } }
};

const frontendDist = path.join(root, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) { app.use(express.static(frontendDist)); app.use((_req, res) => res.sendFile(path.join(frontendDist, 'index.html'))); }

app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: 'Something went wrong.' }));
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Resume Analyzer listening on ${port}`));
