// @vitest-environment node
//
// Tests for INCREMENTAL DATALOG MATERIALISATION MAINTENANCE (countingMaintenance.ts).
//
// The HEADLINE property under test is the EXACT-MAINTENANCE INVARIANT:
//
//     maintainer.getMaterialization()  ==  materialize(rules, currentEDB)
//
// after EVERY applyDelta in any sequence of inserts/deletes. We prove it on
// hand-built scenarios (transitivity, over-deletion trap, multi-derivation
// deletes) and — most strongly — by RANDOM FUZZING for both the Counting
// (non-recursive) and Backward/Forward (recursive) back-ends.
//
// Reference: B. Motik, Y. Nenov, R. Piro, I. Horrocks,
//   "Maintenance of Datalog Materialisations Revisited," AIJ 269 (2019);
//   "Incremental Update of Datalog Materialisation: the Backward/Forward
//    Algorithm," AAAI 2015.

import { describe, it, expect } from "vitest";
import {
  materialize,
  isRecursive,
  factKey,
  fact,
  atom,
  rule,
  type Fact,
  type Rule,
  IncrementalMaintainer,
  CountingMaintainer,
  BackwardForwardMaintainer,
  DRedMaintainer,
} from "../countingMaintenance.ts";

// ───────────────────────────── Helpers ──────────────────────────────────────

/** Compare two fact sets by their canonical keys. */
function sameFacts(a: Iterable<Fact>, b: Iterable<Fact>): boolean {
  const ka = new Set([...a].map(factKey));
  const kb = new Set([...b].map(factKey));
  if (ka.size !== kb.size) return false;
  for (const k of ka) if (!kb.has(k)) return false;
  return true;
}

function keySet(facts: Iterable<Fact>): Set<string> {
  return new Set([...facts].map(factKey));
}

/** Assert the maintainer's materialisation equals from-scratch over `edb`. */
function assertExact(
  maintainer: { getMaterialization(): Set<Fact> },
  rules: Rule[],
  edb: Iterable<Fact>,
  label: string,
): void {
  const got = maintainer.getMaterialization();
  const want = materialize(rules, edb);
  if (!sameFacts(got, want)) {
    const g = [...keySet(got)].sort();
    const w = [...keySet(want)].sort();
    throw new Error(
      `${label}: incremental != from-scratch\n  got (${g.length}): ${g.join(", ")}\n  want (${w.length}): ${w.join(", ")}`,
    );
  }
  expect(sameFacts(got, want)).toBe(true);
}

// A mutable EDB tracker mirroring what the maintainer should hold.
class EdbModel {
  private map = new Map<string, Fact>();
  constructor(initial: Fact[] = []) {
    for (const f of initial) this.map.set(factKey(f), f);
  }
  apply(insert: Fact[], del: Fact[]): void {
    for (const f of del) this.map.delete(factKey(f));
    for (const f of insert) this.map.set(factKey(f), f);
  }
  facts(): Fact[] {
    return [...this.map.values()];
  }
  has(f: Fact): boolean {
    return this.map.has(factKey(f));
  }
}

// ── Rule sets ────────────────────────────────────────────────────────────────

// Recursive: transitive closure  T(x,z) :- T(x,y), T(y,z).
const TRANS_RULES: Rule[] = [rule(atom("T", "?x", "?z"), atom("T", "?x", "?y"), atom("T", "?y", "?z"))];

// Non-recursive OWL-RL-style fragment:
//   type(x,C) :- type(x,D), sub(D,C)        (one-step type propagation; sub is EDB)
//   dom(x,C)  :- triple(x,p,y), domain(p,C) (rdfs:domain)
//   rng(y,C)  :- triple(x,p,y), range(p,C)  (rdfs:range)
// No head predicate appears in any body → non-recursive.
const NONREC_RULES: Rule[] = [
  rule(atom("type", "?x", "?c"), atom("type0", "?x", "?d"), atom("sub", "?d", "?c")),
  rule(atom("dom", "?x", "?c"), atom("triple", "?x", "?p", "?y"), atom("domain", "?p", "?c")),
  rule(atom("rng", "?y", "?c"), atom("triple", "?x", "?p", "?y"), atom("range", "?p", "?c")),
];

// ── Deterministic PRNG (mulberry32) for reproducible fuzzing ─────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────── Sanity: materialize ──────────────────────────

describe("materialize (semi-naïve forward chaining)", () => {
  it("computes the transitive closure of a chain", () => {
    const edb = [fact("T", "a", "b"), fact("T", "b", "c"), fact("T", "c", "d")];
    const mat = materialize(TRANS_RULES, edb);
    const keys = keySet(mat);
    // Closure of a→b→c→d: all ordered pairs along the chain.
    for (const [x, y] of [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["a", "c"],
      ["b", "d"],
      ["a", "d"],
    ]) {
      expect(keys.has(factKey(fact("T", x, y)))).toBe(true);
    }
    expect(mat.size).toBe(6);
  });

  it("non-recursive fragment derives type/domain/range facts", () => {
    const edb = [
      fact("type0", "i", "Student"),
      fact("sub", "Student", "Person"),
      fact("triple", "i", "teaches", "j"),
      fact("domain", "teaches", "Teacher"),
      fact("range", "teaches", "Course"),
    ];
    const keys = keySet(materialize(NONREC_RULES, edb));
    expect(keys.has(factKey(fact("type", "i", "Person")))).toBe(true);
    expect(keys.has(factKey(fact("dom", "i", "Teacher")))).toBe(true);
    expect(keys.has(factKey(fact("rng", "j", "Course")))).toBe(true);
  });

  it("classifies recursion correctly", () => {
    expect(isRecursive(TRANS_RULES)).toBe(true);
    expect(isRecursive(NONREC_RULES)).toBe(false);
  });
});

// ───────────────────────────── Strategy selection ───────────────────────────

describe("IncrementalMaintainer strategy selection", () => {
  it("uses counting for non-recursive rule sets", () => {
    const m = new IncrementalMaintainer(NONREC_RULES, []);
    expect(m.strategy).toBe("counting");
  });
  it("uses backward-forward for recursive rule sets", () => {
    const m = new IncrementalMaintainer(TRANS_RULES, []);
    expect(m.strategy).toBe("backward-forward");
  });
});

// ───────────────────────────── Transitivity: insert/delete ──────────────────

describe("transitivity (recursive → B/F): insert & delete edges", () => {
  it("maintains exactly across a sequence of edge deltas", () => {
    const m = new IncrementalMaintainer(TRANS_RULES, []);
    const edb = new EdbModel();
    expect(m.strategy).toBe("backward-forward");

    const steps: { ins: Fact[]; del: Fact[]; label: string }[] = [
      { ins: [fact("T", "a", "b")], del: [], label: "add a-b" },
      { ins: [fact("T", "b", "c")], del: [], label: "add b-c" },
      { ins: [fact("T", "c", "d")], del: [], label: "add c-d" },
      { ins: [fact("T", "a", "x"), fact("T", "x", "c")], del: [], label: "add second path a-x-c" },
      { ins: [], del: [fact("T", "b", "c")], label: "delete b-c (a-c survives via a-x-c)" },
      { ins: [], del: [fact("T", "x", "c")], label: "delete x-c (a-c now gone)" },
      { ins: [], del: [fact("T", "a", "b")], label: "delete a-b" },
    ];

    for (const s of steps) {
      m.applyDelta(s.ins, s.del);
      edb.apply(s.ins, s.del);
      assertExact(m, TRANS_RULES, edb.facts(), s.label);
    }
  });

  it("DELETE of a fact with MULTIPLE derivations keeps it (count/B-F > 0)", () => {
    // a→b, b→c, a→c-direct? No — make T(a,c) derivable via TWO inner nodes.
    // Chain a→b→c gives derived T(a,c). Add a→x→c too: T(a,c) has 2 derivations.
    const edb = new EdbModel([
      fact("T", "a", "b"),
      fact("T", "b", "c"),
      fact("T", "a", "x"),
      fact("T", "x", "c"),
    ]);
    const m = new IncrementalMaintainer(TRANS_RULES, edb.facts());
    assertExact(m, TRANS_RULES, edb.facts(), "initial two-path");
    expect(keySet(m.getMaterialization()).has(factKey(fact("T", "a", "c")))).toBe(true);

    // Delete ONE path (b→c). T(a,c) still derivable via a→x→c: must SURVIVE.
    m.applyDelta([], [fact("T", "b", "c")]);
    edb.apply([], [fact("T", "b", "c")]);
    assertExact(m, TRANS_RULES, edb.facts(), "after deleting one path");
    expect(keySet(m.getMaterialization()).has(factKey(fact("T", "a", "c")))).toBe(true);

    // Delete the SOLE remaining support (x→c). Now T(a,c) has no support → GONE.
    m.applyDelta([], [fact("T", "x", "c")]);
    edb.apply([], [fact("T", "x", "c")]);
    assertExact(m, TRANS_RULES, edb.facts(), "after deleting sole support");
    expect(keySet(m.getMaterialization()).has(factKey(fact("T", "a", "c")))).toBe(false);
  });
});

// ───────────────────────────── Over-deletion trap ───────────────────────────

describe("over-deletion trap: fact supported by two independent paths", () => {
  // A derived fact P(a,d) supported by two disjoint derivation paths. Deleting
  // one path must NOT remove P(a,d) — naïve DRed over-deletes then rederives;
  // Counting/B-F (and our DRed oracle) all must end with P(a,d) present.
  function buildTrap() {
    // Non-recursive 2-step rule:  P(x,z) :- A(x,y), B(y,z).
    const rules: Rule[] = [rule(atom("P", "?x", "?z"), atom("A", "?x", "?y"), atom("B", "?y", "?z"))];
    // Two independent witnesses for P(a,d): via y=m1 and via y=m2.
    const edb: Fact[] = [
      fact("A", "a", "m1"),
      fact("B", "m1", "d"),
      fact("A", "a", "m2"),
      fact("B", "m2", "d"),
    ];
    return { rules, edb };
  }

  it("non-recursive (Counting): survives single-path delete", () => {
    const { rules, edb } = buildTrap();
    expect(isRecursive(rules)).toBe(false);
    const model = new EdbModel(edb);
    const m = new IncrementalMaintainer(rules, model.facts());
    expect(m.strategy).toBe("counting");
    expect(keySet(m.getMaterialization()).has(factKey(fact("P", "a", "d")))).toBe(true);

    // Delete one path (A(a,m1)). P(a,d) still derivable via m2 → SURVIVES.
    m.applyDelta([], [fact("A", "a", "m1")]);
    model.apply([], [fact("A", "a", "m1")]);
    assertExact(m, rules, model.facts(), "trap: counting after single-path delete");
    expect(keySet(m.getMaterialization()).has(factKey(fact("P", "a", "d")))).toBe(true);

    // Delete the second path too → P(a,d) gone.
    m.applyDelta([], [fact("A", "a", "m2")]);
    model.apply([], [fact("A", "a", "m2")]);
    assertExact(m, rules, model.facts(), "trap: counting after both paths deleted");
    expect(keySet(m.getMaterialization()).has(factKey(fact("P", "a", "d")))).toBe(false);
  });

  it("B/F and DRed agree on the trap too", () => {
    const { rules, edb } = buildTrap();
    for (const Maker of [BackwardForwardMaintainer, DRedMaintainer]) {
      const model = new EdbModel(edb);
      const m = new Maker(rules, model.facts());
      m.applyDelta([], [fact("A", "a", "m1")]);
      model.apply([], [fact("A", "a", "m1")]);
      assertExact(m, rules, model.facts(), `trap: ${Maker.name} survives`);
      expect(keySet(m.getMaterialization()).has(factKey(fact("P", "a", "d")))).toBe(true);
    }
  });

  it("recursive over-deletion trap (B/F): diamond of transitive edges", () => {
    // a→b, a→c, b→d, c→d. T(a,d) has two derivations (via b and via c).
    const edb = new EdbModel([
      fact("T", "a", "b"),
      fact("T", "a", "c"),
      fact("T", "b", "d"),
      fact("T", "c", "d"),
    ]);
    const m = new IncrementalMaintainer(TRANS_RULES, edb.facts());
    expect(keySet(m.getMaterialization()).has(factKey(fact("T", "a", "d")))).toBe(true);

    m.applyDelta([], [fact("T", "b", "d")]); // remove one path
    edb.apply([], [fact("T", "b", "d")]);
    assertExact(m, TRANS_RULES, edb.facts(), "diamond: one path removed");
    expect(keySet(m.getMaterialization()).has(factKey(fact("T", "a", "d")))).toBe(true);
  });
});

// ───────────────────────────── Inserts & mixed deltas ───────────────────────

describe("inserts that create new derivations, and mixed insert+delete", () => {
  it("insert links two chains, creating many new transitive facts", () => {
    const edb = new EdbModel([
      fact("T", "a", "b"),
      fact("T", "b", "c"),
      fact("T", "p", "q"),
      fact("T", "q", "r"),
    ]);
    const m = new IncrementalMaintainer(TRANS_RULES, edb.facts());
    assertExact(m, TRANS_RULES, edb.facts(), "two separate chains");

    // Bridge c→p: now a..c connects to p..r.
    m.applyDelta([fact("T", "c", "p")], []);
    edb.apply([fact("T", "c", "p")], []);
    assertExact(m, TRANS_RULES, edb.facts(), "after bridging chains");
    expect(keySet(m.getMaterialization()).has(factKey(fact("T", "a", "r")))).toBe(true);
  });

  it("mixed insert + delete in a single delta", () => {
    const edb = new EdbModel([fact("T", "a", "b"), fact("T", "b", "c")]);
    const m = new IncrementalMaintainer(TRANS_RULES, edb.facts());
    // Simultaneously delete b→c and insert b→d, c→e.
    const ins = [fact("T", "b", "d"), fact("T", "c", "e")];
    const del = [fact("T", "b", "c")];
    m.applyDelta(ins, del);
    edb.apply(ins, del);
    assertExact(m, TRANS_RULES, edb.facts(), "mixed insert+delete");
  });

  it("non-recursive: mixed delta over OWL-RL fragment", () => {
    const edb = new EdbModel([
      fact("type0", "i", "Student"),
      fact("sub", "Student", "Person"),
      fact("sub", "Person", "Agent"),
    ]);
    // NB sub is EDB here; the rule is single-step so Student→Person and the
    // separate Person→Agent do not chain (non-recursive on purpose).
    const m = new IncrementalMaintainer(NONREC_RULES, edb.facts());
    assertExact(m, NONREC_RULES, edb.facts(), "owl-rl initial");

    const ins = [fact("type0", "i", "Person"), fact("triple", "i", "p", "j"), fact("domain", "p", "Thing")];
    const del = [fact("sub", "Student", "Person")];
    m.applyDelta(ins, del);
    edb.apply(ins, del);
    assertExact(m, NONREC_RULES, edb.facts(), "owl-rl mixed delta");
  });
});

// ───────────────────────────── Determinism ──────────────────────────────────

describe("determinism", () => {
  it("two maintainers given the same delta sequence agree", () => {
    const seq: { ins: Fact[]; del: Fact[] }[] = [
      { ins: [fact("T", "a", "b"), fact("T", "b", "c")], del: [] },
      { ins: [fact("T", "c", "d")], del: [] },
      { ins: [], del: [fact("T", "b", "c")] },
      { ins: [fact("T", "a", "c")], del: [] },
      { ins: [], del: [fact("T", "a", "b")] },
    ];
    const m1 = new IncrementalMaintainer(TRANS_RULES, []);
    const m2 = new IncrementalMaintainer(TRANS_RULES, []);
    for (const s of seq) {
      m1.applyDelta(s.ins, s.del);
      m2.applyDelta(s.ins, s.del);
      expect(sameFacts(m1.getMaterialization(), m2.getMaterialization())).toBe(true);
    }
  });

  it("getMaterialization is stable across repeated calls", () => {
    const m = new IncrementalMaintainer(TRANS_RULES, [fact("T", "a", "b"), fact("T", "b", "c")]);
    expect(sameFacts(m.getMaterialization(), m.getMaterialization())).toBe(true);
  });
});

// ───────────────────────────── DeltaResult diff ─────────────────────────────

describe("applyDelta returns the correct added/removed diff", () => {
  it("reports added transitive facts on insert", () => {
    const m = new IncrementalMaintainer(TRANS_RULES, [fact("T", "a", "b")]);
    const { added, removed } = m.applyDelta([fact("T", "b", "c")], []);
    const addedKeys = keySet(added);
    expect(addedKeys.has(factKey(fact("T", "b", "c")))).toBe(true); // the EDB insert
    expect(addedKeys.has(factKey(fact("T", "a", "c")))).toBe(true); // derived
    expect(removed.length).toBe(0);
  });

  it("reports removed facts on delete of sole support", () => {
    const m = new IncrementalMaintainer(TRANS_RULES, [fact("T", "a", "b"), fact("T", "b", "c")]);
    const { added, removed } = m.applyDelta([], [fact("T", "b", "c")]);
    const removedKeys = keySet(removed);
    expect(removedKeys.has(factKey(fact("T", "b", "c")))).toBe(true);
    expect(removedKeys.has(factKey(fact("T", "a", "c")))).toBe(true);
    expect(added.length).toBe(0);
  });
});

// ───────────────────────────── Fuzz: the strongest test ─────────────────────

/**
 * Random fuzzing of the EXACT-MAINTENANCE INVARIANT. We generate random
 * insert/delete deltas of EDB edges and, after EVERY delta, assert the
 * incrementally maintained materialisation equals a from-scratch materialisation
 * of the current EDB. This is the property from Motik et al. (correctness of
 * incremental maintenance == recomputation).
 */
function fuzzTransitive(seed: number, nodes: number, steps: number): void {
  const rng = mulberry32(seed);
  const names = Array.from({ length: nodes }, (_, i) => `n${i}`);
  const randEdge = (): Fact => fact("T", names[Math.floor(rng() * nodes)], names[Math.floor(rng() * nodes)]);

  const model = new EdbModel();
  const m = new IncrementalMaintainer(TRANS_RULES, []);

  for (let step = 0; step < steps; step++) {
    const ins: Fact[] = [];
    const del: Fact[] = [];
    const nIns = Math.floor(rng() * 3);
    const nDel = Math.floor(rng() * 3);
    for (let i = 0; i < nIns; i++) ins.push(randEdge());
    // Prefer deleting existing edges so deletes actually bite.
    const existing = model.facts();
    for (let i = 0; i < nDel; i++) {
      if (existing.length > 0 && rng() < 0.8) {
        del.push(existing[Math.floor(rng() * existing.length)]);
      } else {
        del.push(randEdge());
      }
    }
    m.applyDelta(ins, del);
    model.apply(ins, del);
    assertExact(m, TRANS_RULES, model.facts(), `fuzz-trans seed=${seed} step=${step}`);
  }
}

function fuzzNonRecursive(seed: number, steps: number): void {
  const rng = mulberry32(seed);
  const inds = ["i", "j", "k"];
  const cls = ["A", "B", "C", "D"];
  const props = ["p", "q"];
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const randFact = (): Fact => {
    switch (Math.floor(rng() * 5)) {
      case 0:
        return fact("type0", pick(inds), pick(cls));
      case 1:
        return fact("sub", pick(cls), pick(cls));
      case 2:
        return fact("triple", pick(inds), pick(props), pick(inds));
      case 3:
        return fact("domain", pick(props), pick(cls));
      default:
        return fact("range", pick(props), pick(cls));
    }
  };

  const model = new EdbModel();
  const m = new IncrementalMaintainer(NONREC_RULES, []);
  expect(m.strategy).toBe("counting");

  for (let step = 0; step < steps; step++) {
    const ins: Fact[] = [];
    const del: Fact[] = [];
    const nIns = Math.floor(rng() * 3);
    const nDel = Math.floor(rng() * 3);
    for (let i = 0; i < nIns; i++) ins.push(randFact());
    const existing = model.facts();
    for (let i = 0; i < nDel; i++) {
      if (existing.length > 0 && rng() < 0.8) del.push(existing[Math.floor(rng() * existing.length)]);
      else del.push(randFact());
    }
    m.applyDelta(ins, del);
    model.apply(ins, del);
    assertExact(m, NONREC_RULES, model.facts(), `fuzz-nonrec seed=${seed} step=${step}`);
  }
}

describe("random fuzz: incremental == from-scratch at EVERY step", () => {
  it("recursive transitivity (B/F) — many seeds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      fuzzTransitive(seed, 5, 30);
    }
  });

  it("recursive transitivity (B/F) — larger graphs", () => {
    for (let seed = 100; seed <= 110; seed++) {
      fuzzTransitive(seed, 8, 50);
    }
  });

  it("non-recursive OWL-RL fragment (Counting) — many seeds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      fuzzNonRecursive(seed, 40);
    }
  });

  it("Counting and B/F agree with DRed oracle under fuzz (cross-check)", () => {
    // For the same recursive rule set, all three back-ends must produce identical
    // materialisations at every step.
    for (let seed = 200; seed <= 210; seed++) {
      const rng = mulberry32(seed);
      const nodes = 6;
      const names = Array.from({ length: nodes }, (_, i) => `n${i}`);
      const randEdge = (): Fact => fact("T", names[Math.floor(rng() * nodes)], names[Math.floor(rng() * nodes)]);
      const model = new EdbModel();
      const bf = new BackwardForwardMaintainer(TRANS_RULES, []);
      const dred = new DRedMaintainer(TRANS_RULES, []);
      for (let step = 0; step < 30; step++) {
        const ins: Fact[] = [];
        const del: Fact[] = [];
        for (let i = 0; i < Math.floor(rng() * 3); i++) ins.push(randEdge());
        const ex = model.facts();
        for (let i = 0; i < Math.floor(rng() * 3); i++) {
          if (ex.length > 0 && rng() < 0.8) del.push(ex[Math.floor(rng() * ex.length)]);
          else del.push(randEdge());
        }
        bf.applyDelta(ins, del);
        dred.applyDelta(ins, del);
        model.apply(ins, del);
        assertExact(bf, TRANS_RULES, model.facts(), `xcheck-bf seed=${seed} step=${step}`);
        assertExact(dred, TRANS_RULES, model.facts(), `xcheck-dred seed=${seed} step=${step}`);
        expect(sameFacts(bf.getMaterialization(), dred.getMaterialization())).toBe(true);
      }
    }
  });
});
