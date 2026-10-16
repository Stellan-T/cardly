/** Converts raw Firestore data into typed objects, filling in defaults for missing fields. */
import type { DocumentData } from 'firebase/firestore'
import { emptyStats } from '../lib/progress'
import type {
  Card,
  Folder,
  PublicSetDoc,
  SessionDoc,
  SetProgressDoc,
  StudySet,
  TestResult,
  UserDoc,
  UserSettings,
} from '../types'

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

export function toStudySet(d: DocumentData, id: string): StudySet {
  return {
    id,
    ownerUid: str(d.ownerUid),
    ownerName: str(d.ownerName),
    title: str(d.title, 'Untitled set'),
    description: str(d.description),
    termLang: str(d.termLang, 'und'),
    defLang: str(d.defLang, 'und'),
    visibility: d.visibility === 'link' ? 'link' : 'private',
    cardCount: num(d.cardCount),
    starredCount: Math.max(0, num(d.starredCount)),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
    lastStudiedAt: typeof d.lastStudiedAt === 'number' ? d.lastStudiedAt : null,
    lastActivity: d.lastActivity ?? null,
    folderIds: Array.isArray(d.folderIds) ? d.folderIds : [],
    draft: d.draft === true,
    summary: d.summary,
    srsDue: Array.isArray(d.srsDue) ? d.srsDue : undefined,
    copiedFrom: d.copiedFrom ?? null,
  }
}

export function toCard(d: DocumentData, id: string): Card {
  return {
    id,
    term: str(d.term),
    definition: str(d.definition),
    order: num(d.order),
    starred: d.starred === true,
    imageId: d.imageId ?? null,
    imageUrl: d.imageUrl ?? null,
    tags: Array.isArray(d.tags) && d.tags.length ? d.tags : undefined,
  }
}

export function toProgressDoc(d: DocumentData | undefined): SetProgressDoc {
  return {
    cards: (d?.cards as SetProgressDoc['cards']) ?? {},
    stats: { ...emptyStats(), ...d?.stats },
    updatedAt: num(d?.updatedAt),
  }
}

export function toSessionDoc(d: DocumentData | undefined): SessionDoc {
  return (d as SessionDoc) ?? {}
}

export function toFolder(d: DocumentData, id: string): Folder {
  return {
    id,
    name: str(d.name, 'Untitled folder'),
    setIds: Array.isArray(d.setIds) ? d.setIds : [],
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  }
}

export function toTestResult(d: DocumentData, id: string): TestResult {
  return {
    id,
    setId: str(d.setId),
    scorePct: num(d.scorePct),
    correct: num(d.correct),
    total: num(d.total),
    durationMs: num(d.durationMs),
    settings: d.settings ?? {},
    takenAt: num(d.takenAt),
  }
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  defaultGrading: 'auto',
  defaultFlashcardMethod: 'auto',
  newCardsPerDay: 20,
  sound: true,
  voices: {},
  reducedMotion: false,
}

export function toUserDoc(d: DocumentData | undefined): UserDoc {
  return {
    displayName: str(d?.displayName),
    email: d?.email ?? null,
    photoURL: d?.photoURL ?? null,
    createdAt: num(d?.createdAt),
    settings: { ...DEFAULT_SETTINGS, ...d?.settings },
    streak: { current: 0, longest: 0, lastStudyDate: null, ...d?.streak },
    leaderboardSetIds: Array.isArray(d?.leaderboardSetIds) ? d.leaderboardSetIds : [],
  }
}

export function toPublicSet(d: DocumentData): PublicSetDoc {
  return {
    ownerUid: str(d.ownerUid),
    ownerName: str(d.ownerName),
    title: str(d.title, 'Untitled set'),
    description: str(d.description),
    termLang: str(d.termLang, 'und'),
    defLang: str(d.defLang, 'und'),
    cardCount: num(d.cardCount),
    cards: Array.isArray(d.cards) ? d.cards : [],
    updatedAt: num(d.updatedAt),
  }
}
