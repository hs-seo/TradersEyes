import type { JournalEntry, AlignSession } from "./types";

// localStorage-based persistence for Phase 1
// Will be replaced with DB in Phase 3+

const JOURNAL_KEY = "te_journal_entries";
const ALIGN_KEY = "te_align_sessions";

export function getJournalEntries(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveJournalEntry(entry: JournalEntry): void {
  const entries = getJournalEntries();
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.unshift(entry);
  }
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
}

export function deleteJournalEntry(id: string): void {
  const entries = getJournalEntries().filter((e) => e.id !== id);
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
}

export function getAlignSessions(): AlignSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(ALIGN_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveAlignSession(session: AlignSession): void {
  const sessions = getAlignSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }
  localStorage.setItem(ALIGN_KEY, JSON.stringify(sessions));
}

export function deleteAlignSession(id: string): void {
  const sessions = getAlignSessions().filter((s) => s.id !== id);
  localStorage.setItem(ALIGN_KEY, JSON.stringify(sessions));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
