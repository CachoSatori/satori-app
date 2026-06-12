// Mini-wrapper de IndexedDB (sin dependencias: un solo DB, stores simples).
// Se evaluó la lib `idb` — para 3 stores con get/put/delete/getAll no justifica
// sumar una dependencia (menos superficie de supply-chain, mismo resultado).

const DB_NAME = 'satori-offline'
const DB_VERSION = 1
export const STORES = { cache: 'cache', outbox: 'outbox', audit: 'audit' } as const

let dbPromise: Promise<IDBDatabase> | null = null

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORES.cache)) db.createObjectStore(STORES.cache)
      if (!db.objectStoreNames.contains(STORES.outbox)) {
        const s = db.createObjectStore(STORES.outbox, { keyPath: 'seq', autoIncrement: true })
        s.createIndex('client_op_id', 'client_op_id', { unique: true })
      }
      if (!db.objectStoreNames.contains(STORES.audit)) db.createObjectStore(STORES.audit, { autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const r = fn(t.objectStore(store))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
}

export const idbGet    = <T>(store: string, key: IDBValidKey) => tx<T | undefined>(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>)
export const idbPut    = (store: string, value: unknown, key?: IDBValidKey) => tx(store, 'readwrite', s => key !== undefined ? s.put(value, key) : s.put(value))
export const idbDelete = (store: string, key: IDBValidKey) => tx(store, 'readwrite', s => s.delete(key))
export const idbGetAll = <T>(store: string) => tx<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>)
export const idbCount  = (store: string) => tx<number>(store, 'readonly', s => s.count())
