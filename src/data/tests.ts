import { addDoc, limit, orderBy, query, where } from 'firebase/firestore'
import type { TestResult } from '../types'
import { useLiveQuery } from './hooks'
import { toTestResult } from './mappers'
import { testsCol } from './paths'
import { track } from './sync'

export function saveTestResult(uid: string, result: Omit<TestResult, 'id'>) {
  void track(addDoc(testsCol(uid), result), 'save test result')
}

export function useTestHistory(uid: string | null, setId: string | null, max = 10) {
  const q = uid && setId ? query(testsCol(uid), where('setId', '==', setId), orderBy('takenAt', 'desc'), limit(max)) : null
  return useLiveQuery(q, uid && setId ? `tests/${uid}/${setId}/${max}` : null, toTestResult)
}
