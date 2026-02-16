// ---------------------------------------------------------------------------
// Agent Data Storage — Per-user, per-agent filesystem storage
// Structure: /data/agents/{user_id}/{agent_id}/{type}/{id}.json
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { getStateValue, setStateValue } from '../database';

const resolveDataRoot = (): string => {
  const explicitRoot = (process.env.OPTIMAIZER_AGENTS_DATA_ROOT || '').trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  return path.resolve(__dirname, '../../../data/agents');
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function agentDir(userId: string, agentId: string): string {
  return path.join(resolveDataRoot(), userId, agentId);
}

function typeDir(userId: string, agentId: string, type: string): string {
  const dir = path.join(agentDir(userId, agentId), type);
  ensureDir(dir);
  return dir;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: any): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

const NOTES_WORKSPACE_KEY = 'notesWorkspace';
const NOTE_SNIPPET_MAX_CHARS = 180;

interface NotesWorkspaceNote {
  id: string;
  title: string;
  content: string;
  snippet: string;
  updatedAt: number;
  folderId?: string | null;
  archivedAt?: number | null;
  deletedAt?: number | null;
  tags?: string[];
  sourceAgentId?: string | null;
}

interface NotesWorkspaceSnapshot {
  notes?: NotesWorkspaceNote[];
  activeNoteId?: string;
  [key: string]: unknown;
}

const getScopedStateKey = (userId: string, key: string): string => `user:${userId}:${key}`;

const createNoteSnippet = (content: string): string => {
  const normalized = (content || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= NOTE_SNIPPET_MAX_CHARS) return normalized;
  return `${normalized.slice(0, NOTE_SNIPPET_MAX_CHARS - 1)}…`;
};

const normalizeNoteTimestamp = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const nextUpdatedTimestamp = (previous?: number): number => {
  const now = Date.now();
  if (typeof previous === 'number' && Number.isFinite(previous)) {
    return Math.max(now, previous + 1);
  }
  return now;
};

const sanitizeWorkspaceNote = (value: unknown): NotesWorkspaceNote | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<NotesWorkspaceNote>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.title !== 'string') return null;
  if (typeof candidate.content !== 'string') return null;
  if (typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt)) return null;

  const tags = Array.isArray(candidate.tags)
    ? candidate.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  return {
    id: candidate.id,
    title: candidate.title.trim() || 'Nota',
    content: candidate.content,
    snippet: typeof candidate.snippet === 'string' ? candidate.snippet : createNoteSnippet(candidate.content),
    updatedAt: candidate.updatedAt,
    folderId: typeof candidate.folderId === 'string' ? candidate.folderId : null,
    archivedAt: typeof candidate.archivedAt === 'number' ? candidate.archivedAt : null,
    deletedAt: typeof candidate.deletedAt === 'number' ? candidate.deletedAt : null,
    tags,
    sourceAgentId: typeof candidate.sourceAgentId === 'string' ? candidate.sourceAgentId : null,
  };
};

const readNotesWorkspaceSnapshot = (userId: string): NotesWorkspaceSnapshot => {
  const raw = getStateValue(getScopedStateKey(userId, NOTES_WORKSPACE_KEY));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as NotesWorkspaceSnapshot;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeNotesWorkspaceSnapshot = (userId: string, snapshot: NotesWorkspaceSnapshot): void => {
  setStateValue(getScopedStateKey(userId, NOTES_WORKSPACE_KEY), JSON.stringify(snapshot));
};

const readWorkspaceNotes = (userId: string): NotesWorkspaceNote[] => {
  const snapshot = readNotesWorkspaceSnapshot(userId);
  const rawNotes = Array.isArray(snapshot.notes) ? snapshot.notes : [];
  const notes = rawNotes
    .map((note) => sanitizeWorkspaceNote(note))
    .filter((note): note is NotesWorkspaceNote => Boolean(note));
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
};

const upsertWorkspaceNote = (userId: string, note: Note, sourceAgentId: string): void => {
  const snapshot = readNotesWorkspaceSnapshot(userId);
  const existing = readWorkspaceNotes(userId);
  const nextNote: NotesWorkspaceNote = {
    id: note.id,
    title: note.title,
    content: note.content,
    snippet: createNoteSnippet(note.content),
    updatedAt: note.updatedAt,
    folderId: null,
    archivedAt: null,
    deletedAt: null,
    tags: [...note.tags],
    sourceAgentId,
  };
  const nextNotes = existing.filter((item) => item.id !== note.id);
  nextNotes.unshift(nextNote);

  const activeNoteId =
    typeof snapshot.activeNoteId === 'string' && nextNotes.some((item) => item.id === snapshot.activeNoteId)
      ? snapshot.activeNoteId
      : nextNote.id;

  writeNotesWorkspaceSnapshot(userId, {
    ...snapshot,
    notes: nextNotes,
    activeNoteId,
  });
};

const removeWorkspaceNote = (userId: string, noteId: string): boolean => {
  const snapshot = readNotesWorkspaceSnapshot(userId);
  const existing = readWorkspaceNotes(userId);
  const nextNotes = existing.filter((item) => item.id !== noteId);
  if (nextNotes.length === existing.length) return false;

  const nextActive =
    typeof snapshot.activeNoteId === 'string' && nextNotes.some((item) => item.id === snapshot.activeNoteId)
      ? snapshot.activeNoteId
      : (nextNotes.find((item) => !item.deletedAt && !item.archivedAt)?.id || nextNotes[0]?.id || '');

  writeNotesWorkspaceSnapshot(userId, {
    ...snapshot,
    notes: nextNotes,
    activeNoteId: nextActive,
  });
  return true;
};

const workspaceNoteToNote = (note: NotesWorkspaceNote): Note => {
  const timestamp = normalizeNoteTimestamp(note.updatedAt, Date.now());
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: Array.isArray(note.tags) ? note.tags : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

// ---------------------------------------------------------------------------
// Note Types
// ---------------------------------------------------------------------------

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// List Types
// ---------------------------------------------------------------------------

export interface ListItem {
  id: string;
  text: string;
  checked: boolean;
  priority?: 'alta' | 'media' | 'baja';
  dueDate?: number;
  category?: string;
}

export interface UserList {
  id: string;
  title: string;
  items: ListItem[];
  category?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Scheduled Task Types (persistent)
// ---------------------------------------------------------------------------

export interface PersistedSchedule {
  id: string;
  name: string;
  cron: string;
  instruction: string;
  enabled: boolean;
  startAt?: number;
  frequency?: string;
  conditions?: string;
  timezone?: string;
  lastRunAt?: number;
  lastStatus?: 'success' | 'error';
  lastResult?: string;
  oneShot?: boolean;
  triggerAt?: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Notes CRUD
// ---------------------------------------------------------------------------

export function createNote(userId: string, agentId: string, title: string, content: string, tags: string[] = []): Note {
  const dir = typeDir(userId, agentId, 'notes');
  const id = generateId();
  const now = Date.now();
  const note: Note = { id, title, content, tags, createdAt: now, updatedAt: now };
  writeJsonFile(path.join(dir, `${id}.json`), note);
  upsertWorkspaceNote(userId, note, agentId);
  return note;
}

export function getNote(userId: string, agentId: string, noteId: string): Note | null {
  const dir = typeDir(userId, agentId, 'notes');
  const fileNote = readJsonFile<Note>(path.join(dir, `${noteId}.json`));
  if (fileNote) return fileNote;

  const workspaceNote = readWorkspaceNotes(userId).find((item) => item.id === noteId);
  if (!workspaceNote || workspaceNote.deletedAt) return null;
  return workspaceNoteToNote(workspaceNote);
}

export function getAllNotes(userId: string, agentId: string): Note[] {
  const dir = typeDir(userId, agentId, 'notes');
  const merged = new Map<string, Note>();
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const note = readJsonFile<Note>(path.join(dir, file));
      if (note) merged.set(note.id, note);
    }
  } catch {
    // Best-effort: still return workspace notes below.
  }

  const workspaceNotes = readWorkspaceNotes(userId);
  for (const workspaceNote of workspaceNotes) {
    if (workspaceNote.deletedAt) continue;
    if (!merged.has(workspaceNote.id)) {
      merged.set(workspaceNote.id, workspaceNoteToNote(workspaceNote));
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function updateNote(userId: string, agentId: string, noteId: string, updates: Partial<Pick<Note, 'title' | 'content' | 'tags'>>): Note | null {
  const dir = typeDir(userId, agentId, 'notes');
  const filePath = path.join(dir, `${noteId}.json`);
  const note = readJsonFile<Note>(filePath) || getNote(userId, agentId, noteId);
  if (!note) return null;

  if (updates.title !== undefined) note.title = updates.title;
  if (updates.content !== undefined) note.content = updates.content;
  if (updates.tags !== undefined) note.tags = updates.tags;
  note.updatedAt = nextUpdatedTimestamp(note.updatedAt);

  writeJsonFile(filePath, note);
  upsertWorkspaceNote(userId, note, agentId);
  return note;
}

export function deleteNote(userId: string, agentId: string, noteId: string): boolean {
  const dir = typeDir(userId, agentId, 'notes');
  const filePath = path.join(dir, `${noteId}.json`);
  let fileDeleted = false;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      fileDeleted = true;
    }
  } catch {
    // Continue to workspace removal.
  }
  const workspaceDeleted = removeWorkspaceNote(userId, noteId);
  return fileDeleted || workspaceDeleted;
}

const tokenizeNoteSearchQuery = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

const scoreNoteForQuery = (note: Note, normalizedQuery: string, queryTokens: string[]): number => {
  if (!normalizedQuery) return 0;

  const title = note.title.toLowerCase();
  const content = note.content.toLowerCase();
  const tags = note.tags.map((tag) => tag.toLowerCase());

  let score = 0;
  if (title === normalizedQuery) score += 200;
  if (tags.some((tag) => tag === normalizedQuery)) score += 140;
  if (title.includes(normalizedQuery)) score += 120;
  if (tags.some((tag) => tag.includes(normalizedQuery))) score += 90;
  if (content.includes(normalizedQuery)) score += 70;

  for (const token of queryTokens) {
    if (title.includes(token)) score += 18;
    if (tags.some((tag) => tag.includes(token))) score += 14;
    if (content.includes(token)) score += 9;
  }

  if (note.updatedAt > 0) {
    const ageDays = Math.max(0, (Date.now() - note.updatedAt) / (1000 * 60 * 60 * 24));
    score += Math.max(0, 12 - Math.min(12, ageDays));
  }

  return score;
};

export function searchNotes(userId: string, agentId: string, query: string, options?: { limit?: number }): Note[] {
  const notes = getAllNotes(userId, agentId);
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return notes;

  const queryTokens = tokenizeNoteSearchQuery(normalizedQuery);
  const ranked = notes
    .map((note) => ({ note, score: scoreNoteForQuery(note, normalizedQuery, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
    .map((entry) => entry.note);

  if (typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    return ranked.slice(0, Math.floor(options.limit));
  }

  return ranked;
}

// ---------------------------------------------------------------------------
// Lists CRUD
// ---------------------------------------------------------------------------

export function createList(userId: string, agentId: string, title: string, items: string[] = []): UserList {
  const dir = typeDir(userId, agentId, 'lists');
  const id = generateId();
  const now = Date.now();
  const list: UserList = {
    id,
    title,
    items: items.map((text, idx) => ({ id: `${id}-${idx}`, text, checked: false })),
    createdAt: now,
    updatedAt: now,
  };
  writeJsonFile(path.join(dir, `${id}.json`), list);
  return list;
}

export function getList(userId: string, agentId: string, listId: string): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  return readJsonFile<UserList>(path.join(dir, `${listId}.json`));
}

export function getAllLists(userId: string, agentId: string): UserList[] {
  const dir = typeDir(userId, agentId, 'lists');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const lists: UserList[] = [];
    for (const file of files) {
      const list = readJsonFile<UserList>(path.join(dir, file));
      if (list) lists.push(list);
    }
    return lists.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function findListByTitle(userId: string, agentId: string, title: string): UserList | null {
  const lists = getAllLists(userId, agentId);
  const lowerTitle = title.toLowerCase();
  return lists.find(l => l.title.toLowerCase() === lowerTitle) ||
         lists.find(l => l.title.toLowerCase().includes(lowerTitle)) ||
         null;
}

export function addItemsToList(userId: string, agentId: string, listId: string, items: string[]): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  for (const text of items) {
    list.items.push({ id: generateId(), text, checked: false });
  }
  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function updateList(
  userId: string,
  agentId: string,
  listId: string,
  updates: Partial<Pick<UserList, 'title'>>
): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  if (typeof updates.title === 'string') {
    list.title = updates.title;
  }
  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function updateListItemById(
  userId: string,
  agentId: string,
  listId: string,
  itemId: string,
  updates: Partial<Pick<ListItem, 'text' | 'checked'>>
): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  const target = list.items.find((item) => item.id === itemId);
  if (!target) return null;
  if (typeof updates.text === 'string') {
    target.text = updates.text;
  }
  if (typeof updates.checked === 'boolean') {
    target.checked = updates.checked;
  }
  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function deleteListItemById(userId: string, agentId: string, listId: string, itemId: string): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  const before = list.items.length;
  list.items = list.items.filter((item) => item.id !== itemId);
  if (list.items.length === before) return null;

  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function removeItemFromList(userId: string, agentId: string, listId: string, itemText: string): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  const lowerText = itemText.toLowerCase();
  const before = list.items.length;
  list.items = list.items.filter(i => !i.text.toLowerCase().includes(lowerText));

  if (list.items.length === before) return null; // nothing removed

  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function toggleListItem(userId: string, agentId: string, listId: string, itemText: string, checked: boolean): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  const lowerText = itemText.toLowerCase();
  let found = false;
  for (const item of list.items) {
    if (item.text.toLowerCase().includes(lowerText)) {
      item.checked = checked;
      found = true;
    }
  }
  if (!found) return null;

  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function deleteList(userId: string, agentId: string, listId: string): boolean {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Enhanced List Operations
// ---------------------------------------------------------------------------

export function updateListItem(
  userId: string,
  agentId: string,
  listId: string,
  itemText: string,
  updates: Partial<Pick<ListItem, 'text' | 'checked' | 'priority' | 'dueDate' | 'category'>>
): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  const lowerText = itemText.toLowerCase();
  const target = list.items.find((item) => item.text.toLowerCase().includes(lowerText));
  if (!target) return null;

  if (typeof updates.text === 'string') target.text = updates.text;
  if (typeof updates.checked === 'boolean') target.checked = updates.checked;
  if (updates.priority !== undefined) target.priority = updates.priority;
  if (typeof updates.dueDate === 'number') target.dueDate = updates.dueDate;
  if (typeof updates.category === 'string') target.category = updates.category;

  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function reorderListItems(
  userId: string,
  agentId: string,
  listId: string,
  orderedItemIds: string[]
): UserList | null {
  const dir = typeDir(userId, agentId, 'lists');
  const filePath = path.join(dir, `${listId}.json`);
  const list = readJsonFile<UserList>(filePath);
  if (!list) return null;

  const itemMap = new Map(list.items.map((item) => [item.id, item]));
  const reordered: ListItem[] = [];
  for (const id of orderedItemIds) {
    const item = itemMap.get(id);
    if (item) {
      reordered.push(item);
      itemMap.delete(id);
    }
  }
  // Append any items not in the order list
  for (const item of itemMap.values()) {
    reordered.push(item);
  }

  list.items = reordered;
  list.updatedAt = nextUpdatedTimestamp(list.updatedAt);
  writeJsonFile(filePath, list);
  return list;
}

export function getPendingListItems(userId: string, agentId: string): Array<{ listTitle: string; listId: string; item: ListItem }> {
  const lists = getAllLists(userId, agentId);
  const pending: Array<{ listTitle: string; listId: string; item: ListItem }> = [];
  for (const list of lists) {
    for (const item of list.items) {
      if (!item.checked) {
        pending.push({ listTitle: list.title, listId: list.id, item });
      }
    }
  }
  // Sort by priority (alta > media > baja > undefined), then by dueDate
  const priorityOrder: Record<string, number> = { alta: 0, media: 1, baja: 2 };
  pending.sort((a, b) => {
    const pa = a.item.priority ? priorityOrder[a.item.priority] ?? 3 : 3;
    const pb = b.item.priority ? priorityOrder[b.item.priority] ?? 3 : 3;
    if (pa !== pb) return pa - pb;
    const da = a.item.dueDate ?? Infinity;
    const db = b.item.dueDate ?? Infinity;
    return da - db;
  });
  return pending;
}

// ---------------------------------------------------------------------------
// Expense Types
// ---------------------------------------------------------------------------

export interface Expense {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  date: number;
  recurring?: boolean;
  recurringFrequency?: string;
  tags: string[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Expenses CRUD
// ---------------------------------------------------------------------------

export function createExpense(
  userId: string,
  agentId: string,
  data: { amount: number; currency?: string; category: string; description: string; date?: number; recurring?: boolean; recurringFrequency?: string; tags?: string[] }
): Expense {
  const dir = typeDir(userId, agentId, 'expenses');
  const id = generateId();
  const now = Date.now();
  const expense: Expense = {
    id,
    amount: data.amount,
    currency: data.currency || 'EUR',
    category: data.category,
    description: data.description,
    date: data.date || now,
    recurring: data.recurring || false,
    recurringFrequency: data.recurringFrequency,
    tags: data.tags || [],
    createdAt: now,
  };
  writeJsonFile(path.join(dir, `${id}.json`), expense);
  return expense;
}

export function getExpense(userId: string, agentId: string, expenseId: string): Expense | null {
  const dir = typeDir(userId, agentId, 'expenses');
  return readJsonFile<Expense>(path.join(dir, `${expenseId}.json`));
}

export function getAllExpenses(userId: string, agentId: string): Expense[] {
  const dir = typeDir(userId, agentId, 'expenses');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const expenses: Expense[] = [];
    for (const file of files) {
      const expense = readJsonFile<Expense>(path.join(dir, file));
      if (expense) expenses.push(expense);
    }
    return expenses.sort((a, b) => b.date - a.date);
  } catch {
    return [];
  }
}

export function searchExpenses(
  userId: string,
  agentId: string,
  filters: { category?: string; startDate?: number; endDate?: number; minAmount?: number; maxAmount?: number; query?: string }
): Expense[] {
  let expenses = getAllExpenses(userId, agentId);
  if (filters.category) {
    const lowerCat = filters.category.toLowerCase();
    expenses = expenses.filter(e => e.category.toLowerCase().includes(lowerCat));
  }
  if (filters.startDate) {
    expenses = expenses.filter(e => e.date >= filters.startDate!);
  }
  if (filters.endDate) {
    expenses = expenses.filter(e => e.date <= filters.endDate!);
  }
  if (typeof filters.minAmount === 'number') {
    expenses = expenses.filter(e => e.amount >= filters.minAmount!);
  }
  if (typeof filters.maxAmount === 'number') {
    expenses = expenses.filter(e => e.amount <= filters.maxAmount!);
  }
  if (filters.query) {
    const lowerQuery = filters.query.toLowerCase();
    expenses = expenses.filter(e =>
      e.description.toLowerCase().includes(lowerQuery) ||
      e.category.toLowerCase().includes(lowerQuery) ||
      e.tags.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }
  return expenses;
}

export function deleteExpense(userId: string, agentId: string, expenseId: string): boolean {
  const dir = typeDir(userId, agentId, 'expenses');
  const filePath = path.join(dir, `${expenseId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function updateExpense(
  userId: string,
  agentId: string,
  expenseId: string,
  updates: Partial<Omit<Expense, 'id' | 'createdAt'>>
): Expense | null {
  const dir = typeDir(userId, agentId, 'expenses');
  const filePath = path.join(dir, `${expenseId}.json`);
  const expense = readJsonFile<Expense>(filePath);
  if (!expense) return null;

  if (typeof updates.amount === 'number') expense.amount = updates.amount;
  if (typeof updates.currency === 'string') expense.currency = updates.currency;
  if (typeof updates.category === 'string') expense.category = updates.category;
  if (typeof updates.description === 'string') expense.description = updates.description;
  if (typeof updates.date === 'number') expense.date = updates.date;
  if (typeof updates.recurring === 'boolean') expense.recurring = updates.recurring;
  if (typeof updates.recurringFrequency === 'string') expense.recurringFrequency = updates.recurringFrequency;
  if (Array.isArray(updates.tags)) expense.tags = updates.tags;

  writeJsonFile(filePath, expense);
  return expense;
}

export function getExpenseSummary(
  userId: string,
  agentId: string,
  startDate?: number,
  endDate?: number
): { total: number; currency: string; byCategory: Record<string, number>; count: number; expenses: Expense[] } {
  const expenses = searchExpenses(userId, agentId, { startDate, endDate });
  const byCategory: Record<string, number> = {};
  let total = 0;
  const currency = expenses.length > 0 ? expenses[0].currency : 'EUR';

  for (const expense of expenses) {
    total += expense.amount;
    byCategory[expense.category] = (byCategory[expense.category] || 0) + expense.amount;
  }

  return { total, currency, byCategory, count: expenses.length, expenses };
}

export function exportExpensesToCSV(userId: string, agentId: string, startDate?: number, endDate?: number): string {
  const expenses = searchExpenses(userId, agentId, { startDate, endDate });
  const header = 'Fecha,Descripción,Categoría,Importe,Moneda,Recurrente,Tags';
  const rows = expenses.map(e => {
    const date = new Date(e.date).toLocaleDateString('es-ES');
    const desc = `"${e.description.replace(/"/g, '""')}"`;
    const cat = `"${e.category.replace(/"/g, '""')}"`;
    const tags = `"${e.tags.join(', ')}"`;
    return `${date},${desc},${cat},${e.amount.toFixed(2)},${e.currency},${e.recurring ? 'Sí' : 'No'},${tags}`;
  });
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Persistent Schedules
// ---------------------------------------------------------------------------

export function saveSchedule(userId: string, agentId: string, schedule: PersistedSchedule): void {
  const dir = typeDir(userId, agentId, 'schedules');
  writeJsonFile(path.join(dir, `${schedule.id}.json`), schedule);
}

export function getSchedule(userId: string, agentId: string, scheduleId: string): PersistedSchedule | null {
  const dir = typeDir(userId, agentId, 'schedules');
  return readJsonFile<PersistedSchedule>(path.join(dir, `${scheduleId}.json`));
}

export function getAllSchedules(userId: string, agentId: string): PersistedSchedule[] {
  const dir = typeDir(userId, agentId, 'schedules');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const schedules: PersistedSchedule[] = [];
    for (const file of files) {
      const sched = readJsonFile<PersistedSchedule>(path.join(dir, file));
      if (sched) schedules.push(sched);
    }
    return schedules.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function deleteSchedule(userId: string, agentId: string, scheduleId: string): boolean {
  const dir = typeDir(userId, agentId, 'schedules');
  const filePath = path.join(dir, `${scheduleId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function toggleSchedule(userId: string, agentId: string, scheduleId: string, enabled: boolean): PersistedSchedule | null {
  const dir = typeDir(userId, agentId, 'schedules');
  const filePath = path.join(dir, `${scheduleId}.json`);
  const schedule = readJsonFile<PersistedSchedule>(filePath);
  if (!schedule) return null;
  schedule.enabled = enabled;
  writeJsonFile(filePath, schedule);
  return schedule;
}

export function updateSchedule(
  userId: string,
  agentId: string,
  scheduleId: string,
  updates: Partial<PersistedSchedule>
): PersistedSchedule | null {
  const dir = typeDir(userId, agentId, 'schedules');
  const filePath = path.join(dir, `${scheduleId}.json`);
  const schedule = readJsonFile<PersistedSchedule>(filePath);
  if (!schedule) return null;
  const next: PersistedSchedule = {
    ...schedule,
    ...updates,
    id: schedule.id,
    createdAt: schedule.createdAt,
  };
  writeJsonFile(filePath, next);
  return next;
}

export function recordScheduleExecution(
  userId: string,
  agentId: string,
  scheduleId: string,
  execution: {
    executedAt?: number;
    status: 'success' | 'error';
    result?: string;
  }
): PersistedSchedule | null {
  return updateSchedule(userId, agentId, scheduleId, {
    lastRunAt: typeof execution.executedAt === 'number' && Number.isFinite(execution.executedAt)
      ? execution.executedAt
      : Date.now(),
    lastStatus: execution.status,
    lastResult: typeof execution.result === 'string' ? execution.result.slice(0, 600) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Persistent Conversation Memory
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Undo History — tracks tool executions for rollback
// ---------------------------------------------------------------------------

export interface UndoHistoryEntry {
  id: string;
  toolName: string;
  params: Record<string, any>;
  result: string;
  inverseAction: {
    toolName: string;
    params: Record<string, any>;
  } | null;
  timestamp: number;
}

const undoStacks = new Map<string, UndoHistoryEntry[]>();
const UNDO_MAX_DEPTH = 30;

function undoKey(userId: string, agentId: string): string {
  return `${userId}:${agentId}`;
}

export function pushUndoEntry(userId: string, agentId: string, entry: UndoHistoryEntry): void {
  const key = undoKey(userId, agentId);
  const stack = undoStacks.get(key) || [];
  stack.push(entry);
  if (stack.length > UNDO_MAX_DEPTH) stack.shift();
  undoStacks.set(key, stack);
}

export function popUndoEntry(userId: string, agentId: string): UndoHistoryEntry | null {
  const key = undoKey(userId, agentId);
  const stack = undoStacks.get(key);
  if (!stack || stack.length === 0) return null;
  return stack.pop()!;
}

export function peekUndoEntry(userId: string, agentId: string): UndoHistoryEntry | null {
  const key = undoKey(userId, agentId);
  const stack = undoStacks.get(key);
  if (!stack || stack.length === 0) return null;
  return stack[stack.length - 1];
}

export function getUndoStackSize(userId: string, agentId: string): number {
  const key = undoKey(userId, agentId);
  return undoStacks.get(key)?.length || 0;
}

// ---------------------------------------------------------------------------
// Location-based Reminders
// ---------------------------------------------------------------------------

export interface LocationReminder {
  id: string;
  name: string;
  message: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
  triggerOnEnter: boolean;
  lastTriggered?: number;
  createdAt: number;
}

export function createLocationReminder(
  userId: string,
  agentId: string,
  data: {
    name: string;
    message: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    triggerOnEnter?: boolean;
  }
): LocationReminder {
  const dir = typeDir(userId, agentId, 'location_reminders');
  const id = generateId();
  const now = Date.now();
  const reminder: LocationReminder = {
    id,
    name: data.name,
    message: data.message,
    latitude: data.latitude,
    longitude: data.longitude,
    radiusMeters: data.radiusMeters || 200,
    enabled: true,
    triggerOnEnter: data.triggerOnEnter !== false,
    createdAt: now,
  };
  writeJsonFile(path.join(dir, `${id}.json`), reminder);
  return reminder;
}

export function getAllLocationReminders(userId: string, agentId: string): LocationReminder[] {
  const dir = typeDir(userId, agentId, 'location_reminders');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const reminders: LocationReminder[] = [];
    for (const file of files) {
      const reminder = readJsonFile<LocationReminder>(path.join(dir, file));
      if (reminder) reminders.push(reminder);
    }
    return reminders.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function deleteLocationReminder(userId: string, agentId: string, reminderId: string): boolean {
  const dir = typeDir(userId, agentId, 'location_reminders');
  const filePath = path.join(dir, `${reminderId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function updateLocationReminder(
  userId: string,
  agentId: string,
  reminderId: string,
  updates: Partial<Omit<LocationReminder, 'id' | 'createdAt'>>
): LocationReminder | null {
  const dir = typeDir(userId, agentId, 'location_reminders');
  const filePath = path.join(dir, `${reminderId}.json`);
  const reminder = readJsonFile<LocationReminder>(filePath);
  if (!reminder) return null;
  if (typeof updates.enabled === 'boolean') reminder.enabled = updates.enabled;
  if (typeof updates.lastTriggered === 'number') reminder.lastTriggered = updates.lastTriggered;
  if (typeof updates.radiusMeters === 'number') reminder.radiusMeters = updates.radiusMeters;
  if (typeof updates.message === 'string') reminder.message = updates.message;
  if (typeof updates.name === 'string') reminder.name = updates.name;
  writeJsonFile(filePath, reminder);
  return reminder;
}

/**
 * Check if a position is within the radius of a location reminder.
 * Uses the Haversine formula for distance calculation.
 */
export function checkLocationProximity(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radiusMeters: number
): { isNear: boolean; distanceMeters: number } {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMeters = R * c;
  return { isNear: distanceMeters <= radiusMeters, distanceMeters: Math.round(distanceMeters) };
}

// ---------------------------------------------------------------------------
// Telegram File Storage
// ---------------------------------------------------------------------------

export interface StoredTelegramFile {
  id: string;
  telegramFileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  extractedText: string;
  type: 'document' | 'photo';
  createdAt: number;
}

export function storeTelegramFile(
  userId: string,
  agentId: string,
  data: Omit<StoredTelegramFile, 'id' | 'createdAt'>
): StoredTelegramFile {
  const dir = typeDir(userId, agentId, 'telegram_files');
  const id = generateId();
  const now = Date.now();
  const file: StoredTelegramFile = { id, ...data, createdAt: now };
  writeJsonFile(path.join(dir, `${id}.json`), file);
  return file;
}

export function getTelegramFile(userId: string, agentId: string, fileId: string): StoredTelegramFile | null {
  const dir = typeDir(userId, agentId, 'telegram_files');
  return readJsonFile<StoredTelegramFile>(path.join(dir, `${fileId}.json`));
}

export function getAllTelegramFiles(userId: string, agentId: string): StoredTelegramFile[] {
  const dir = typeDir(userId, agentId, 'telegram_files');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const stored: StoredTelegramFile[] = [];
    for (const file of files) {
      const entry = readJsonFile<StoredTelegramFile>(path.join(dir, file));
      if (entry) stored.push(entry);
    }
    return stored.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Working Memory — Scratchpad for intermediate task steps
// ---------------------------------------------------------------------------
// The Working Memory is a persistent notepad where the agent records
// intermediate reasoning, partial results, and task progress across multiple
// iterations.  This prevents losing context in deep tool-use loops or long
// multi-step tasks.
// ---------------------------------------------------------------------------

export interface WorkingMemoryEntry {
  id: string;
  /** Arbitrary label / category, e.g. "task_progress", "partial_result" */
  label: string;
  /** The actual content */
  content: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

const WORKING_MEMORY_MAX_ENTRIES = 30;

export function setWorkingMemory(
  userId: string,
  agentId: string,
  label: string,
  content: string
): WorkingMemoryEntry {
  const dir = typeDir(userId, agentId, 'working_memory');

  // Check if an entry with this label already exists — update it
  const existing = getWorkingMemoryByLabel(userId, agentId, label);
  if (existing) {
    existing.content = content;
    existing.updatedAt = Date.now();
    writeJsonFile(path.join(dir, `${existing.id}.json`), existing);
    return existing;
  }

  // Create new entry
  const id = generateId();
  const now = Date.now();
  const entry: WorkingMemoryEntry = {
    id,
    label,
    content,
    createdAt: now,
    updatedAt: now,
  };

  // Enforce max entries — evict oldest if at capacity
  const all = getAllWorkingMemory(userId, agentId);
  if (all.length >= WORKING_MEMORY_MAX_ENTRIES) {
    // Remove oldest entries to make room
    const toRemove = all.slice(WORKING_MEMORY_MAX_ENTRIES - 1);
    for (const old of toRemove) {
      try { fs.unlinkSync(path.join(dir, `${old.id}.json`)); } catch { /* ignore */ }
    }
  }

  writeJsonFile(path.join(dir, `${id}.json`), entry);
  return entry;
}

export function getWorkingMemoryByLabel(
  userId: string,
  agentId: string,
  label: string
): WorkingMemoryEntry | null {
  const all = getAllWorkingMemory(userId, agentId);
  return all.find((e) => e.label === label) || null;
}

export function getAllWorkingMemory(
  userId: string,
  agentId: string
): WorkingMemoryEntry[] {
  const dir = typeDir(userId, agentId, 'working_memory');
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const entries: WorkingMemoryEntry[] = [];
    for (const file of files) {
      const entry = readJsonFile<WorkingMemoryEntry>(path.join(dir, file));
      if (entry && typeof entry.content === 'string' && typeof entry.label === 'string') {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function deleteWorkingMemoryEntry(
  userId: string,
  agentId: string,
  entryId: string
): boolean {
  const dir = typeDir(userId, agentId, 'working_memory');
  const filePath = path.join(dir, `${entryId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function updateWorkingMemoryEntry(
  userId: string,
  agentId: string,
  entryId: string,
  updates: Partial<Pick<WorkingMemoryEntry, 'label' | 'content'>>
): WorkingMemoryEntry | null {
  const dir = typeDir(userId, agentId, 'working_memory');
  const filePath = path.join(dir, `${entryId}.json`);
  const existing = readJsonFile<WorkingMemoryEntry>(filePath);
  if (!existing) return null;

  if (typeof updates.label === 'string') {
    const nextLabel = updates.label.trim();
    if (nextLabel) {
      existing.label = nextLabel;
    }
  }
  if (typeof updates.content === 'string') {
    existing.content = updates.content;
  }
  existing.updatedAt = Date.now();
  writeJsonFile(filePath, existing);
  return existing;
}

export function clearWorkingMemory(userId: string, agentId: string): number {
  const dir = typeDir(userId, agentId, 'working_memory');
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    let deleted = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(dir, file));
        deleted += 1;
      } catch { /* ignore */ }
    }
    return deleted;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Persistent Conversation Memory (continued)
// ---------------------------------------------------------------------------

export interface PersistedConversationMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool_result';
  content: string;
  timestamp: number;
}

const MEMORY_TOKEN_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ0-9_./:#-]+/g;
const MEMORY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'for', 'from', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'so', 'that', 'the', 'their', 'them', 'there',
  'they', 'this', 'to', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
  'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'que', 'en', 'es', 'por',
  'con', 'para', 'se', 'lo', 'le', 'les', 'su', 'sus', 'como', 'más', 'mas', 'ya', 'mi', 'tu', 'nos', 'también',
  'tambien', 'muy', 'todo', 'toda', 'todos', 'todas',
]);

const extractMemoryTerms = (value: string): string[] => {
  const matches: string[] = value.toLowerCase().match(MEMORY_TOKEN_PATTERN) ?? [];
  return Array.from(
    new Set(
      matches.filter((token) => token.length >= 3 && !MEMORY_STOP_WORDS.has(token))
    )
  );
};

export function appendConversationMessage(
  userId: string,
  agentId: string,
  message: Omit<PersistedConversationMessage, 'id'>
): PersistedConversationMessage {
  const dir = typeDir(userId, agentId, 'conversation');
  const id = generateId();
  const entry: PersistedConversationMessage = {
    id,
    role: message.role,
    content: message.content,
    timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
  };
  writeJsonFile(path.join(dir, `${id}.json`), entry);
  return entry;
}

export function getAllConversationMessages(userId: string, agentId: string): PersistedConversationMessage[] {
  const dir = typeDir(userId, agentId, 'conversation');
  try {
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
    const messages: PersistedConversationMessage[] = [];
    for (const file of files) {
      const message = readJsonFile<PersistedConversationMessage>(path.join(dir, file));
      if (message && typeof message.content === 'string' && typeof message.role === 'string') {
        messages.push(message);
      }
    }
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

export function getRecentConversationMessages(
  userId: string,
  agentId: string,
  limit = 60
): PersistedConversationMessage[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const all = getAllConversationMessages(userId, agentId);
  if (all.length <= limit) return all;
  return all.slice(all.length - limit);
}

export function searchConversationMessages(
  userId: string,
  agentId: string,
  query: string,
  options?: { limit?: number; maxScan?: number }
): PersistedConversationMessage[] {
  const queryTerms = extractMemoryTerms(query);
  if (queryTerms.length === 0) return [];

  const requestedLimit = typeof options?.limit === 'number' && Number.isFinite(options.limit) ? options.limit : 8;
  const requestedMaxScan = typeof options?.maxScan === 'number' && Number.isFinite(options.maxScan) ? options.maxScan : 500;
  const limit = Math.max(1, Math.floor(requestedLimit));
  const maxScan = Math.max(20, Math.floor(requestedMaxScan));
  const recentMessages = getRecentConversationMessages(userId, agentId, maxScan);
  if (recentMessages.length === 0) return [];

  const scored = recentMessages
    .map((message, index) => {
      const terms = extractMemoryTerms(message.content);
      const overlap = terms.filter((term) => queryTerms.includes(term)).length;
      if (overlap === 0) return null;
      const recencyBoost = (index + 1) / recentMessages.length;
      const roleBoost = message.role === 'user' ? 0.3 : message.role === 'assistant' ? 0.2 : 0;
      return { message, score: overlap * 3 + recencyBoost + roleBoost };
    })
    .filter((item): item is { message: PersistedConversationMessage; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.message.timestamp - b.message.timestamp);

  return scored.map((item) => item.message);
}

export function clearConversationMessages(userId: string, agentId: string): number {
  const dir = typeDir(userId, agentId, 'conversation');
  try {
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
    let deleted = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(dir, file));
        deleted += 1;
      } catch {
        // Keep deleting the rest.
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Always-On Configuration
// ---------------------------------------------------------------------------

const ALWAYS_ON_STATE_KEY_PREFIX = 'agent_always_on:';

/**
 * Mark an agent as always-on. Stores the full agent config so it can be
 * redeployed automatically on server restart.
 */
export function setAlwaysOn(userId: string, agentId: string, alwaysOn: boolean, agentConfig?: string): void {
  const key = `${ALWAYS_ON_STATE_KEY_PREFIX}${userId}:${agentId}`;
  if (alwaysOn && agentConfig) {
    setStateValue(key, agentConfig);
  } else {
    // Remove the key — using setStateValue with empty string signals "off",
    // but it's cleaner to just delete it.
    try {
      const db = require('../database').getDatabase();
      db.prepare('DELETE FROM state_store WHERE key = ?').run(key);
    } catch {
      // Fallback: set empty
      setStateValue(key, '');
    }
  }
}

/**
 * Get all always-on agent IDs for a specific user.
 */
export function getAlwaysOnAgentIds(userId: string): string[] {
  const prefix = `${ALWAYS_ON_STATE_KEY_PREFIX}${userId}:`;
  try {
    const db = require('../database').getDatabase();
    const rows = db.prepare('SELECT key, value FROM state_store WHERE key LIKE ?').all(`${prefix}%`) as Array<{ key: string; value: string }>;
    return rows
      .filter((row) => row.value && row.value.length > 2) // non-empty JSON
      .map((row) => row.key.replace(prefix, ''));
  } catch {
    return [];
  }
}

/**
 * Get all always-on agent configs for a specific user (for auto-restart).
 */
export function getAllAlwaysOnConfigs(userId: string): Array<{ agentId: string; configJson: string }> {
  const prefix = `${ALWAYS_ON_STATE_KEY_PREFIX}${userId}:`;
  try {
    const db = require('../database').getDatabase();
    const rows = db.prepare('SELECT key, value FROM state_store WHERE key LIKE ?').all(`${prefix}%`) as Array<{ key: string; value: string }>;
    return rows
      .filter((row) => row.value && row.value.length > 2)
      .map((row) => ({
        agentId: row.key.replace(prefix, ''),
        configJson: row.value,
      }));
  } catch {
    return [];
  }
}

/**
 * Get all always-on configs across ALL users (for server boot auto-start).
 */
export function getAllAlwaysOnConfigsGlobal(): Array<{ userId: string; agentId: string; configJson: string }> {
  try {
    const db = require('../database').getDatabase();
    const rows = db.prepare('SELECT key, value FROM state_store WHERE key LIKE ?').all(`${ALWAYS_ON_STATE_KEY_PREFIX}%`) as Array<{ key: string; value: string }>;
    return rows
      .filter((row) => row.value && row.value.length > 2)
      .map((row) => {
        const rest = row.key.replace(ALWAYS_ON_STATE_KEY_PREFIX, '');
        const separatorIndex = rest.indexOf(':');
        if (separatorIndex === -1) return null;
        return {
          userId: rest.slice(0, separatorIndex),
          agentId: rest.slice(separatorIndex + 1),
          configJson: row.value,
        };
      })
      .filter((item): item is { userId: string; agentId: string; configJson: string } => item !== null);
  } catch {
    return [];
  }
}
