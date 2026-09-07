import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

let db;

export function getDb() {
  if (!db) {
    const filename = process.env.SQLITE_PATH || './data/app.sqlite';
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    db = new Database(filename);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, stored_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, resume_id TEXT NOT NULL,
      resume_filename TEXT NOT NULL, resume_file TEXT NOT NULL, job_description TEXT NOT NULL,
      atenxion_url TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (resume_id) REFERENCES resumes(id)
    );`);
  }
  return db;
}

export function closeDb() { if (db) { db.close(); db = undefined; } }
