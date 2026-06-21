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
import { describe, it, expect, beforeEach } from "vitest";
import * as N3 from "n3";
import type { Quad } from "@rdfjs/types";
import {
  OpfsPersistence,
  serializePersistedGraphs,
  parseNQuads,
  loadQuadsIntoStore,
  PERSISTED_GRAPHS,
  type PersistenceBackend,
  type TimerLike,
} from "../opfsPersistence";

const df = N3.DataFactory;

/** In-memory PersistenceBackend standing in for OPFS. */
class FakeBackend implements PersistenceBackend {
  content: string | null = null;
  deleteCalls = 0;
  async read(): Promise<string | null> {
    return this.content;
  }
  async write(content: string): Promise<void> {
    this.content = content;
  }
  async delete(): Promise<void> {
    this.deleteCalls += 1;
    this.content = null;
  }
  async exists(): Promise<boolean> {
    return this.content !== null;
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
    backend.content = "<http://x> <http://y> <http://z"; // truncated N-Quad, no terminator
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
