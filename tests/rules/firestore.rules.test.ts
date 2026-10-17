import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cardly-rules',
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'), host, port: Number(port) },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

const alice = () => env.authenticatedContext('alice').firestore()
const bob = () => env.authenticatedContext('bob').firestore()
const guest = () => env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore()
const anon = () => env.unauthenticatedContext().firestore()

const validSet = (ownerUid = 'alice', extra: Record<string, unknown> = {}) => ({
  ownerUid,
  ownerName: 'Alice',
  title: 'Biology',
  description: '',
  termLang: 'en',
  defLang: 'en',
  visibility: 'private',
  cardCount: 1,
  starredCount: 0,
  createdAt: 1,
  updatedAt: 1,
  lastStudiedAt: null,
  lastActivity: null,
  folderIds: [],
  draft: false,
  ...extra,
})

const validCard = (extra: Record<string, unknown> = {}) => ({
  term: 'Cell',
  definition: 'Unit of life',
  order: 0,
  starred: false,
  imageId: null,
  imageUrl: null,
  tags: [],
  ...extra,
})

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data)
  })
}

describe('users/{uid}/**', () => {
  it('lets a user read and write their own profile', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice'), { displayName: 'Alice', settings: {}, streak: {} }))
    await assertSucceeds(getDoc(doc(alice(), 'users/alice')))
  })

  it("blocks reading or writing another user's data", async () => {
    await seed('users/alice', { displayName: 'Alice' })
    await seed('users/alice/sets/s1', validSet())
    await seed('users/alice/progress/s1', { cards: {} })
    await assertFails(getDoc(doc(bob(), 'users/alice')))
    await assertFails(getDoc(doc(bob(), 'users/alice/sets/s1')))
    await assertFails(getDocs(collection(bob(), 'users/alice/sets')))
    await assertFails(getDoc(doc(bob(), 'users/alice/progress/s1')))
    await assertFails(setDoc(doc(bob(), 'users/alice/sets/s2'), validSet('alice')))
    await assertFails(setDoc(doc(bob(), 'users/alice/progress/s1'), { cards: {} }))
    await assertFails(deleteDoc(doc(bob(), 'users/alice/sets/s1')))
  })

  it('blocks signed-out access', async () => {
    await seed('users/alice/sets/s1', validSet())
    await assertFails(getDoc(doc(anon(), 'users/alice/sets/s1')))
    await assertFails(setDoc(doc(anon(), 'users/alice'), { displayName: 'x' }))
  })

  it('validates set documents', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/sets/s1'), validSet()))
    await assertFails(setDoc(doc(alice(), 'users/alice/sets/s2'), validSet('bob')))
    await assertFails(setDoc(doc(alice(), 'users/alice/sets/s3'), validSet('alice', { title: 'x'.repeat(256) })))
    await assertFails(setDoc(doc(alice(), 'users/alice/sets/s4'), validSet('alice', { title: '' })))
    await assertFails(setDoc(doc(alice(), 'users/alice/sets/s5'), validSet('alice', { visibility: 'public' })))
    await assertSucceeds(updateDoc(doc(alice(), 'users/alice/sets/s1'), { title: 'Biology 2', updatedAt: 2 }))
    await assertFails(updateDoc(doc(alice(), 'users/alice/sets/s1'), { cardCount: 'many' }))
  })

  it('validates card field sizes', async () => {
    const card = (extra: Record<string, unknown>) => setDoc(doc(alice(), 'users/alice/sets/s1/cards/c1'), validCard(extra))
    await assertSucceeds(card({ term: 'x'.repeat(1000), definition: 'y'.repeat(10000) }))
    await assertFails(card({ term: 'x'.repeat(1001) }))
    await assertFails(card({ definition: 'y'.repeat(10001) }))
    await assertFails(card({ starred: 'yes' }))
    await assertFails(setDoc(doc(bob(), 'users/alice/sets/s1/cards/c2'), validCard()))
  })

  it('allows the owner to use progress, sessions, folders, tests and images', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/progress/s1'), { cards: { c1: { seen: 1 } } }))
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/sessions/s1'), { learn: { round: 1 } }))
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/folders/f1'), { name: 'Bio', setIds: ['s1'], createdAt: 1, updatedAt: 1 }))
    await assertFails(setDoc(doc(alice(), 'users/alice/folders/f2'), { name: 'x'.repeat(256), setIds: [] }))
    await assertSucceeds(
      setDoc(doc(alice(), 'users/alice/tests/t1'), { setId: 's1', scorePct: 80, correct: 8, total: 10, durationMs: 1000, takenAt: 1, settings: {} }),
    )
    await assertFails(
      setDoc(doc(alice(), 'users/alice/tests/t2'), { setId: 's1', scorePct: 120, correct: 8, total: 10, durationMs: 1000, takenAt: 1 }),
    )
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/images/i1'), { dataUrl: 'data:image/webp;base64,AAAA', width: 1, height: 1, bytes: 3 }))
    await assertFails(setDoc(doc(alice(), 'users/alice/images/i2'), { dataUrl: 'https://example.com/x.png', width: 1, height: 1, bytes: 3 }))
    await assertFails(setDoc(doc(alice(), 'users/alice/images/i3'), { dataUrl: `data:image/webp;base64,${'A'.repeat(400_001)}`, bytes: 1 }))
  })

  it('keeps cached AI Insights and Hints private and validated', async () => {
    const insight = { setId: 's1', cardId: 'c1', text: 'Because…', model: 'gemini', createdAt: 1 }
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/insights/k1'), insight))
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/insights/k1')))
    await assertFails(getDoc(doc(bob(), 'users/alice/insights/k1')))
    await assertFails(setDoc(doc(bob(), 'users/alice/insights/k2'), insight))
    await assertFails(setDoc(doc(alice(), 'users/alice/insights/k3'), { ...insight, text: '' }))
    await assertFails(setDoc(doc(alice(), 'users/alice/insights/k4'), { ...insight, text: 'x'.repeat(5001) }))
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/insights/k5'), { ...insight, kind: 'hint' }))
    await assertFails(setDoc(doc(alice(), 'users/alice/insights/k6'), { ...insight, kind: 'essay' }))
  })
})

const publicSet = (ownerUid = 'alice', extra: Record<string, unknown> = {}) => ({
  ownerUid,
  ownerName: 'Alice',
  title: 'Biology',
  description: '',
  termLang: 'en',
  defLang: 'en',
  cardCount: 1,
  cards: [{ id: 'c1', term: 'Cell', definition: 'Unit', order: 0 }],
  updatedAt: 1,
  ...extra,
})

describe('publicSets/{setId}', () => {
  beforeEach(async () => {
    await seed('users/alice/sets/s1', validSet('alice', { visibility: 'link' }))
  })

  it('lets the owner of the source set publish, update and delete it', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'publicSets/s1'), publicSet()))
    await assertSucceeds(updateDoc(doc(alice(), 'publicSets/s1'), { title: 'Biology!' }))
    await assertSucceeds(deleteDoc(doc(alice(), 'publicSets/s1')))
  })

  it('can be read by any signed-in user, including guests, but not signed-out visitors', async () => {
    await seed('publicSets/s1', publicSet())
    await assertSucceeds(getDoc(doc(bob(), 'publicSets/s1')))
    await assertSucceeds(getDoc(doc(guest(), 'publicSets/s1')))
    await assertFails(getDoc(doc(anon(), 'publicSets/s1')))
  })

  it('cannot be created, changed or deleted by someone else', async () => {
    await assertFails(setDoc(doc(bob(), 'publicSets/s1'), publicSet('alice')))
    await assertFails(setDoc(doc(bob(), 'publicSets/s1'), publicSet('bob')))
    await seed('publicSets/s1', publicSet())
    await assertFails(updateDoc(doc(bob(), 'publicSets/s1'), { title: 'hacked' }))
    await assertFails(setDoc(doc(bob(), 'publicSets/s1'), publicSet('bob')))
    await assertFails(deleteDoc(doc(bob(), 'publicSets/s1')))
  })

  it('cannot be published for a set id the user does not own', async () => {
    await assertFails(setDoc(doc(alice(), 'publicSets/unknown'), publicSet()))
  })

  it("protects a shared set's images", async () => {
    await seed('publicSets/s1', publicSet())
    const img = { dataUrl: 'data:image/webp;base64,AAAA', width: 1, height: 1, bytes: 3 }
    await assertSucceeds(setDoc(doc(alice(), 'publicSets/s1/images/i1'), img))
    await assertSucceeds(getDoc(doc(bob(), 'publicSets/s1/images/i1')))
    await assertFails(setDoc(doc(bob(), 'publicSets/s1/images/i2'), img))
  })
})

describe('leaderboards/{setId}/match/{uid}', () => {
  const entry = (bestTimeMs: unknown) => ({ displayName: 'Bob', bestTimeMs, achievedAt: 1 })

  it('anyone signed in can read', async () => {
    await seed('leaderboards/s1/match/alice', entry(12_300))
    await assertSucceeds(getDocs(collection(bob(), 'leaderboards/s1/match')))
    await assertFails(getDocs(collection(anon(), 'leaderboards/s1/match')))
  })

  it('a user can only write their own entry with a positive time', async () => {
    await assertSucceeds(setDoc(doc(bob(), 'leaderboards/s1/match/bob'), entry(9_800)))
    await assertFails(setDoc(doc(bob(), 'leaderboards/s1/match/alice'), entry(9_800)))
    await assertFails(setDoc(doc(bob(), 'leaderboards/s1/match/bob'), entry(0)))
    await assertFails(setDoc(doc(bob(), 'leaderboards/s1/match/bob'), entry(-5)))
    await assertFails(setDoc(doc(bob(), 'leaderboards/s1/match/bob'), entry('fast')))
  })
})

describe('everything else', () => {
  it('is denied by default', async () => {
    await assertFails(setDoc(doc(alice(), 'random/doc'), { a: 1 }))
    await assertFails(getDoc(doc(alice(), 'random/doc')))
    await assertFails(setDoc(doc(alice(), 'users/alice/unknown/x'), { a: 1 }))
  })
})
