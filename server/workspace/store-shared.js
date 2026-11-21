// Workspace store: the error type, constants and small helpers every store section shares (store.js re-exports them).
import { createHash } from 'node:crypto';
import { FILE_EXT } from './model.js';

export class StoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export const sha = (text) => createHash('sha256').update(text).digest('hex');
export const MAX_TOMBSTONES = 1000;
export const isDpx = (name) => name.endsWith(FILE_EXT) && name.length > FILE_EXT.length;

// Version history: snapshots of saved files live in a hidden folder inside the workspace (never listed in the tree).
export const HISTORY_DIR = ['.drawing', 'history'];
export const HISTORY_INTERVAL_MS = 5 * 60 * 1000;
export const HISTORY_MAX = 50;
export const SNAPSHOT_ID = /^\d{13}$/;
export const BORN_FILE = 'born';
// Pipeline milestones a version stands for (E28): `labels.json` in the history dir maps a snapshot id to its labels.
// It moves with the history dir (move, trash); the history list shows them ("계획 초안", "승인", "완료").
export const LABELS_FILE = 'labels.json';
export const VERSION_LABELS = ['draft', 'approved', 'done'];
// Deleted files keep their version history (and last content) in `.drawing/trash/<id>/` for 30 days.
export const TRASH_DIR = ['.drawing', 'trash'];
export const TRASH_DAYS = 30;
export const TRASH_MAX = 200;
export const TRASH_ID = /^\d{13}-[0-9a-f]{8}$/;
// Pipeline run records (server/runs/) live beside history and follow the file the same way on move, delete and restore.
export const RUNS_DIR = ['.drawing', 'runs'];
