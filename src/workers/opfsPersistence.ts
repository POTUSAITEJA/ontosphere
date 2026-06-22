// ---------------------------------------------------------------------------
// opfsPersistence.ts — client-side, zero-backend crash recovery for the
// in-worker N3 store via the Origin Private File System (OPFS).
//
// DESIGN (zero-backend, fully client-side):
//   - The DURABLE graphs (urn:vg:data, urn:vg:ontologies, urn:vg:shapes,
//     urn:vg:workflows) are serialized to N-Quads and written to a single OPFS
//     file (`ontosphere-store.nq`) so named graphs are preserved.
//   - urn:vg:inferred is NOT persisted: it is fully recomputable by re-running
//     reasoning, so persisting it would only waste space and risk staleness.
//   - urn:vg:provenance is NOT persisted: it is session-scoped audit metadata
//     that should not survive a reload (a restored session is a fresh session).
//
// TESTABILITY:
//   The LOGIC (serialize selected graphs → bytes; parse bytes → quads) is fully
//   separated from the OPFS I/O. The I/O is hidden behind the
//   PersistenceBackend interface, so unit tests inject an in-memory fake backend
//   and never touch OPFS (which does not exist in jsdom/Node). The real OPFS
//   backend is produced by createOpfsBackend(), which feature-detects and
//   returns null when OPFS is unavailable — so everything no-ops gracefully.
//
// ATOMIC WRITE / CORRUPTION SAFETY (double-buffer + pointer):
//   OPFS has NO cheap atomic rename across sync access handles, so a single
//   primary file written in place (truncate(0) → write → flush) has a fatal
//   window: a crash after truncate but before flush leaves a HALF-WRITTEN
//   primary, and since it is the only copy, all persisted data is lost.
//
//   Instead the backend double-buffers across two slots (`<name>.a` /
//   `<name>.b`) plus a tiny pointer file (`<name>.ptr`) that names the
//   last-good slot. A write NEVER touches the currently-active slot: it writes
//   the full new content to the INACTIVE slot, flushes it, and only THEN
//   rewrites the pointer to name that slot. Ordering guarantees crash-safety:
//     - crash while writing the inactive slot → pointer still names the old
//       good slot → restore() recovers the PREVIOUS snapshot (no data loss);
//     - crash while/after rewriting the pointer → restore() reads the pointer;
//       if it is missing/garbled it falls back to trying BOTH slots and uses
//       whichever parses, so it still recovers a complete snapshot.
//   On restore a parse failure of the pointed-to slot falls back to the other
//   slot; only if BOTH are unparseable does restore start clean — and that can
//   only happen with no prior good write, never from a single crash.
//
// LIMITATIONS (be honest):
//   - Single-tab assumption: there is NO multi-tab locking. Two tabs writing the
//     same OPFS file concurrently can clobber each other. OPFS sync access
//     handles are exclusive per file, so the second tab's handle acquisition
//     will throw and that write simply no-ops (persistence disables for the
//     session) — data in memory is never lost, but only one tab persists.
//   - OPFS browser support: Chromium-based browsers and recent Firefox/Safari.
//     Where unavailable, persistence silently no-ops and the app works normally
//     without crash recovery.
// ---------------------------------------------------------------------------

import * as N3 from "n3";
import type { Quad } from "@rdfjs/types";

// ---------------------------------------------------------------------------
// Web Locks API minimal types (not in lib.dom for all TS versions; defined
// locally so we don't add a tsconfig lib dependency just for one narrow API).
// ---------------------------------------------------------------------------
interface Lock { readonly name: string; readonly mode: string; }
interface LockRequestOptions { mode?: "exclusive" | "shared"; ifAvailable?: boolean; steal?: boolean; }
interface LockManager {
  request<T>(name: string, options: LockRequestOptions, callback: (lock: Lock | null) => Promise<T>): Promise<T>;
  request<T>(name: string, callback: (lock: Lock | null) => Promise<T>): Promise<T>;
}

/**
 * Feature-detect and return the Web Locks API, or null when unavailable.
 * Checks both `navigator.locks` (main thread / dedicated worker) and
 * `globalThis.navigator?.locks` (worker) to cover all contexts.
 */
function resolveLocks(): LockManager | null {
  try {
    const nav: unknown =
      typeof navigator !== "undefined"
        ? navigator
        : typeof globalThis !== "undefined" && "navigator" in globalThis
          ? (globalThis as { navigator?: unknown }).navigator
          : undefined;
    const locks = (nav as { locks?: unknown } | undefined)?.locks;
    if (locks && typeof (locks as LockManager).request === "function") {
      return locks as LockManager;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** The four durable named graphs persisted to OPFS, in deterministic order. */
export const PERSISTED_GRAPHS = [
  "urn:vg:data",
  "urn:vg:ontologies",
  "urn:vg:shapes",
  "urn:vg:workflows",
] as const;

/** Graphs that are intentionally NOT persisted (recomputable / session-scoped). */
export const EXCLUDED_GRAPHS = ["urn:vg:inferred", "urn:vg:provenance"] as const;

/** Default OPFS file name for the serialized store snapshot. */
export const SNAPSHOT_FILE = "ontosphere-store.nq";

/**
 * Minimal structural view of the N3 store the persistence layer needs. Kept
 * narrow so tests can pass a real N3.Store or a tiny fake.
 */
export interface PersistableStore {
  getQuads(
    subject: unknown,
    predicate: unknown,
    object: unknown,
    graph: unknown,
  ): Quad[];
  addQuad(quad: Quad): unknown;
}

/**
 * Storage backend abstraction. The real implementation talks to OPFS; tests
 * inject an in-memory fake. All methods are async and MUST NOT throw for the
 * "not found" case (read/exists return null/false instead).
 *
 * CRASH-SAFETY CONTRACT: `write()` MUST be crash-safe — after any crash during
 * a write, a subsequent `read()` MUST return either the new content (if the
 * write reached the durable commit point) or the PREVIOUS good content, and
 * MUST NEVER return a half-written / corrupt snapshot. The OPFS backend honours
 * this via a double-buffer (A/B slot) + pointer scheme (see createOpfsBackend).
 * `read()` performs the recovery: it consults the pointer and falls back across
 * slots so a torn write is never observable as data loss.
 */
export interface PersistenceBackend {
  /**
   * Read the last-good snapshot as a UTF-8 string, or null if none exists.
   * Performs crash recovery: resolves the active slot from the pointer and
   * falls back to the other slot if the pointed-to one is missing/unparseable.
   */
  read(): Promise<string | null>;
  /**
   * Durably commit the whole snapshot. Crash-safe: writes the inactive slot in
   * full, flushes it, then flips the pointer LAST. A crash before the pointer
   * flip preserves the previous good snapshot; a crash after it commits the new
   * one. Never leaves the active snapshot half-written.
   */
  write(content: string): Promise<void>;
  /** Delete the snapshot (all slots + pointer). No-op if absent. */
  delete(): Promise<void>;
  /** True if a snapshot currently exists. */
  exists(): Promise<boolean>;
}

/** Injectable timer so the debounce is deterministic in tests. */
export interface TimerLike {
  set(cb: () => void, ms: number): void;
  clear(): void;
}

/** Default timer backed by setTimeout/clearTimeout. */
export function createDefaultTimer(): TimerLike {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    set(cb, ms) {
      if (handle !== null) clearTimeout(handle);
      handle = setTimeout(() => {
        handle = null;
        cb();
      }, ms);
    },
    clear() {
      if (handle !== null) {
        clearTimeout(handle);
        handle = null;
      }
    },
  };
}

const _df = N3.DataFactory;

/**
 * PURE: serialize exactly the persisted graphs of a store to N-Quads. Returns an
 * empty string when there is nothing to persist. Excludes inferred/provenance by
 * construction (it only ever reads PERSISTED_GRAPHS).
 *
 * Reuses N3.Writer with the `application/n-quads` format — the SAME serializer
 * the worker's exportGraph dataset path uses — so output round-trips faithfully
 * and named-graph terms are preserved per quad.
 */
export async function serializePersistedGraphs(store: PersistableStore): Promise<string> {
  const quads: Quad[] = [];
  for (const g of PERSISTED_GRAPHS) {
    const gTerm = _df.namedNode(g);
    const graphQuads = store.getQuads(null, null, null, gTerm) || [];
    for (const q of graphQuads) quads.push(q);
  }
  if (quads.length === 0) return "";
  const writer = new (N3 as unknown as { Writer: new (opts: unknown) => {
    addQuads: (q: Quad[]) => void;
    end: (cb: (err: unknown, res: unknown) => void) => void;
  } }).Writer({ format: "application/n-quads" });
  writer.addQuads(quads);
  return new Promise<string>((resolve, reject) => {
    writer.end((err, res) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve(typeof res === "string" ? res : String(res ?? ""));
    });
  });
}

/**
 * PURE: parse an N-Quads string into quads. Throws on malformed input — callers
 * catch and treat a parse failure as "no usable snapshot" (corruption-safe).
 */
export function parseNQuads(content: string): Quad[] {
  const parser = new (N3 as unknown as { Parser: new (opts: unknown) => {
    parse: (input: string) => Quad[];
  } }).Parser({ format: "application/n-quads" });
  return parser.parse(content) as Quad[];
}

/**
 * PURE: load parsed quads into the store, keeping each quad's named-graph term.
 * Quads whose graph is NOT one of the persisted graphs are skipped defensively
 * (so a tampered file cannot inject e.g. urn:vg:inferred content). Returns the
 * number of quads actually loaded. The store's own dedup means re-loading over a
 * seeded store (urn:vg:ontologies seeds) will not double-count.
 */
export function loadQuadsIntoStore(store: PersistableStore, quads: Quad[]): number {
  const allowed = new Set<string>(PERSISTED_GRAPHS);
  let loaded = 0;
  for (const q of quads) {
    const g = q.graph && q.graph.termType !== "DefaultGraph" ? q.graph.value : "";
    if (!allowed.has(g)) continue;
    store.addQuad(q);
    loaded += 1;
  }
  return loaded;
}

/**
 * Signal emitted (via `onLockConflict`) when the Web Locks API is available but
 * the persistence lock is already held by another tab. The UI can use this to
 * show a non-blocking warning instead of silently no-oping on the write.
 */
export interface LockConflictSignal {
  lockName: string;
  /** ISO-8601 timestamp of the conflict detection. */
  at: string;
}

export interface OpfsPersistenceOptions {
  backend: PersistenceBackend | null;
  enabled?: boolean;
  debounceMs?: number;
  timer?: TimerLike;
  /** Optional logger; defaults to a single console.debug line. */
  log?: (message: string, detail?: unknown) => void;
  /**
   * Name of the Web Locks API lock to acquire around each write. Defaults to
   * `"opfs-persistence-write"`. Concurrent writers (e.g. two browser tabs) will
   * serialize rather than clobber. Set to `null` to disable locking even when
   * `navigator.locks` is available (useful in tests that don't mock it).
   */
  lockName?: string | null;
  /**
   * Callback invoked (at most once per write attempt) when the lock is held by
   * another tab and the write is deferred/blocked. Consumers can show a warning
   * instead of discovering the single-tab limitation silently.
   */
  onLockConflict?: (signal: LockConflictSignal) => void;
}

const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * OpfsPersistence — orchestrates debounced snapshots and crash-recovery restore.
 *
 * - When `backend` is null (OPFS unavailable) OR `enabled` is false, every
 *   operation no-ops without throwing.
 * - scheduleSnapshot() debounces; flush() forces a pending snapshot immediately
 *   (used by tests and by an explicit "persist now").
 * - A write error (e.g. QuotaExceededError, exclusive-handle conflict) disables
 *   persistence for the session and logs a single warning — the in-memory graph
 *   is never affected.
 */
/** Default lock name for serialising concurrent tab writes. */
export const DEFAULT_LOCK_NAME = "opfs-persistence-write";

export class OpfsPersistence {
  private readonly backend: PersistenceBackend | null;
  private enabled: boolean;
  private readonly debounceMs: number;
  private readonly timer: TimerLike;
  private readonly log: (message: string, detail?: unknown) => void;
  private readonly lockName: string | null;
  private readonly onLockConflict: ((signal: LockConflictSignal) => void) | null;
  private pendingStore: PersistableStore | null = null;
  private writing = false;
  private rewriteQueued = false;

  constructor(options: OpfsPersistenceOptions) {
    this.backend = options.backend ?? null;
    this.enabled = options.enabled ?? true;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.timer = options.timer ?? createDefaultTimer();
    this.log =
      options.log ??
      ((message, detail) => {
        try {
          if (typeof detail === "undefined") console.debug(`[opfsPersistence] ${message}`);
          else console.debug(`[opfsPersistence] ${message}`, detail);
        } catch {
          /* ignore logging failures */
        }
      });
    // `null` explicitly disables locking; `undefined` → use the default name.
    this.lockName = options.lockName === null ? null : (options.lockName ?? DEFAULT_LOCK_NAME);
    this.onLockConflict = options.onLockConflict ?? null;
  }

  /** True only when OPFS is available AND the user preference is enabled. */
  isActive(): boolean {
    return this.enabled && this.backend !== null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.timer.clear();
  }

  /**
   * Debounced snapshot. Captures the store reference; the actual serialize+write
   * happens after `debounceMs` of quiescence. Cheap to call on every mutation.
   */
  scheduleSnapshot(store: PersistableStore): void {
    if (!this.isActive()) return;
    this.pendingStore = store;
    this.timer.set(() => {
      void this.flush();
    }, this.debounceMs);
  }

  /**
   * Force any pending snapshot to run now. Resolves once the write completes (or
   * is skipped). Never throws — write errors disable persistence for the session.
   */
  async flush(): Promise<void> {
    this.timer.clear();
    const store = this.pendingStore;
    this.pendingStore = null;
    if (!this.isActive() || !store) return;
    await this.writeSnapshot(store);
  }

  private async writeSnapshot(store: PersistableStore): Promise<void> {
    if (!this.backend) return;
    // Coalesce concurrent writes: if a write is in flight, queue exactly one
    // follow-up so we always end with the latest state without overlapping I/O.
    if (this.writing) {
      this.pendingStore = store;
      this.rewriteQueued = true;
      return;
    }

    // Web Locks API guard: acquire an exclusive lock so concurrent tabs
    // serialize their writes rather than clobbering each other. We feature-
    // detect here (not at construction) so a late polyfill or test injection
    // of navigator.locks is picked up correctly.
    //
    // If the lock is already held by another tab, `navigator.locks.request`
    // will queue us; the callback won't run until the lock is released. We
    // emit the onLockConflict signal BEFORE awaiting the lock so the caller
    // can warn the user that a write is pending (non-blocking) rather than
    // discovering the serialisation silently.
    //
    // Graceful degradation: when navigator.locks is absent (non-Chromium,
    // non-worker, jsdom) we skip locking entirely and proceed with current
    // single-tab behavior (no change from pre-feature code).
    const locksApi = resolveLocks();
    if (locksApi && this.lockName) {
      let conflictSignaled = false;
      const doWrite = async (): Promise<void> => {
        await this.writeSnapshotUnlocked(store);
      };
      // The `ifAvailable` option makes the request non-blocking: the callback
      // receives `null` immediately when the lock is already held, letting us
      // surface the conflict to the caller without stalling.
      await locksApi.request(
        this.lockName,
        { mode: "exclusive", ifAvailable: true } as LockRequestOptions,
        async (lock: Lock | null) => {
          if (lock === null) {
            // Lock is held by another tab; signal and queue a retry via the
            // normal rewrite path (the caller will retry on the next flush/timer).
            if (!conflictSignaled) {
              conflictSignaled = true;
              if (this.onLockConflict) {
                try {
                  this.onLockConflict({ lockName: this.lockName!, at: new Date().toISOString() });
                } catch {
                  /* ignore callback errors */
                }
              }
              this.log("OPFS write deferred — lock held by another tab (will retry)");
              // Re-queue the store so the next debounce fires a retry.
              this.pendingStore = store;
              this.rewriteQueued = true;
            }
            return;
          }
          await doWrite();
        },
      );
      return;
    }

    // Locks unavailable or disabled: original behavior.
    await this.writeSnapshotUnlocked(store);
  }

  /** Inner write logic, called either directly (no locks) or inside a lock callback. */
  private async writeSnapshotUnlocked(store: PersistableStore): Promise<void> {
    if (!this.backend) return;
    this.writing = true;
    try {
      const content = await serializePersistedGraphs(store);
      await this.backend.write(content);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      this.enabled = false;
      this.timer.clear();
      this.log(
        name === "QuotaExceededError"
          ? "OPFS quota exceeded — persistence disabled for this session"
          : "OPFS write failed — persistence disabled for this session",
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.writing = false;
      if (this.rewriteQueued && this.isActive()) {
        this.rewriteQueued = false;
        const next = this.pendingStore;
        this.pendingStore = null;
        if (next) await this.writeSnapshot(next);
      } else {
        this.rewriteQueued = false;
      }
    }
  }

  /**
   * Crash-recovery restore: read the snapshot file, parse it, and load the quads
   * into the store keeping their named graphs. Returns the number of quads
   * loaded (0 when disabled, unavailable, missing, empty, or corrupt). NEVER
   * throws: a parse/read failure logs once and leaves the store unchanged.
   */
  async restore(store: PersistableStore): Promise<number> {
    if (!this.isActive() || !this.backend) return 0;
    let content: string | null;
    try {
      content = await this.backend.read();
    } catch (err) {
      this.log("OPFS read failed — starting without restore", err instanceof Error ? err.message : err);
      return 0;
    }
    if (!content) return 0;
    let quads: Quad[];
    try {
      quads = parseNQuads(content);
    } catch (err) {
      // Corrupt / partial file: leave the store unchanged, do not throw.
      this.log("snapshot parse failed (corrupt file) — starting clean", err instanceof Error ? err.message : err);
      return 0;
    }
    try {
      return loadQuadsIntoStore(store, quads);
    } catch (err) {
      this.log("loading restored quads failed — leaving store as-is", err instanceof Error ? err.message : err);
      return 0;
    }
  }

  /** Delete the persisted snapshot file. No-op when unavailable. Never throws. */
  async clear(): Promise<void> {
    this.timer.clear();
    this.pendingStore = null;
    if (!this.backend) return;
    try {
      await this.backend.delete();
    } catch (err) {
      this.log("OPFS delete failed", err instanceof Error ? err.message : err);
    }
  }
}

// ---------------------------------------------------------------------------
// Real OPFS backend. Feature-detects navigator.storage.getDirectory and the
// sync-access-handle API (available in worker contexts). Returns null when OPFS
// is unavailable so the rest of the code no-ops gracefully (jsdom/Node included).
// ---------------------------------------------------------------------------

type FileSystemSyncAccessHandle = {
  read: (buffer: ArrayBufferView, options?: { at?: number }) => number;
  write: (buffer: ArrayBufferView, options?: { at?: number }) => number;
  truncate: (size: number) => void;
  getSize: () => number;
  flush: () => void;
  close: () => void;
};

type OpfsFileHandle = {
  createSyncAccessHandle: () => Promise<FileSystemSyncAccessHandle>;
};

type OpfsDirHandle = {
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<OpfsFileHandle>;
  removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
};

/**
 * A slot's payload is framed as `<content>\n<COMMIT_MARKER> <byteLenOfContent>`.
 * The marker line is written as part of the SAME flushed buffer as the content,
 * so a slot is only "valid" when both the content and its trailing marker are
 * fully present and the byte length matches. A torn / truncated slot fails this
 * check and is rejected by the reader (which then falls back to the other slot).
 */
const COMMIT_MARKER = "#__OPFS_COMMIT__";

/** Frame content + trailing commit marker. */
export function frameSlot(content: string): string {
  const byteLen = new TextEncoder().encode(content).length;
  return `${content}\n${COMMIT_MARKER} ${byteLen}\n`;
}

/**
 * Validate + unframe a slot payload. Returns the original content if the trailer
 * marker is present and its declared byte length matches the actual content
 * bytes; otherwise null (torn / corrupt / not-our-format slot).
 */
export function unframeSlot(framed: string | null): string | null {
  if (framed == null) return null;
  // The marker line is the LAST non-empty line. Find the last marker occurrence.
  const idx = framed.lastIndexOf(`\n${COMMIT_MARKER} `);
  if (idx < 0) return null;
  const content = framed.slice(0, idx);
  const rest = framed.slice(idx + 1); // drop the leading '\n'
  const m = /^#__OPFS_COMMIT__ (\d+)\s*$/.exec(rest.replace(/\n+$/, ""));
  if (!m) return null;
  const declared = Number(m[1]);
  const actual = new TextEncoder().encode(content).length;
  if (declared !== actual) return null;
  return content;
}

/**
 * Returns a PersistenceBackend bound to OPFS, or null if OPFS is unavailable.
 * Must be called from a worker context (sync access handles require it).
 *
 * Crash-safe write (double-buffer + pointer): content lives in two slot files
 * (`<name>.a` / `<name>.b`); a pointer file (`<name>.ptr`) names the last-good
 * slot. A write targets the INACTIVE slot only: frame+flush it, then rewrite the
 * pointer LAST. A crash before the pointer flip leaves the previous good slot
 * still pointed-to (no data loss); a crash after it commits the new slot. read()
 * resolves the pointer, validates the slot's commit marker, and falls back to
 * the other slot if the pointed-to one is missing/torn — so a half-written slot
 * is never observable as data loss.
 */
export function createOpfsBackend(fileName: string = SNAPSHOT_FILE): PersistenceBackend | null {
  const nav: unknown =
    typeof navigator !== "undefined"
      ? navigator
      : typeof globalThis !== "undefined" && "navigator" in globalThis
        ? (globalThis as { navigator?: unknown }).navigator
        : undefined;
  const storage = (nav as { storage?: { getDirectory?: () => Promise<unknown> } } | undefined)?.storage;
  if (!storage || typeof storage.getDirectory !== "function") {
    return null;
  }

  const slotA = `${fileName}.a`;
  const slotB = `${fileName}.b`;
  const ptrName = `${fileName}.ptr`;
  // Legacy single-file name + old temp name, cleaned up on delete for hygiene.
  const legacyName = fileName;
  const legacyTmp = `${fileName}.tmp`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function getDir(): Promise<OpfsDirHandle> {
    return (await storage!.getDirectory!()) as unknown as OpfsDirHandle;
  }

  async function writeFile(name: string, content: string): Promise<void> {
    const dir = await getDir();
    const fileHandle = await dir.getFileHandle(name, { create: true });
    if (typeof fileHandle.createSyncAccessHandle !== "function") {
      throw new Error("createSyncAccessHandle unavailable");
    }
    const handle = await fileHandle.createSyncAccessHandle();
    try {
      const bytes = encoder.encode(content);
      handle.truncate(0);
      handle.write(bytes, { at: 0 });
      handle.flush();
    } finally {
      handle.close();
    }
  }

  async function readFile(name: string): Promise<string | null> {
    const dir = await getDir();
    let fileHandle: OpfsFileHandle;
    try {
      fileHandle = await dir.getFileHandle(name, { create: false });
    } catch {
      return null; // NotFoundError → file does not exist
    }
    if (typeof fileHandle.createSyncAccessHandle !== "function") return null;
    const handle = await fileHandle.createSyncAccessHandle();
    try {
      const size = handle.getSize();
      if (size === 0) return "";
      const buf = new Uint8Array(size);
      handle.read(buf, { at: 0 });
      return decoder.decode(buf);
    } finally {
      handle.close();
    }
  }

  async function removeFile(name: string): Promise<void> {
    const dir = await getDir();
    try {
      await dir.removeEntry(name);
    } catch {
      /* NotFoundError → already gone */
    }
  }

  /** Read+validate a slot, returning its unframed content or null if torn. */
  async function readSlot(name: string): Promise<string | null> {
    return unframeSlot(await readFile(name));
  }

  /** Read the pointer ("a" | "b"), or null if missing/garbled. */
  async function readPointer(): Promise<"a" | "b" | null> {
    const raw = (await readFile(ptrName))?.trim();
    if (raw === "a" || raw === "b") return raw;
    return null;
  }

  return {
    async read(): Promise<string | null> {
      const ptr = await readPointer();
      // Preferred order: pointed-to slot first, then the other (fallback).
      const order: string[] =
        ptr === "a" ? [slotA, slotB] : ptr === "b" ? [slotB, slotA] : [slotA, slotB];
      for (const name of order) {
        const content = await readSlot(name);
        if (content !== null) return content;
      }
      // Last resort: a legacy single-file snapshot written by an older build.
      const legacy = await readFile(legacyName);
      if (legacy != null && legacy !== "") return legacy;
      return null;
    },
    async write(content: string): Promise<void> {
      // Target the INACTIVE slot (opposite of the pointer); default to A first.
      const ptr = await readPointer();
      const target = ptr === "a" ? "b" : "a";
      const targetSlot = target === "a" ? slotA : slotB;
      // 1) write+flush the full framed content to the inactive slot;
      await writeFile(targetSlot, frameSlot(content));
      // 2) flip the pointer LAST — this is the durable commit point.
      await writeFile(ptrName, target);
    },
    async delete(): Promise<void> {
      await removeFile(slotA);
      await removeFile(slotB);
      await removeFile(ptrName);
      await removeFile(legacyName);
      await removeFile(legacyTmp);
    },
    async exists(): Promise<boolean> {
      const dir = await getDir();
      for (const name of [ptrName, slotA, slotB, legacyName]) {
        try {
          await dir.getFileHandle(name, { create: false });
          return true;
        } catch {
          /* try next */
        }
      }
      return false;
    },
  };
}
