// ─────────────────────────────────────────────────────────────────────────────
// Data-access façade. Every participant-flow file imports Firestore/Functions
// primitives (and the db/functions handles) from HERE instead of directly from
// 'firebase/firestore' / 'firebase/functions' / '../firebase'. In normal use it
// re-exports the real SDK unchanged; in test mode (?preview=1&key=…) it swaps in
// the in-memory preview store so the whole flow reads/writes nothing real.
//
// The choice is made ONCE, at module load, from the initial URL — see preview.js.
// ─────────────────────────────────────────────────────────────────────────────
import { isPreview } from './preview'
import * as realFs from 'firebase/firestore'
import * as realFn from 'firebase/functions'
import { db as realDb, functions as realFunctions } from '../firebase'
import * as pv from './previewDb'

const P = isPreview()

export const db = P ? pv.PREVIEW_DB : realDb
export const functions = P ? pv.PREVIEW_FUNCTIONS : realFunctions

export const collection = P ? pv.collection : realFs.collection
export const doc = P ? pv.doc : realFs.doc
export const query = P ? pv.query : realFs.query
export const where = P ? pv.where : realFs.where
export const orderBy = P ? pv.orderBy : realFs.orderBy
export const onSnapshot = P ? pv.onSnapshot : realFs.onSnapshot
export const getDoc = P ? pv.getDoc : realFs.getDoc
export const getDocs = P ? pv.getDocs : realFs.getDocs
export const addDoc = P ? pv.addDoc : realFs.addDoc
export const setDoc = P ? pv.setDoc : realFs.setDoc
export const updateDoc = P ? pv.updateDoc : realFs.updateDoc
export const deleteDoc = P ? pv.deleteDoc : realFs.deleteDoc
export const writeBatch = P ? pv.writeBatch : realFs.writeBatch
export const serverTimestamp = P ? pv.serverTimestamp : realFs.serverTimestamp

export const getFunctions = P ? pv.getFunctions : realFn.getFunctions
export const httpsCallable = P ? pv.httpsCallable : realFn.httpsCallable
