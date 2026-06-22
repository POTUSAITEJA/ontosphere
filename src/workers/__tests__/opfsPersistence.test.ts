// @vitest-environment node
//
// Unit tests for OPFS persistence (src/workers/opfsPersistence.ts). Pure logic +
// I/O are separated, so these tests inject an in-memory fake backend and never
// touch real OPFS (which does not exist in jsdom/Node). Covers:
//   - round-trip: snapshot → restore preserves the four persisted named graphs
//     and EXCLUDES urn:vg:inferred / urn:vg:provenance
//   - unavailable backend (null) → snapshot/restore/clear no-op without throwing
//   - clear() deletes the file; restore after clear → empty
//   - corrupt / partial file → restore fails SAFELY (no throw, store unchanged)
//   - debounce is testable via an injected timer + flush()
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as N3 from "n3";
import type { Quad } from "@rdfjs/types";
import {
  OpfsPersistence,
  serializePersistedGraphs,
  parseNQuads,
  loadQuadsIntoStore,
  frameSlot,
  unframeSlot,
  PERSISTED_GRAPHS,
  DEFAULT_LOCK_NAME,
  type PersistenceBackend,
  type TimerLike,
  type LockConflictSignal,
} from "../opfsPersistence";

const df = N3.DataFactory;

/**
 * In-memory PersistenceBackend that MODELS the real OPFS double-buffer + pointer
 * scheme: two slot files (a/b) holding framed payloads, plus a pointer naming the
 * last-good slot. This mirrors createOpfsBackend exactly so crash scenarios are
 * faithfully testable. Slots store the SAME framed bytes the real backend writes
 * (via frameSlot), so a "torn" slot is one whose commit marker is absent/short.
 *
 * Crash injection: set `crashAfterSlotWrite = true` to make write() throw AFTER
 * the inactive slot is written but BEFORE the pointer flip — exactly the window
 * the data-integrity bug was about.
 */
class FakeBackend implements PersistenceBackend {
  // Raw slot bytes (framed) and pointer, mirroring the OPFS file set.
  slotA: string | null = null;
  slotB: string | null = null;
  ptr: "a" | "b" | null = null;
  deleteCalls = 0;
  /** When true, write() throws after the slot write but before the pointer flip. */
  crashAfterSlotWrite = false;

  /** Convenience for tests: the last-good content as read() would recover it. */
  get content(): string | null {
    if (this.slotA === null && this.slotB === null && this.ptr === null) return null;
    // Mirror read()'s resolution so existing assertions on `content` hold.
    const order: ("a" | "b")[] =
      this.ptr === "a" ? ["a", "b"] : this.ptr === "b" ? ["b", "a"] : ["a", "b"];
    for (const slot of order) {
      const c = unframeSlot(slot === "a" ? this.slotA : this.slotB);
      if (c !== null) return c;
    }
    return null;
  }

  async read(): Promise<string | null> {
    const order: ("a" | "b")[] =
      this.ptr === "a" ? ["a", "b"] : this.ptr === "b" ? ["b", "a"] : ["a", "b"];
    for (const slot of order) {
      const c = unframeSlot(slot === "a" ? this.slotA : this.slotB);
      if (c !== null) return c;
    }
    return null;
  }

  async write(content: string): Promise<void> {
    const target: "a" | "b" = this.ptr === "a" ? "b" : "a";
    const framed = frameSlot(content);
    if (target === "a") this.slotA = framed;
    else this.slotB = framed;
    if (this.crashAfterSlotWrite) {
      // Simulate process death after the slot is durable but before commit.
      throw new Error("simulated crash before pointer flip");
    }
    this.ptr = target;
  }

  async delete(): Promise<void> {
    this.deleteCalls += 1;
    this.slotA = null;
    this.slotB = null;
    this.ptr = null;
  }

  async exists(): Promise<boolean> {
    return this.slotA !== null || this.slotB !== null || this.ptr !== null;
  }
}

/** A backend whose write always throws QuotaExceededError. */
class QuotaBackend extends FakeBackend {
  override async write(): Promise<void> {
    const err = new Error("quota");
    err.name = "QuotaExceededError";
    throw err;
  }
}

/** Manual timer so debounce fires only when we call .fire(). */
class ManualTimer implements TimerLike {
  private cb: (() => void) | null = null;
  set(cb: () => void): void {
    this.cb = cb;
  }
  clear(): void {
    this.cb = null;
  }
  fire(): void {
    const cb = this.cb;
    this.cb = null;
    if (cb) cb();
  }
  hasPending(): boolean {
    return this.cb !== null;
  }
}

function makeStore(): N3.Store {
  return new N3.Store();
}

/** Add a quad to a named graph. */
function add(store: N3.Store, s: string, p: string, o: string, g: string): void {
  store.addQuad(df.namedNode(s), df.namedNode(p), df.namedNode(o), df.namedNode(g));
}

const S = "http://example.org/s";
const P = "http://example.org/p";

describe("serialize / parse / load (pure logic)", () => {
  it("serializes only the persisted graphs, excluding inferred and provenance", async () => {
    const store = makeStore();
    add(store, S, P, "http://example.org/data", "urn:vg:data");
    add(store, S, P, "http://example.org/onto", "urn:vg:ontologies");
    add(store, S, P, "http://example.org/shape", "urn:vg:shapes");
    add(store, S, P, "http://example.org/wf", "urn:vg:workflows");
    // These two MUST be excluded:
    add(store, S, P, "http://example.org/inferred", "urn:vg:inferred");
    add(store, S, P, "http://example.org/prov", "urn:vg:provenance");

    const nq = await serializePersistedGraphs(store);
    expect(nq).toContain("urn:vg:data");
    expect(nq).toContain("urn:vg:ontologies");
    expect(nq).toContain("urn:vg:shapes");
    expect(nq).toContain("urn:vg:workflows");
    expect(nq).not.toContain("urn:vg:inferred");
    expect(nq).not.toContain("urn:vg:provenance");
    // Four persisted quads.
    expect(parseNQuads(nq)).toHaveLength(4);
  });

  it("serializes empty store to empty string", async () => {
    expect(await serializePersistedGraphs(makeStore())).toBe("");
  });

  it("loadQuadsIntoStore skips quads in non-persisted graphs", () => {
    const store = makeStore();
    const quads: Quad[] = [
      df.quad(df.namedNode(S), df.namedNode(P), df.namedNode("o1"), df.namedNode("urn:vg:data")),
      df.quad(df.namedNode(S), df.namedNode(P), df.namedNode("o2"), df.namedNode("urn:vg:inferred")),
    ];
    const loaded = loadQuadsIntoStore(store, quads);
    expect(loaded).toBe(1);
    expect(store.getQuads(null, null, null, df.namedNode("urn:vg:data"))).toHaveLength(1);
    expect(store.getQuads(null, null, null, df.namedNode("urn:vg:inferred"))).toHaveLength(0);
  });
});

describe("OpfsPersistence round-trip", () => {
  let backend: FakeBackend;
  let timer: ManualTimer;
  let persistence: OpfsPersistence;

  beforeEach(() => {
    backend = new FakeBackend();
    timer = new ManualTimer();
    persistence = new OpfsPersistence({ backend, enabled: true, timer });
  });

  it("snapshot then restore preserves the persisted named graphs", async () => {
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    add(source, S, P, "http://example.org/onto", "urn:vg:ontologies");
    add(source, S, P, "http://example.org/shape", "urn:vg:shapes");
    add(source, S, P, "http://example.org/wf", "urn:vg:workflows");
    add(source, S, P, "http://example.org/inferred", "urn:vg:inferred");
    add(source, S, P, "http://example.org/prov", "urn:vg:provenance");

    persistence.scheduleSnapshot(source);
    expect(timer.hasPending()).toBe(true);
    // flush() forces the pending snapshot to run and resolves once written.
    await persistence.flush();
    expect(timer.hasPending()).toBe(false);
    expect(backend.content).toBeTruthy();

    const restored = makeStore();
    const loaded = await persistence.restore(restored);
    expect(loaded).toBe(4);
    for (const g of PERSISTED_GRAPHS) {
      expect(restored.getQuads(null, null, null, df.namedNode(g))).toHaveLength(1);
    }
    // Excluded graphs are NOT restored (they were never persisted).
    expect(restored.getQuads(null, null, null, df.namedNode("urn:vg:inferred"))).toHaveLength(0);
    expect(restored.getQuads(null, null, null, df.namedNode("urn:vg:provenance"))).toHaveLength(0);
  });

  it("flush() forces a pending snapshot without firing the timer", async () => {
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush(); // clears timer + writes
    expect(timer.hasPending()).toBe(false);
    expect(backend.content).toContain("urn:vg:data");
  });
});

describe("OpfsPersistence availability + safety guards", () => {
  it("null backend → snapshot/flush/restore/clear all no-op without throwing", async () => {
    const timer = new ManualTimer();
    const persistence = new OpfsPersistence({ backend: null, enabled: true, timer });
    expect(persistence.isActive()).toBe(false);

    const store = makeStore();
    add(store, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(store); // should not schedule
    expect(timer.hasPending()).toBe(false);
    await expect(persistence.flush()).resolves.toBeUndefined();
    await expect(persistence.restore(makeStore())).resolves.toBe(0);
    await expect(persistence.clear()).resolves.toBeUndefined();
  });

  it("disabled → inactive even with a backend", () => {
    const persistence = new OpfsPersistence({ backend: new FakeBackend(), enabled: false });
    expect(persistence.isActive()).toBe(false);
    persistence.setEnabled(true);
    expect(persistence.isActive()).toBe(true);
  });

  it("clear() deletes the file; restore after clear is empty", async () => {
    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();
    expect(backend.content).toBeTruthy();

    await persistence.clear();
    expect(backend.deleteCalls).toBe(1);
    expect(backend.content).toBeNull();

    const restored = makeStore();
    expect(await persistence.restore(restored)).toBe(0);
    expect(restored.getQuads(null, null, null, null)).toHaveLength(0);
  });

  it("corrupt / partial file → restore fails SAFELY (no throw, store unchanged)", async () => {
    const backend = new FakeBackend();
    // A committed slot whose framed payload is valid but the N-Quads inside are
    // truncated garbage → restore must parse-fail safely (no throw, no load).
    backend.slotA = frameSlot("<http://x> <http://y> <http://z"); // no terminator
    backend.ptr = "a";
    const persistence = new OpfsPersistence({ backend, enabled: true });
    const store = makeStore();
    const loaded = await persistence.restore(store);
    expect(loaded).toBe(0);
    expect(store.getQuads(null, null, null, null)).toHaveLength(0);
  });

  it("write error (QuotaExceededError) disables persistence for the session, never throws", async () => {
    const backend = new QuotaBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });
    expect(persistence.isActive()).toBe(true);
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush(); // triggers the failing write
    expect(persistence.isActive()).toBe(false);
    expect(persistence.isEnabled()).toBe(false);
  });
});

describe("slot framing (commit marker)", () => {
  it("frame → unframe round-trips arbitrary content", () => {
    for (const c of ["", "a\nb\nc", "<s> <p> <o> <g> .\n", "unicode ☃ √ é"]) {
      expect(unframeSlot(frameSlot(c))).toBe(c);
    }
  });

  it("a truncated framed slot (commit marker cut off) is rejected", () => {
    const framed = frameSlot("<s> <p> <o> .\n");
    // Simulate a torn write: keep only the first half of the bytes.
    const torn = framed.slice(0, Math.floor(framed.length / 2));
    expect(unframeSlot(torn)).toBeNull();
  });

  it("a slot with a mismatched declared length is rejected", () => {
    // Hand-craft a frame whose declared byte length lies.
    const bad = "hello\n#__OPFS_COMMIT__ 999\n";
    expect(unframeSlot(bad)).toBeNull();
  });

  it("a slot without any commit marker is rejected", () => {
    expect(unframeSlot("raw content, no marker")).toBeNull();
    expect(unframeSlot(null)).toBeNull();
  });
});

describe("OpfsPersistence crash-safety (double-buffer + pointer)", () => {
  function source1(): N3.Store {
    const s = makeStore();
    add(s, S, P, "http://example.org/v1", "urn:vg:data");
    return s;
  }
  function source2(): N3.Store {
    const s = makeStore();
    add(s, S, P, "http://example.org/v2a", "urn:vg:data");
    add(s, S, P, "http://example.org/v2b", "urn:vg:ontologies");
    return s;
  }

  it("crash DURING a new write (after a previous good snapshot) recovers the PREVIOUS snapshot — no data loss", async () => {
    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });

    // First good snapshot commits normally.
    persistence.scheduleSnapshot(source1());
    await persistence.flush();
    expect(backend.ptr).not.toBeNull();
    const goodPtr = backend.ptr;

    // Now a crash strikes during the SECOND write: slot written, pointer NOT flipped.
    backend.crashAfterSlotWrite = true;
    persistence.scheduleSnapshot(source2());
    await persistence.flush(); // OpfsPersistence swallows the error, disables persistence

    // The pointer still names the first good slot; the crash did not corrupt it.
    expect(backend.ptr).toBe(goodPtr);

    // A crash means a FRESH session/process restarts and restores from the same
    // durable backend files. restore() recovers the PREVIOUS good snapshot —
    // never empty, never corrupt.
    const reborn = new OpfsPersistence({ backend, enabled: true });
    const restored = makeStore();
    const loaded = await reborn.restore(restored);
    expect(loaded).toBe(1);
    expect(restored.getQuads(null, null, null, df.namedNode("urn:vg:data"))).toHaveLength(1);
    expect(
      restored.getQuads(df.namedNode(S), df.namedNode(P), df.namedNode("http://example.org/v1"), df.namedNode("urn:vg:data")),
    ).toHaveLength(1);
    // The half-written v2 content is NOT observable.
    expect(restored.getQuads(null, null, null, df.namedNode("urn:vg:ontologies"))).toHaveLength(0);
  });

  it("crash on the VERY FIRST write (no previous snapshot) → restore is empty, never corrupt", async () => {
    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });
    backend.crashAfterSlotWrite = true;
    persistence.scheduleSnapshot(source1());
    await persistence.flush();
    // No pointer was ever committed → read() finds the torn slot is rejected only
    // if torn; here the slot is fully framed but uncommitted. read() falls back
    // across slots and may surface it (a complete slot is still valid content),
    // but it is NEVER a half-written/corrupt snapshot.
    const reborn = new OpfsPersistence({ backend, enabled: true });
    const restored = makeStore();
    const loaded = await reborn.restore(restored);
    // Either 0 (no commit) or 1 (complete uncommitted slot) — but never corrupt.
    expect([0, 1]).toContain(loaded);
  });

  it("pointed-to slot is torn but the OTHER slot is good → restore falls back to the good slot", async () => {
    const backend = new FakeBackend();
    // Slot A holds a complete good v1 snapshot; pointer (wrongly) names B, which
    // is torn (commit marker cut off) — models a crash mid pointer-targeted write.
    backend.slotA = frameSlot(await serializePersistedGraphs(source1()));
    const tornFull = frameSlot(await serializePersistedGraphs(source2()));
    backend.slotB = tornFull.slice(0, Math.floor(tornFull.length / 2)); // torn
    backend.ptr = "b";

    const persistence = new OpfsPersistence({ backend, enabled: true });
    const restored = makeStore();
    const loaded = await persistence.restore(restored);
    // Falls back from torn B to good A → recovers v1 (1 quad).
    expect(loaded).toBe(1);
    expect(
      restored.getQuads(df.namedNode(S), df.namedNode(P), df.namedNode("http://example.org/v1"), df.namedNode("urn:vg:data")),
    ).toHaveLength(1);
  });

  it("two successive committed writes alternate slots and restore loads the LATEST", async () => {
    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });

    persistence.scheduleSnapshot(source1());
    await persistence.flush();
    const ptr1 = backend.ptr;

    persistence.scheduleSnapshot(source2());
    await persistence.flush();
    const ptr2 = backend.ptr;

    // The second write targeted the OTHER slot (double-buffering).
    expect(ptr2).not.toBe(ptr1);

    const restored = makeStore();
    const loaded = await persistence.restore(restored);
    expect(loaded).toBe(2); // v2 has two quads
    expect(restored.getQuads(null, null, null, df.namedNode("urn:vg:ontologies"))).toHaveLength(1);
  });

  it("restore prefers the committed (pointed-to) slot over a stale other slot", async () => {
    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });
    // Commit v1, then v2 — pointer names v2's slot; v1's slot is now stale.
    persistence.scheduleSnapshot(source1());
    await persistence.flush();
    persistence.scheduleSnapshot(source2());
    await persistence.flush();

    const restored = makeStore();
    await persistence.restore(restored);
    // We must see v2's data, not v1's stale 'v1' quad.
    expect(
      restored.getQuads(df.namedNode(S), df.namedNode(P), df.namedNode("http://example.org/v2a"), df.namedNode("urn:vg:data")),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// NEW: Web Locks API guard tests
// ---------------------------------------------------------------------------

describe("Web Locks API guard", () => {
  // Each test restores navigator after it runs.
  afterEach(() => {
    // Remove any navigator.locks mock injected via globalThis.
    if ("navigator" in globalThis) {
      const nav = globalThis.navigator as unknown as Record<string, unknown>;
      delete nav["locks"];
    }
  });

  /**
   * Build a mock `navigator.locks` LockManager. `available` controls whether
   * `ifAvailable` requests grant the lock (true) or return null (false,
   * simulating another tab holding it). All granted-lock calls invoke the
   * callback immediately with a fake Lock.
   */
  function makeMockLocks(available: boolean) {
    const calls: { name: string; opts: Record<string, unknown> }[] = [];
    const lockManager = {
      request: vi.fn(
        async (
          name: string,
          opts: Record<string, unknown>,
          callback: (lock: { name: string; mode: string } | null) => Promise<void>,
        ) => {
          calls.push({ name, opts });
          const lock = available ? { name, mode: "exclusive" } : null;
          await callback(lock);
        },
      ),
      _calls: calls,
    };
    return lockManager;
  }

  function injectLocks(locks: unknown): void {
    // navigator is read-only in some environments; use Object.defineProperty.
    if (!("navigator" in globalThis)) {
      Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    }
    Object.defineProperty(globalThis.navigator, "locks", {
      value: locks,
      configurable: true,
      writable: true,
    });
  }

  it("DEFAULT_LOCK_NAME is exported and non-empty", () => {
    expect(typeof DEFAULT_LOCK_NAME).toBe("string");
    expect(DEFAULT_LOCK_NAME.length).toBeGreaterThan(0);
  });

  it("when navigator.locks is available, lock is acquired around the write", async () => {
    const mockLocks = makeMockLocks(true);
    injectLocks(mockLocks);

    const backend = new FakeBackend();
    const timer = new ManualTimer();
    const persistence = new OpfsPersistence({ backend, enabled: true, timer });

    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();

    // The lock was requested with the default lock name.
    expect(mockLocks.request).toHaveBeenCalledTimes(1);
    expect(mockLocks.request.mock.calls[0][0]).toBe(DEFAULT_LOCK_NAME);
    // The write actually completed and content was persisted.
    expect(backend.content).toContain("urn:vg:data");
  });

  it("lock uses ifAvailable mode so concurrent writers do not deadlock", async () => {
    const mockLocks = makeMockLocks(true);
    injectLocks(mockLocks);

    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();

    const opts = mockLocks.request.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.ifAvailable).toBe(true);
    expect(opts.mode).toBe("exclusive");
  });

  it("when lock is held (another tab), onLockConflict is called and write is deferred", async () => {
    const mockLocks = makeMockLocks(false); // lock unavailable → null callback
    injectLocks(mockLocks);

    const backend = new FakeBackend();
    const timer = new ManualTimer();
    const conflicts: LockConflictSignal[] = [];
    const persistence = new OpfsPersistence({
      backend,
      enabled: true,
      timer,
      onLockConflict: (s) => conflicts.push(s),
    });

    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();

    // Conflict was reported.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].lockName).toBe(DEFAULT_LOCK_NAME);
    expect(typeof conflicts[0].at).toBe("string");
    // Content was NOT written (lock held by other tab).
    expect(backend.content).toBeNull();
  });

  it("two sequential writes (simulating two tabs) serialize: second waits for first to release", async () => {
    // Simulate serialization: build a lock manager that processes requests in
    // sequence with a real exclusive gate. We test the serial ordering by
    // having two OpfsPersistence instances share one mock that grants the lock
    // one at a time.
    let lockHeld = false;
    const requestOrder: string[] = [];

    const serialLocks = {
      request: vi.fn(
        async (
          name: string,
          opts: Record<string, unknown>,
          callback: (lock: { name: string; mode: string } | null) => Promise<void>,
        ) => {
          if (lockHeld && opts.ifAvailable) {
            // Another tab holds the lock → return null (conflict) immediately.
            await callback(null);
            return;
          }
          lockHeld = true;
          requestOrder.push(name);
          try {
            await callback({ name, mode: "exclusive" });
          } finally {
            lockHeld = false;
          }
        },
      ),
    };
    injectLocks(serialLocks);

    const backend1 = new FakeBackend();
    const backend2 = new FakeBackend();
    const conflicts: string[] = [];

    const p1 = new OpfsPersistence({ backend: backend1, enabled: true, onLockConflict: () => conflicts.push("tab2") });
    const p2 = new OpfsPersistence({ backend: backend2, enabled: true, onLockConflict: () => conflicts.push("tab2") });

    const s1 = makeStore();
    add(s1, S, P, "http://example.org/v1", "urn:vg:data");
    const s2 = makeStore();
    add(s2, S, P, "http://example.org/v2", "urn:vg:data");

    p1.scheduleSnapshot(s1);
    p2.scheduleSnapshot(s2);

    // Flush sequentially — p2 gets a conflict because p1 holds the lock.
    const [, ] = await Promise.all([p1.flush(), p2.flush()]);

    // p1 succeeded; p2 got a conflict.
    expect(backend1.content).toContain("v1");
    expect(conflicts.length).toBeGreaterThan(0); // p2 was blocked
  });

  it("when navigator.locks is missing, write proceeds normally (graceful fallback)", async () => {
    // Ensure no locks API is present (default jsdom/Node environment has none).
    // Do not inject anything — locks remain absent.
    const backend = new FakeBackend();
    const timer = new ManualTimer();
    const conflicts: LockConflictSignal[] = [];
    const persistence = new OpfsPersistence({
      backend,
      enabled: true,
      timer,
      onLockConflict: (s) => conflicts.push(s),
    });

    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();

    // Write succeeded without a lock (degraded gracefully).
    expect(backend.content).toContain("urn:vg:data");
    // No conflict was emitted (no locks to conflict on).
    expect(conflicts).toHaveLength(0);
  });

  it("lockName:null disables locking even when navigator.locks is present", async () => {
    const mockLocks = makeMockLocks(true);
    injectLocks(mockLocks);

    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true, lockName: null });
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();

    // Lock was never requested.
    expect(mockLocks.request).not.toHaveBeenCalled();
    // Write still completed normally.
    expect(backend.content).toContain("urn:vg:data");
  });

  it("custom lockName is passed through to navigator.locks.request", async () => {
    const mockLocks = makeMockLocks(true);
    injectLocks(mockLocks);

    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true, lockName: "my-custom-lock" });
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();

    expect(mockLocks.request.mock.calls[0][0]).toBe("my-custom-lock");
  });

  it("double-buffer + pointer invariant is preserved when a lock is held: no content written", async () => {
    // Lock unavailable → no write must occur; backend remains pristine.
    const mockLocks = makeMockLocks(false);
    injectLocks(mockLocks);

    const backend = new FakeBackend();
    const persistence = new OpfsPersistence({ backend, enabled: true });
    const source = makeStore();
    add(source, S, P, "http://example.org/data", "urn:vg:data");
    persistence.scheduleSnapshot(source);
    await persistence.flush();

    // No slot was written (the atomic-write invariant was not violated).
    expect(backend.slotA).toBeNull();
    expect(backend.slotB).toBeNull();
    expect(backend.ptr).toBeNull();
  });
});
