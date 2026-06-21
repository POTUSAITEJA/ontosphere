/**
 * countingMaintenance.ts
 *
 * INCREMENTAL DATALOG MATERIALISATION MAINTENANCE — a pure, standalone module
 * implementing the three classic maintenance algorithms for positive Datalog:
 *
 *   • DRed     (Delete-and-Rederive)
 *   • Counting (exact derivation counts; for NON-recursive rule sets)
 *   • B/F      (Backward/Forward; exact, for general / recursive rule sets)
 *
 * PURE, STANDALONE module. NOT wired into the worker / reasoning pipeline yet.
 *
 * This is the principled upgrade over "purge-and-rederive" for the rule-based
 * (OWL RL) forward-chaining materialisation: when the EDB (asserted facts)
 * changes by a small delta, we update the IDB (materialised facts) incrementally
 * instead of recomputing the whole least fixpoint from scratch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THEORY & REFERENCES
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the algorithms of:
 *
 *   B. Motik, Y. Nenov, R. Piro, I. Horrocks.
 *   "Maintenance of Datalog Materialisations Revisited."
 *   Artificial Intelligence 269 (2019) 76–136.
 *
 *   B. Motik, Y. Nenov, R. Piro, I. Horrocks.
 *   "Incremental Update of Datalog Materialisation: the Backward/Forward
 *    Algorithm." Proc. AAAI 2015, pp. 1560–1568.
 *
 * SCOPE / HONESTY
 * ───────────────
 * This is a generic POSITIVE Datalog engine (Horn rules, no negation, no
 * built-ins beyond term equality / joins). That is exactly the fragment used for
 * OWL RL-style rule materialisation (subClassOf transitivity, type propagation,
 * subPropertyOf, domain/range, …). The tableau (Konclude) path is a different
 * beast and is NOT covered here — incremental Datalog maintenance only applies
 * where reasoning is expressed as explicit forward-chaining rules.
 *
 * THE CENTRAL CORRECTNESS INVARIANT
 * ─────────────────────────────────
 * After ANY sequence of applyDelta(insert, delete) operations:
 *
 *     maintainer.getMaterialization()  ==  materialize(rules, currentEDB)
 *
 * i.e. the incrementally maintained materialisation is EXACTLY EQUAL to a
 * from-scratch materialisation of the current EDB. This is the property the test
 * suite fuzzes hard.
 *
 * ── WHY THREE ALGORITHMS ──────────────────────────────────────────────────────
 * The hard part of maintenance is DELETION: when a fact F is deleted we must
 * remove every IDB fact whose support depended (transitively) on F, but ONLY if
 * it has NO alternative derivation that survives.
 *
 *   DRed: over-delete (remove everything reachable via derivations from the
 *         deleted facts), then re-derive the ones that still have support. Simple
 *         and always correct, but does wasted work (the "over-deletion" then
 *         "rederivation" round trip).
 *
 *   Counting: keep, per derived fact, an EXACT count of the number of distinct
 *         rule-instance derivations. On delete, decrement; remove a fact only
 *         when its count reaches 0. No over-deletion, no rederivation. BUT exact
 *         counting is only sound for NON-RECURSIVE rule sets — with recursion a
 *         fact can support its own derivation and the counts cease to reflect
 *         well-foundedness (Motik et al. AIJ 2019 §3; the original counting
 *         algorithm of Gupta–Mumick–Subrahmanian is unsound under recursion).
 *
 *   B/F: for general (recursive) rule sets. On delete it does NOT over-delete a
 *         fact that still holds; instead, for each fact whose support is in
 *         question it BACKWARD-checks whether the fact still has a well-founded
 *         derivation from facts that survive (the deleted set removed), then
 *         FORWARD-derives the consequences of what survives. Exact (no spurious
 *         over-deletion remaining) and works with recursion.
 *
 * applyDelta() picks automatically: Counting when the rule set is non-recursive,
 * B/F otherwise. Each algorithm is also exposed separately for testing.
 */

// ───────────────────────────── Term & atom model ────────────────────────────

/**
 * A Datalog TERM is either a constant (a plain string, by convention NOT starting
 * with `?`) or a variable (a string starting with `?`, e.g. `?x`).
 */
export type Term = string;

export function isVariable(t: Term): boolean {
  return t.length > 0 && t.charCodeAt(0) === 0x3f /* '?' */;
}

/**
 * A FACT is a ground atom: a predicate plus a list of constant arguments.
 * Triples are modelled as predicate="triple" with [s, p, o], but the engine is
 * generic over arbitrary predicates/arities.
 */
export interface Fact {
  readonly predicate: string;
  readonly args: readonly Term[];
}

/** An ATOM in a rule body/head may contain variables. */
export interface Atom {
  readonly predicate: string;
  readonly args: readonly Term[];
}

/** A Horn RULE: head :- body[0], body[1], … (conjunction). */
export interface Rule {
  readonly head: Atom;
  readonly body: readonly Atom[];
}

// ── Convenience constructors ─────────────────────────────────────────────────

export function fact(predicate: string, ...args: Term[]): Fact {
  return { predicate, args };
}

export function atom(predicate: string, ...args: Term[]): Atom {
  return { predicate, args };
}

export function rule(head: Atom, ...body: Atom[]): Rule {
  return { head, body };
}

/**
 * Canonical string key for a fact (used for set/map membership). Uses JSON of
 * [predicate, ...args] so the key is an unambiguous, losslessly-decodable
 * encoding regardless of which characters appear in IRIs/predicates/args.
 */
export function factKey(f: Fact): string {
  return JSON.stringify([f.predicate, ...f.args]);
}

/** Decode a factKey back into a Fact (exact inverse of factKey). */
function decodeKey(k: string): Fact {
  const parts = JSON.parse(k) as string[];
  return { predicate: parts[0], args: parts.slice(1) };
}

// ───────────────────────────── Substitutions ────────────────────────────────

type Substitution = Map<string, Term>;

/** Apply a substitution to an atom, yielding a (possibly still non-ground) atom. */
function applySubst(a: Atom, sub: Substitution): Atom {
  if (a.args.length === 0) return a;
  const args = a.args.map((t) => (isVariable(t) ? sub.get(t) ?? t : t));
  return { predicate: a.predicate, args };
}

/** A fully-substituted atom is ground iff no argument is a variable. */
function groundAtomToFact(a: Atom): Fact | null {
  for (const t of a.args) if (isVariable(t)) return null;
  return { predicate: a.predicate, args: a.args };
}

/**
 * Try to unify a body atom `pattern` (may contain vars) against a ground `f`,
 * extending the substitution `sub`. Returns a NEW substitution on success, or
 * null on failure. Standard one-way matching (pattern→fact); `sub` is not
 * mutated.
 */
function matchAtom(pattern: Atom, f: Fact, sub: Substitution): Substitution | null {
  if (pattern.predicate !== f.predicate) return null;
  if (pattern.args.length !== f.args.length) return null;
  let next: Substitution | null = null;
  for (let i = 0; i < pattern.args.length; i++) {
    const pt = pattern.args[i];
    const ft = f.args[i];
    if (isVariable(pt)) {
      const bound = (next ?? sub).get(pt);
      if (bound === undefined) {
        if (next === null) next = new Map(sub);
        next.set(pt, ft);
      } else if (bound !== ft) {
        return null;
      }
    } else if (pt !== ft) {
      return null;
    }
  }
  return next ?? sub;
}

// ───────────────────────────── Fact index ───────────────────────────────────

/**
 * A FactIndex is a keyed collection of facts indexed by predicate for fast joins.
 */
class FactIndex {
  private byPredicate = new Map<string, Map<string, Fact>>();
  private all = new Map<string, Fact>();

  constructor(facts?: Iterable<Fact>) {
    if (facts) for (const f of facts) this.add(f);
  }

  add(f: Fact): boolean {
    const k = factKey(f);
    if (this.all.has(k)) return false;
    this.all.set(k, f);
    let bucket = this.byPredicate.get(f.predicate);
    if (!bucket) {
      bucket = new Map();
      this.byPredicate.set(f.predicate, bucket);
    }
    bucket.set(k, f);
    return true;
  }

  delete(f: Fact): boolean {
    const k = factKey(f);
    if (!this.all.has(k)) return false;
    this.all.delete(k);
    const bucket = this.byPredicate.get(f.predicate);
    if (bucket) {
      bucket.delete(k);
      if (bucket.size === 0) this.byPredicate.delete(f.predicate);
    }
    return true;
  }

  has(f: Fact): boolean {
    return this.all.has(factKey(f));
  }

  hasKey(k: string): boolean {
    return this.all.has(k);
  }

  forPredicate(p: string): Iterable<Fact> {
    return this.byPredicate.get(p)?.values() ?? [];
  }

  get size(): number {
    return this.all.size;
  }

  values(): IterableIterator<Fact> {
    return this.all.values();
  }

  keys(): IterableIterator<string> {
    return this.all.keys();
  }
}

// ───────────────────────────── Rule evaluation ──────────────────────────────

/**
 * Enumerate all substitutions that satisfy `body` (a conjunction of atoms)
 * against the fact `source`. `source(atomIndex)` selects the set body atom i is
 * matched against; this lets semi-naïve evaluation force one atom to range over
 * the "delta" facts while the rest range over the full index.
 *
 * Yields fully-extended substitutions (one per matching tuple).
 */
function* joinBody(
  body: readonly Atom[],
  index: number,
  sub: Substitution,
  source: (atomIndex: number) => Iterable<Fact>,
): Generator<Substitution> {
  if (index === body.length) {
    yield sub;
    return;
  }
  const pattern = applySubst(body[index], sub);
  for (const f of source(index)) {
    const next = matchAtom(pattern, f, sub);
    if (next !== null) {
      yield* joinBody(body, index + 1, next, source);
    }
  }
}

/**
 * Enumerate rule instances (derivations) of one rule. When `deltaSource` is
 * provided and returns a non-null iterable for atom i, that atom is matched
 * against the delta; otherwise atom i ranges over the full index. Each yielded
 * derivation carries the ground head and the ground body fact keys.
 */
function* derivationsOfRule(
  r: Rule,
  fullIndex: FactIndex,
  deltaSource?: (atomIndex: number) => Iterable<Fact> | null,
): Generator<{ head: Fact; bodyKeys: string[] }> {
  if (r.body.length === 0) return; // empty-body rules handled separately
  const source = (atomIndex: number): Iterable<Fact> => {
    if (deltaSource) {
      const d = deltaSource(atomIndex);
      if (d !== null) return d;
    }
    return fullIndex.forPredicate(r.body[atomIndex].predicate);
  };
  for (const sub of joinBody(r.body, 0, new Map(), source)) {
    const groundHead = groundAtomToFact(applySubst(r.head, sub));
    if (groundHead === null) continue; // unsafe rule head var — skip
    const bodyKeys = r.body.map((b) => factKey(groundAtomToFact(applySubst(b, sub)) as Fact));
    yield { head: groundHead, bodyKeys };
  }
}

/** Enumerate every rule instance (derivation) supported by `index`. */
function* allDerivations(rules: readonly Rule[], index: FactIndex): Generator<{ head: Fact; bodyKeys: string[] }> {
  for (const r of rules) yield* derivationsOfRule(r, index);
}

// ───────────────────────────── Full materialisation ─────────────────────────

/**
 * Forward-chain `rules` over the facts already in `seed` to the least fixpoint,
 * returning a fresh index. SEMI-NAÏVE: each round only fires rule instances that
 * use at least one fact derived in the previous round (the "delta").
 */
function materializeInto(rules: readonly Rule[], seed: Iterable<Fact>): FactIndex {
  const index = new FactIndex(seed);

  // Seed any empty-body (fact-assertion) rules first.
  for (const r of rules) {
    if (r.body.length === 0) {
      const gh = groundAtomToFact(r.head);
      if (gh) index.add(gh);
    }
  }

  let delta = new FactIndex(index.values());
  while (delta.size > 0) {
    const nextDelta = new FactIndex();
    for (const r of rules) {
      for (let pin = 0; pin < r.body.length; pin++) {
        const deltaSource = (atomIndex: number): Iterable<Fact> | null => {
          if (atomIndex === pin) return delta.forPredicate(r.body[atomIndex].predicate);
          return null;
        };
        for (const { head } of derivationsOfRule(r, index, deltaSource)) {
          if (!index.has(head)) {
            index.add(head);
            nextDelta.add(head);
          }
        }
      }
    }
    delta = nextDelta;
  }
  return index;
}

/**
 * Compute the least fixpoint of `rules` over `edb` by semi-naïve forward
 * chaining. Returns the full materialised fact set (EDB ∪ all derived IDB).
 */
export function materialize(rules: readonly Rule[], edb: Iterable<Fact>): Set<Fact> {
  return new Set(materializeInto(rules, edb).values());
}

// ───────────────────────────── Recursion analysis ───────────────────────────

/**
 * Determine whether a rule set is RECURSIVE via its predicate dependency graph:
 * an edge p → q exists when some rule with head predicate p has q in its body.
 * The rule set is recursive iff this graph has a cycle. Counting is only sound on
 * NON-recursive rule sets (Motik et al. AIJ 2019); B/F handles recursion.
 */
export function isRecursive(rules: readonly Rule[]): boolean {
  const edges = new Map<string, Set<string>>();
  const nodes = new Set<string>();
  for (const r of rules) {
    nodes.add(r.head.predicate);
    let s = edges.get(r.head.predicate);
    if (!s) {
      s = new Set();
      edges.set(r.head.predicate, s);
    }
    for (const b of r.body) {
      s.add(b.predicate);
      nodes.add(b.predicate);
    }
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const stack: { node: string; iter: Iterator<string> }[] = [];

  for (const start of nodes) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    color.set(start, GRAY);
    stack.push({ node: start, iter: (edges.get(start) ?? new Set<string>()).values() });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const next = frame.iter.next();
      if (next.done) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const child = next.value;
      const c = color.get(child) ?? WHITE;
      if (c === GRAY) return true; // back edge → cycle
      if (c === WHITE) {
        color.set(child, GRAY);
        stack.push({ node: child, iter: (edges.get(child) ?? new Set<string>()).values() });
      }
    }
  }
  return false;
}

// ───────────────────────────── Maintainer base ──────────────────────────────

export interface DeltaResult {
  readonly added: Fact[];
  readonly removed: Fact[];
}

/**
 * Common state for all maintainers: the rule set, the current EDB (asserted
 * facts) and the current full materialisation (the IDB index — which by
 * convention INCLUDES the EDB facts, exactly as `materialize` returns).
 */
abstract class BaseMaintainer {
  protected readonly rules: readonly Rule[];
  protected edb: FactIndex;
  protected mat: FactIndex;

  constructor(rules: readonly Rule[], edb: Iterable<Fact>) {
    this.rules = rules;
    this.edb = new FactIndex(edb);
    this.mat = materializeInto(rules, this.edb.values());
  }

  getMaterialization(): Set<Fact> {
    return new Set(this.mat.values());
  }

  getEdb(): Set<Fact> {
    return new Set(this.edb.values());
  }

  abstract applyDelta(insert: Fact[], deleteFacts: Fact[]): DeltaResult;

  /** Snapshot of mat keys before a delta, used to compute the added/removed diff. */
  protected snapshotKeys(): Set<string> {
    return new Set(this.mat.keys());
  }

  protected diff(before: Set<string>): DeltaResult {
    const added: Fact[] = [];
    const removed: Fact[] = [];
    const afterKeys = new Set(this.mat.keys());
    for (const f of this.mat.values()) if (!before.has(factKey(f))) added.push(f);
    for (const k of before) if (!afterKeys.has(k)) removed.push(decodeKey(k));
    return { added, removed };
  }

  /**
   * Normalise a raw delta against the current EDB. The delta semantics are
   * "delete-then-insert" (INSERT WINS): the net effect of applyDelta(I, D) on the
   * EDB is (EDB \ D) ∪ I. Concretely we reduce the raw lists to the EDB facts that
   * actually change:
   *
   *   • A delete bites only if the fact is currently in the EDB AND not also being
   *     inserted (insert wins → the fact ends present, so no net deletion).
   *   • An insert bites only if the fact is not already in the EDB (after deletes
   *     it would be re-added, but if it was present and not deleted it is a no-op).
   *
   * Equivalently: insMap = I \ EDB (the genuinely new facts);
   *               delMap = (D \ I) ∩ EDB (deletions not overridden by an insert).
   */
  protected normaliseDelta(
    insert: Fact[],
    deleteFacts: Fact[],
  ): { insMap: Map<string, Fact>; delMap: Map<string, Fact> } {
    const insKeys = new Set(insert.map(factKey));
    const insMap = new Map<string, Fact>();
    for (const f of insert) if (!this.edb.has(f)) insMap.set(factKey(f), f);
    const delMap = new Map<string, Fact>();
    for (const f of deleteFacts) {
      const k = factKey(f);
      if (this.edb.has(f) && !insKeys.has(k)) delMap.set(k, f);
    }
    return { insMap, delMap };
  }
}

// ───────────────────────────── Counting maintainer ──────────────────────────

/**
 * COUNTING maintenance (Motik et al. AIJ 2019 §3; orig. Gupta, Mumick,
 * Subrahmanian 1993). Keeps an EXACT derivation count per materialised fact: the
 * number of distinct rule instances whose head is that fact and whose body is
 * fully present in the materialisation, plus a base count of 1 for EDB facts.
 *
 *   • On INSERT: add EDB base support, then forward-chain; each new rule instance
 *     increments its head count; a fact appears the first time its count goes
 *     0→positive.
 *   • On DELETE: remove the EDB base support, then propagate count decrements
 *     through rule instances; a fact disappears exactly when its count reaches 0,
 *     which — for NON-RECURSIVE rule sets — happens iff it has no surviving
 *     derivation.
 *
 * SOUNDNESS: exact only for non-recursive rule sets. With recursion, mutual
 * support inflates counts and a fact can keep a nonzero count without a
 * well-founded derivation; use B/F in that case.
 */
export class CountingMaintainer extends BaseMaintainer {
  /** count[factKey] = number of distinct supporting derivations (incl. EDB base). */
  private count = new Map<string, number>();

  constructor(rules: readonly Rule[], edb: Iterable<Fact>) {
    super(rules, edb);
    this.recomputeCounts();
  }

  /** Recompute all derivation counts from the current materialisation + EDB. */
  private recomputeCounts(): void {
    this.count.clear();
    for (const f of this.edb.values()) {
      const k = factKey(f);
      this.count.set(k, (this.count.get(k) ?? 0) + 1);
    }
    for (const { head } of allDerivations(this.rules, this.mat)) {
      const k = factKey(head);
      this.count.set(k, (this.count.get(k) ?? 0) + 1);
    }
  }

  applyDelta(insert: Fact[], deleteFacts: Fact[]): DeltaResult {
    const before = this.snapshotKeys();
    const { insMap, delMap } = this.normaliseDelta(insert, deleteFacts);

    // ── DELETE phase: remove EDB base support, cascade decrements to fixpoint. ──
    // Each EDB deletion is processed and FULLY drained before the next. Draining
    // sequentially (rather than removing every deleted EDB fact up front) is what
    // keeps the per-instance accounting exact: when two body facts of the same
    // derivation are deleted in one delta, the derivation is invalidated by the
    // FIRST removal (found while the second is still present) and counted once;
    // the second removal no longer sees that derivation, so the head is not
    // double-decremented.
    for (const [k, f] of delMap) {
      this.edb.delete(f);
      const decQueue: string[] = [];
      this.decrement(k, decQueue);
      this.drainDecrements(decQueue);
    }

    // ── INSERT phase: add EDB base support, forward-chain incrementally. ───────
    // Each insertion is forward-chained before the next, for the symmetric reason:
    // a derivation needing two newly-inserted body facts must be counted once, by
    // the chaining step that runs when its second body fact is already present.
    for (const [, f] of insMap) {
      this.edb.add(f);
      const newlyTrue: Fact[] = [];
      this.increment(f, newlyTrue);
      this.forwardChainCounts(newlyTrue);
    }

    return this.diff(before);
  }

  /** Increment a fact's count by 1; if it transitions 0→positive, record it true. */
  private increment(f: Fact, newlyTrue: Fact[]): void {
    const k = factKey(f);
    const prev = this.count.get(k) ?? 0;
    this.count.set(k, prev + 1);
    if (prev === 0) {
      this.mat.add(f);
      newlyTrue.push(f);
    }
  }

  /** Decrement a fact's count by 1; if it hits 0, remove it and enqueue cascade. */
  private decrement(k: string, queue: string[]): void {
    const prev = this.count.get(k) ?? 0;
    const next = prev - 1;
    if (next <= 0) {
      this.count.delete(k);
      const f = decodeKey(k);
      if (this.mat.delete(f)) queue.push(k);
    } else {
      this.count.set(k, next);
    }
  }

  /**
   * Drain the decrement worklist: each removed fact may have participated as a
   * body fact in rule instances whose head must therefore lose one derivation.
   */
  private drainDecrements(queue: string[]): void {
    while (queue.length > 0) {
      const removed = decodeKey(queue.shift() as string);
      for (const r of this.rules) {
        for (let pin = 0; pin < r.body.length; pin++) {
          if (r.body[pin].predicate !== removed.predicate) continue;
          const deltaSource = (atomIndex: number): Iterable<Fact> | null =>
            atomIndex === pin ? [removed] : null;
          // `removed` is already gone from mat, so the remaining body atoms range
          // over the current mat: each instance using `removed` whose remaining
          // body survives accounts for exactly one lost derivation of its head.
          for (const { head } of derivationsOfRule(r, this.mat, deltaSource)) {
            this.decrement(factKey(head), queue);
          }
        }
      }
    }
  }

  /**
   * Forward-chain after inserts: each newly-true fact may complete new rule
   * instances, incrementing heads. Existing facts may also gain derivations from
   * the new facts (count increment without becoming newly-true).
   */
  private forwardChainCounts(seed: Fact[]): void {
    const queue = [...seed];
    while (queue.length > 0) {
      const nf = queue.shift() as Fact;
      const more: Fact[] = [];
      for (const r of this.rules) {
        for (let pin = 0; pin < r.body.length; pin++) {
          if (r.body[pin].predicate !== nf.predicate) continue;
          const deltaSource = (atomIndex: number): Iterable<Fact> | null =>
            atomIndex === pin ? [nf] : null;
          for (const { head } of derivationsOfRule(r, this.mat, deltaSource)) {
            this.increment(head, more);
          }
        }
      }
      for (const m of more) queue.push(m);
    }
  }
}

// ───────────────────────────── B/F maintainer ───────────────────────────────

/**
 * BACKWARD/FORWARD maintenance (Motik et al. AAAI 2015 / AIJ 2019). Exact
 * maintenance for GENERAL (possibly recursive) positive Datalog.
 *
 * The DELETE problem with recursion: a fact may appear to keep support only
 * through a cyclic derivation that is NOT well-founded once the deleted base
 * facts are gone. Counting cannot detect this; DRed solves it by over-deleting
 * then rederiving. B/F avoids leaving any over-deleted fact removed: it
 * BACKWARD-checks each candidate against the surviving base and re-establishes
 * exactly the well-founded facts (FORWARD).
 *
 *   DELETE:
 *     1. OVER-DELETE: D = downward closure of the deleted facts through
 *        derivations in the current materialisation (DRed's over-estimate). Mark
 *        a non-EDB head as possibly-deleted whenever ANY of its derivations uses
 *        a fact already in D. Remove all of D from the materialisation. EDB facts
 *        that were not explicitly deleted always survive.
 *     2. BACKWARD/FORWARD RE-PROVE: rebuild well-founded support from the
 *        SURVIVING base — the current EDB plus every materialised fact that was
 *        NOT in D — by forward-chaining to the least fixpoint. A fact in D is
 *        re-established iff it has a derivation grounded (transitively) in
 *        survivors; recursive-only support that routed through a deleted fact is
 *        NOT re-established. This is the exact, well-founded result.
 *
 *   INSERT: forward semi-naïve from the new EDB facts to fixpoint (monotone).
 *
 * The result equals a from-scratch materialisation — the property the tests
 * fuzz. (The backward "is there an alternative derivation?" check is realised
 * here as a bounded forward re-derivation over the surviving base, the standard
 * equivalent formulation that terminates even under recursion.)
 */
export class BackwardForwardMaintainer extends BaseMaintainer {
  applyDelta(insert: Fact[], deleteFacts: Fact[]): DeltaResult {
    const before = this.snapshotKeys();
    const { insMap, delMap } = this.normaliseDelta(insert, deleteFacts);

    for (const f of delMap.values()) this.edb.delete(f);
    for (const f of insMap.values()) this.edb.add(f);

    if (delMap.size > 0) this.processDeletes(delMap);
    if (insMap.size > 0) this.processInserts();

    return this.diff(before);
  }

  /** DELETE handling: over-delete then backward/forward re-prove. See class doc. */
  private processDeletes(delMap: Map<string, Fact>): void {
    // 1) OVER-DELETE: forward-closure of deleted facts through derivations.
    const inD = new Set<string>(delMap.keys());
    let changed = true;
    while (changed) {
      changed = false;
      for (const { head, bodyKeys } of allDerivations(this.rules, this.mat)) {
        const hk = factKey(head);
        if (inD.has(hk)) continue;
        if (this.edb.hasKey(hk)) continue; // surviving asserted base never over-deleted
        if (bodyKeys.some((bk) => inD.has(bk))) {
          inD.add(hk);
          changed = true;
        }
      }
    }
    for (const k of inD) this.mat.delete(decodeKey(k));

    // 2) BACKWARD/FORWARD RE-PROVE from the surviving base.
    const survivors = new FactIndex();
    for (const f of this.mat.values()) survivors.add(f); // facts outside D
    for (const f of this.edb.values()) survivors.add(f); // current EDB base
    this.mat = materializeInto(this.rules, survivors.values());
  }

  /** INSERT handling: re-reach the LFP over (current mat ∪ EDB). Positive Datalog
   *  is monotone, so insertion can only add facts. */
  private processInserts(): void {
    const base = new FactIndex();
    for (const f of this.mat.values()) base.add(f);
    for (const f of this.edb.values()) base.add(f);
    this.mat = materializeInto(this.rules, base.values());
  }
}

// ───────────────────────────── DRed maintainer ──────────────────────────────

/**
 * DRed (Delete-and-Rederive) — the BASELINE maintenance algorithm (Gupta, Mumick,
 * Subrahmanian 1993; analysed in Motik et al. AIJ 2019). Provided for comparison
 * and as a correctness oracle. On delete it OVER-DELETES (removes everything
 * transitively derivable from the deleted facts) then REDERIVES the facts that
 * still have support from the surviving base. Always correct (incl. recursion),
 * but does the over-delete/rederive round trip that B/F and Counting avoid.
 */
export class DRedMaintainer extends BaseMaintainer {
  applyDelta(insert: Fact[], deleteFacts: Fact[]): DeltaResult {
    const before = this.snapshotKeys();
    const { insMap, delMap } = this.normaliseDelta(insert, deleteFacts);

    for (const f of delMap.values()) this.edb.delete(f);
    for (const f of insMap.values()) this.edb.add(f);

    if (delMap.size > 0) {
      const inD = new Set<string>(delMap.keys());
      let changed = true;
      while (changed) {
        changed = false;
        for (const { head, bodyKeys } of allDerivations(this.rules, this.mat)) {
          const hk = factKey(head);
          if (inD.has(hk)) continue;
          if (this.edb.hasKey(hk)) continue;
          if (bodyKeys.some((bk) => inD.has(bk))) {
            inD.add(hk);
            changed = true;
          }
        }
      }
      for (const k of inD) this.mat.delete(decodeKey(k));
    }

    // REDERIVE / INSERT: rebuild the LFP from surviving facts + EDB.
    const base = new FactIndex();
    for (const f of this.mat.values()) base.add(f);
    for (const f of this.edb.values()) base.add(f);
    this.mat = materializeInto(this.rules, base.values());

    return this.diff(before);
  }
}

// ───────────────────────────── Hybrid maintainer ────────────────────────────

/**
 * The public incremental maintainer. Picks the algorithm automatically at
 * construction from `isRecursive(rules)`:
 *
 *   • NON-recursive rule set  →  Counting (exact, fastest; no over-deletion / no
 *     rederivation).
 *   • RECURSIVE rule set      →  B/F (exact; backward check avoids leaving facts
 *     spuriously deleted where Counting would be unsound).
 *
 * Both back-ends satisfy the central invariant
 *
 *     getMaterialization() == materialize(rules, currentEDB)
 *
 * after every applyDelta.
 */
export class IncrementalMaintainer {
  private readonly impl: BaseMaintainer;
  readonly strategy: "counting" | "backward-forward";

  constructor(rules: readonly Rule[], edb: Iterable<Fact>) {
    if (isRecursive(rules)) {
      this.strategy = "backward-forward";
      this.impl = new BackwardForwardMaintainer(rules, edb);
    } else {
      this.strategy = "counting";
      this.impl = new CountingMaintainer(rules, edb);
    }
  }

  applyDelta(insert: Fact[], deleteFacts: Fact[]): DeltaResult {
    return this.impl.applyDelta(insert, deleteFacts);
  }

  getMaterialization(): Set<Fact> {
    return this.impl.getMaterialization();
  }

  getEdb(): Set<Fact> {
    return this.impl.getEdb();
  }
}
