import { arrayUnion, setDoc, updateDoc } from 'firebase/firestore'
import { daysBetween, localDateKey } from '../lib/format'
import type { StreakInfo, UserSettings } from '../types'
import { DEFAULT_SETTINGS } from './mappers'
import { userRef } from './paths'
import { track } from './sync'

/** Creates the profile doc on first sign-in (never overwrites settings). */
export function createUserDoc(uid: string, profile: { displayName: string; email: string | null; photoURL: string | null }) {
  return track(
    setDoc(userRef(uid), {
      ...profile,
      displayName: profile.displayName.slice(0, 100),
      createdAt: Date.now(),
      settings: DEFAULT_SETTINGS,
      streak: { current: 0, longest: 0, lastStudyDate: null },
    }),
    'create profile',
  )
}

export function updateProfileFields(uid: string, fields: { displayName?: string; email?: string | null; photoURL?: string | null }) {
  const data = { ...fields, ...(fields.displayName !== undefined ? { displayName: fields.displayName.slice(0, 100) } : {}) }
  void track(setDoc(userRef(uid), data, { merge: true }), 'update profile')
}

export function updateSettings(uid: string, patch: Partial<UserSettings>) {
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) data[`settings.${k}`] = v
  void track(updateDoc(userRef(uid), data), 'save settings')
}

/** Next streak value after studying today. */
export function nextStreak(streak: StreakInfo, today: string): StreakInfo {
  if (streak.lastStudyDate === today) return streak
  const gap = streak.lastStudyDate ? daysBetween(streak.lastStudyDate, today) : Infinity
  const current = gap === 1 ? streak.current + 1 : 1
  return { current, longest: Math.max(streak.longest, current), lastStudyDate: today }
}

/** The streak as displayed: it lapses if the last study day is before yesterday. */
export function displayStreak(streak: StreakInfo, today = localDateKey()): number {
  if (!streak.lastStudyDate) return 0
  return daysBetween(streak.lastStudyDate, today) <= 1 ? streak.current : 0
}

/** Records a study action today (at most one write per day). */
export function recordStudyDay(uid: string, streak: StreakInfo) {
  const today = localDateKey()
  if (streak.lastStudyDate === today) return
  void track(updateDoc(userRef(uid), { streak: nextStreak(streak, today) }), 'save streak')
}

export function rememberLeaderboard(uid: string, setId: string) {
  void track(updateDoc(userRef(uid), { leaderboardSetIds: arrayUnion(setId) }), 'save leaderboard ref')
}
