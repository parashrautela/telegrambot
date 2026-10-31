import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openWorkspaceDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL, passwordHash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, telegramId TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, clientId TEXT NOT NULL REFERENCES clients(id), location TEXT NOT NULL DEFAULT '', workflowId TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Setup', telegramProjectId TEXT UNIQUE, groupChatId TEXT UNIQUE, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (projectId TEXT NOT NULL REFERENCES projects(id), userId TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(projectId,userId));
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'Task', stage TEXT NOT NULL DEFAULT '', ownerId TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'Open', decision TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', nextAction TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL REFERENCES tasks(id), authorId TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, attachmentUrl TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reads (taskId TEXT NOT NULL REFERENCES tasks(id), userId TEXT NOT NULL REFERENCES users(id), lastSeq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(taskId,userId));
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), type TEXT NOT NULL, body TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL, source TEXT NOT NULL, sourceMessageId TEXT NOT NULL DEFAULT '', sourceMetadata TEXT NOT NULL DEFAULT '{}', attachments TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'Pending', taskId TEXT REFERENCES tasks(id), reviewNote TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, reviewedAt TEXT);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), projectId TEXT NOT NULL REFERENCES projects(id), taskId TEXT REFERENCES tasks(id), kind TEXT NOT NULL, body TEXT NOT NULL, readAt TEXT, createdAt TEXT NOT NULL, requestId TEXT REFERENCES requests(id), messageSeq INTEGER REFERENCES messages(seq));
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actorId TEXT NOT NULL, projectId TEXT, action TEXT NOT NULL, details TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_thread ON messages(taskId,seq);
      CREATE INDEX IF NOT EXISTS notification_user ON notifications(userId,createdAt);
      CREATE INDEX IF NOT EXISTS request_project ON requests(projectId,status);
    `);
  // Additive migrations preserve databases created during the first preview.
  const requestColumns = db
    .prepare('PRAGMA table_info(requests)')
    .all()
    .map((column) => column.name);
  if (!requestColumns.includes('sourceMetadata'))
    db.exec("ALTER TABLE requests ADD COLUMN sourceMetadata TEXT NOT NULL DEFAULT '{}'");
  const notificationColumns = db
    .prepare('PRAGMA table_info(notifications)')
    .all()
    .map((column) => column.name);
  if (!notificationColumns.includes('requestId'))
    db.exec('ALTER TABLE notifications ADD COLUMN requestId TEXT REFERENCES requests(id)');
  if (!notificationColumns.includes('messageSeq'))
    db.exec('ALTER TABLE notifications ADD COLUMN messageSeq INTEGER REFERENCES messages(seq)');
  const taskColumns = db
    .prepare('PRAGMA table_info(tasks)')
    .all()
    .map((column) => column.name);
  for (const column of ['scheduledStart', 'scheduledEnd']) {
    if (!taskColumns.includes(column)) db.exec(`ALTER TABLE tasks ADD COLUMN ${column} TEXT`);
  }

  return db;
}
