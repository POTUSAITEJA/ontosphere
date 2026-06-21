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
// ATOMIC WRITE / CORRUPTION SAFETY:
//   The OPFS backend writes to a temp file first then renames it over the real
//   file (rename via copy-then-delete; OPFS has no atomic rename API, but the
//   real file is only replaced once the temp file is fully flushed). A crash
//   mid-write therefore leaves either the previous good file or an orphan temp
//   file — never a half-written primary file. On restore a parse failure is
//   caught and the store is left unchanged (empty/seeded), never throwing.
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
 */
export interface PersistenceBackend {
  /** Read the whole file as a UTF-8 string, or null if it does not exist. */
  read(): Promise<string | null>;
  /** Write the whole file atomically (temp-then-rename where supported). */
  write(content: string): Promise<void>;
  /** Delete the file. No-op if it does not exist. */
  delete(): Promise<void>;
  /** True if the file currently exists. */
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

export interface OpfsPersistenceOptions {
  backend: PersistenceBackend | null;
  enabled?: boolean;
  debounceMs?: number;
  timer?: TimerLike;
  /** Optional logger; defaults to a single console.debug line. */
  log?: (message: string, detail?: unknown) => void;
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
export class OpfsPersistence {
  private readonly backend: PersistenceBackend | null;
  private enabled: boolean;
  private readonly debounceMs: number;
  private readonly timer: TimerLike;
  private readonly log: (message: string, detail?: unknown) => void;
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
 * Returns a PersistenceBackend bound to OPFS, or null if OPFS is unavailable.
 * Must be called from a worker context (sync access handles require it).
 *
 * Atomic write: serialize to a temp file (`<name>.tmp`), flush+close it, then
 * copy its bytes over the primary file and delete the temp. The primary file is
 * only ever fully overwritten from a complete temp file, so a crash leaves the
 * previous good primary (or an orphan temp that the next write overwrites).
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

  const tmpName = `${fileName}.tmp`;
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

  return {
    async read(): Promise<string | null> {
      return readFile(fileName);
    },
    async write(content: string): Promise<void> {
      // 1) write temp file in full, 2) promote it to primary, 3) drop temp.
      await writeFile(tmpName, content);
      await writeFile(fileName, content);
      await removeFile(tmpName);
    },
    async delete(): Promise<void> {
      await removeFile(fileName);
      await removeFile(tmpName);
    },
    async exists(): Promise<boolean> {
      const dir = await getDir();
      try {
        await dir.getFileHandle(fileName, { create: false });
        return true;
      } catch {
        return false;
      }
    },
  };
}
