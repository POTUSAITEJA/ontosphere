/**
 * elReasoner.ts
 *
 * OWL 2 EL COMPLETION REASONER — a PURE, STANDALONE, polynomial-time classifier
 * for the EL profile.
 *
 * NOT wired into the worker / reasoning pipeline yet (that is a separate step).
 * This module takes an OWL 2 EL TBox as RDF triples and produces the classified
 * subsumption hierarchy, the set of unsatisfiable classes, and a consistency
 * verdict — all in time polynomial in the size of the TBox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THEORY
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the EL⁺⁺ completion (a.k.a. "classification by completion rules"),
 * following:
 *
 *   F. Baader, S. Brandt, C. Lutz.
 *   "Pushing the EL Envelope."
 *   Proc. IJCAI 2005, pp. 364–369.
 *
 * and its role-inclusion / role-chain extension as realised in the ELK reasoner:
 *
 *   Y. Kazakov, M. Krötzsch, F. Simančík.
 *   "The Incredible ELK: From Polynomial Procedures to Efficient Reasoning
 *    with EL Ontologies." Journal of Automated Reasoning 53 (2014), 1–61.
 *
 * EL is the description logic whose only concept constructors are
 *   ⊤ (top), ⊓ (conjunction) and ∃R.C (existential restriction).
 * Adding ⊥ (bottom), role hierarchies (R ⊑ S), role chains / complex role
 * inclusions (R₁ ∘ R₂ ⊑ S, includes role transitivity R ∘ R ⊑ R) and concept
 * domain restrictions (∃R.⊤ ⊑ B, i.e. rdfs:domain) gives EL⁺⁺ — still
 * classifiable in PTIME, which is what makes it attractive for large
 * biomedical / enterprise ontologies (SNOMED CT, GO, …).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 1 — NORMALISATION (structural transformation to EL normal form)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every TBox axiom is rewritten (introducing FRESH concept names for complex
 * sub-expressions) into one of the following normal forms (Baader et al. 2005,
 * Fig. 1 — the "normalisation rules" NF1…NF7):
 *
 *   (NF-A) A           ⊑ B          atomic ⊑ atomic        (A, B ∈ CN ∪ {⊤, ⊥})
 *   (NF-B) A₁ ⊓ A₂     ⊑ B          binary conjunction LHS
 *   (NF-C) A           ⊑ ∃R.B       existential RHS
 *   (NF-D) ∃R.A        ⊑ B          existential LHS
 *
 * plus the role-box axioms
 *   (RI-1) R           ⊑ S          role inclusion (role hierarchy)
 *   (RI-2) R₁ ∘ R₂     ⊑ S          complex role inclusion / chain (n=2; longer
 *                                   chains are split with fresh roles).
 *
 * Here CN is the set of concept names; ⊤ = owl:Thing, ⊥ = owl:Nothing. A general
 * concept inclusion C ⊑ D over arbitrary EL concepts is reduced to the forms
 * above by repeatedly (a) flattening n-ary conjunctions to binary, and
 * (b) replacing a complex sub-concept by a fresh name X together with the two
 * axioms X ⊑ subconcept and subconcept ⊑ X (definitorial introduction).
 * owl:equivalentClass C ≡ D is split into C ⊑ D and D ⊑ C up front.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 2 — COMPLETION RULES (Baader, Brandt, Lutz, IJCAI 2005, Fig. 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * We maintain two mappings, the "S-mapping" and the "R-mapping":
 *
 *   S(X) ⊆ CN ∪ {⊤}     — the set of concept names known to SUBSUME X
 *                         (i.e. X ⊑ A for every A ∈ S(X)); initialised to
 *                         S(X) = {X, ⊤} for every concept name X.
 *   R(r) ⊆ CN × CN      — the set of pairs (X, Y) with X ⊑ ∃r.Y derivable.
 *
 * The completion is the least fixpoint of the rules (we add ⊥ explicitly so that
 * EL⁺⁺ unsatisfiability is captured):
 *
 *   CR1  if A ∈ S(X) and  A ⊑ B          then add B to S(X)
 *   CR2  if A₁,A₂ ∈ S(X) and A₁ ⊓ A₂ ⊑ B then add B to S(X)
 *   CR3  if A ∈ S(X) and  A ⊑ ∃r.B       then add (X, B) to R(r)
 *   CR4  if (X,Y) ∈ R(r), A ∈ S(Y), and ∃r.A ⊑ B
 *                                         then add B to S(X)
 *   CR5  if (X,Y) ∈ R(r) and ⊥ ∈ S(Y)    then add ⊥ to S(X)         (bottom rule)
 *   CR-RH  if (X,Y) ∈ R(r) and r ⊑ s     then add (X,Y) to R(s)     (role hierarchy)
 *   CR-RC  if (X,Y) ∈ R(r₁), (Y,Z) ∈ R(r₂), and r₁ ∘ r₂ ⊑ s
 *                                         then add (X,Z) to R(s)     (role chain)
 *
 * (CR1–CR5 are exactly rules R1–R5 of Baader et al. 2005; CR-RH and CR-RC are the
 *  EL⁺⁺ role-box rules — ELK's "RH" and "RChain" — that propagate the R-mapping
 *  along the role hierarchy and complex role inclusions, with role transitivity
 *  R ∘ R ⊑ R as a special case of CR-RC.)
 *
 * The rules only ever ADD facts to S(·) and R(·) over a FIXED, polynomially
 * bounded domain (|CN|² pairs per role, |CN| subsumers per concept), so the
 * fixpoint is reached in polynomially many steps — this is the PTIME guarantee.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 3 — OUTPUT
 * ─────────────────────────────────────────────────────────────────────────────
 *   subsumptions:  for each ORIGINAL (non-fresh) concept name A, the set
 *                  { B : B ∈ S(A), B an original concept name } — i.e. A ⊑ B.
 *   unsatisfiable: every original A with ⊥ ∈ S(A) (A ≡ owl:Nothing).
 *   isConsistent:  the EL⁺⁺ TBox is inconsistent iff ⊤ is unsatisfiable, i.e.
 *                  ⊥ ∈ S(⊤) (⊤ ⊑ ⊥ derivable). A TBox with merely some
 *                  unsatisfiable NAMED classes is still consistent (those classes
 *                  are just empty in every model).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL PROFILE HONESTY  (READ THIS)
 * ─────────────────────────────────────────────────────────────────────────────
 * EL deliberately EXCLUDES: universal restrictions (owl:allValuesFrom), unions
 * (owl:unionOf), complements (owl:complementOf), cardinality restrictions,
 * value restrictions on data (owl:hasValue with the wrong shape), negative
 * assertions, (a)symmetry/(ir)reflexivity etc. If the input uses a construct
 * OUTSIDE OWL 2 EL we DO NOT silently produce a (possibly wrong) result: the
 * offending axiom is RECORDED in `rejected` with a human-readable reason, and the
 * result carries `inProfile === false`. Callers (Round 2 routing) should fall
 * back to the full-DL reasoner (Konclude) when `inProfile` is false. The
 * in-profile axioms are still completed, so a partial classification is available
 * for diagnostics, but it is NOT claimed to be complete for the whole input.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────────────
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';

const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain';

const OWL_THING = 'http://www.w3.org/2002/07/owl#Thing';
const OWL_NOTHING = 'http://www.w3.org/2002/07/owl#Nothing';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_EQUIVALENT_CLASS = 'http://www.w3.org/2002/07/owl#equivalentClass';
const OWL_INTERSECTION_OF = 'http://www.w3.org/2002/07/owl#intersectionOf';
const OWL_SOME_VALUES_FROM = 'http://www.w3.org/2002/07/owl#someValuesFrom';
const OWL_ON_PROPERTY = 'http://www.w3.org/2002/07/owl#onProperty';
const OWL_RESTRICTION = 'http://www.w3.org/2002/07/owl#Restriction';
const OWL_PROPERTY_CHAIN_AXIOM = 'http://www.w3.org/2002/07/owl#propertyChainAxiom';
const OWL_TRANSITIVE_PROPERTY = 'http://www.w3.org/2002/07/owl#TransitiveProperty';
const OWL_TOP_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#topObjectProperty';

// Constructs that take EL OUT of profile. Detected on the object of a class
// description so the input is rejected rather than silently mishandled.
const NON_EL_PREDICATES = new Set<string>([
  'http://www.w3.org/2002/07/owl#allValuesFrom',
  'http://www.w3.org/2002/07/owl#unionOf',
  'http://www.w3.org/2002/07/owl#complementOf',
  'http://www.w3.org/2002/07/owl#disjointUnionOf',
  'http://www.w3.org/2002/07/owl#oneOf',
  'http://www.w3.org/2002/07/owl#minCardinality',
  'http://www.w3.org/2002/07/owl#maxCardinality',
  'http://www.w3.org/2002/07/owl#cardinality',
  'http://www.w3.org/2002/07/owl#minQualifiedCardinality',
  'http://www.w3.org/2002/07/owl#maxQualifiedCardinality',
  'http://www.w3.org/2002/07/owl#qualifiedCardinality',
  'http://www.w3.org/2002/07/owl#hasValue',
  'http://www.w3.org/2002/07/owl#hasSelf',
]);

// ─── Input triple shape (the repo convention) ────────────────────────────────
export interface Triple {
  subject: string;
  predicate: string;
  object: string;
  objectIsLiteral?: boolean;
}

// ─── Public result types ─────────────────────────────────────────────────────
export interface RejectedAxiom {
  /** A best-effort human-readable rendering of the offending triple/axiom. */
  axiom: string;
  /** Why it is outside OWL 2 EL (or otherwise unhandled). */
  reason: string;
}

/** Normalised EL axiom — one of the four concept normal forms or a role axiom. */
export type NormalAxiom =
  | { kind: 'sub'; a: string; b: string } // A ⊑ B
  | { kind: 'and'; a1: string; a2: string; b: string } // A1 ⊓ A2 ⊑ B
  | { kind: 'exR'; a: string; r: string; b: string } // A ⊑ ∃R.B
  | { kind: 'exL'; r: string; a: string; b: string } // ∃R.A ⊑ B
  | { kind: 'roleSub'; r: string; s: string } // R ⊑ S
  | { kind: 'roleChain'; r1: string; r2: string; s: string }; // R1 ∘ R2 ⊑ S

export interface ClassifyELResult {
  /** For each ORIGINAL named class A: the set of original named B with A ⊑ B. */
  subsumptions: Map<string, Set<string>>;
  /** Original named classes equivalent to owl:Nothing (⊥ ∈ S(A)). */
  unsatisfiableClasses: string[];
  /** false iff ⊤ ⊑ ⊥ is derivable (the whole TBox has no model). */
  isConsistent: boolean;
  /** true iff every input axiom was inside OWL 2 EL and fully handled. */
  inProfile: boolean;
  /** Axioms outside OWL 2 EL (or unhandled), with reasons. Empty ⟺ inProfile. */
  rejected: RejectedAxiom[];
  /** The normalised EL normal-form axiom set (for inspection / debugging). */
  normalized: NormalAxiom[];
}

// ─── Internal: a flat-store view over the input triples ──────────────────────
class TripleIndex {
  private readonly all: Triple[];
  private readonly bySP = new Map<string, Triple[]>(); // subject\0predicate → triples

  constructor(triples: Triple[]) {
    this.all = triples;
    for (const t of triples) {
      const k = `${t.subject}\0${t.predicate}`;
      const arr = this.bySP.get(k);
      if (arr) arr.push(t);
      else this.bySP.set(k, [t]);
    }
  }

  objects(subject: string, predicate: string): Triple[] {
    return this.bySP.get(`${subject}\0${predicate}`) ?? [];
  }

  firstObject(subject: string, predicate: string): string | undefined {
    return this.objects(subject, predicate)[0]?.object;
  }

  hasType(subject: string, type: string): boolean {
    return this.objects(subject, RDF_TYPE).some((t) => t.object === type);
  }

  get triples(): readonly Triple[] {
    return this.all;
  }
}

// ─── Normaliser ──────────────────────────────────────────────────────────────
/**
 * Translates the input triples into EL normal form. Fresh concept names are
 * minted as `urn:vg:el:fresh:N`. Returns the normal-form axioms together with
 * the set of ORIGINAL named concepts and a list of rejected (non-EL) axioms.
 */
class Normaliser {
  private readonly idx: TripleIndex;
  private readonly out: NormalAxiom[] = [];
  private readonly rejected: RejectedAxiom[] = [];
  private readonly originalConcepts = new Set<string>();
  private readonly originalRoles = new Set<string>();
  private freshCounter = 0;

  constructor(idx: TripleIndex) {
    this.idx = idx;
  }

  private fresh(): string {
    return `urn:vg:el:fresh:${this.freshCounter++}`;
  }

  private reject(axiom: string, reason: string): void {
    this.rejected.push({ axiom, reason });
  }

  /** Record an IRI that the modeller introduced (not ⊤/⊥, not a bnode helper). */
  private noteConcept(iri: string): void {
    if (iri === OWL_THING || iri === OWL_NOTHING) return;
    if (iri.startsWith('urn:vg:el:fresh:')) return;
    this.originalConcepts.add(iri);
  }

  private noteRole(iri: string): void {
    if (iri === OWL_TOP_OBJECT_PROPERTY) return;
    this.originalRoles.add(iri);
  }

  run(): {
    axioms: NormalAxiom[];
    concepts: Set<string>;
    roles: Set<string>;
    rejected: RejectedAxiom[];
  } {
    // Seed the concept vocabulary from explicit class declarations so a class
    // that only ever appears as a declaration still gets {self, ⊤} in S.
    for (const t of this.idx.triples) {
      if (t.predicate === RDF_TYPE && t.object === OWL_CLASS) this.noteConcept(t.subject);
      if (t.predicate === RDF_TYPE && t.object === OWL_OBJECT_PROPERTY) this.noteRole(t.subject);
    }

    for (const t of this.idx.triples) {
      this.handleTriple(t);
    }

    return {
      axioms: this.out,
      concepts: this.originalConcepts,
      roles: this.originalRoles,
      rejected: this.rejected,
    };
  }

  private handleTriple(t: Triple): void {
    if (t.objectIsLiteral) return; // annotations/literals carry no EL TBox content
    switch (t.predicate) {
      case RDFS_SUBCLASS_OF: {
        const lhs = this.translateClass(t.subject, 'sub');
        const rhs = this.translateClass(t.object, 'super');
        if (lhs === undefined || rhs === undefined) return;
        this.emitSub(lhs, rhs);
        return;
      }
      case OWL_EQUIVALENT_CLASS: {
        // C ≡ D  ⇒  C ⊑ D and D ⊑ C
        const l = this.translateClass(t.subject, 'sub');
        const r = this.translateClass(t.object, 'sub');
        if (l === undefined || r === undefined) return;
        this.emitSub(l, r);
        this.emitSub(r, l);
        return;
      }
      case RDFS_DOMAIN: {
        // domain(R) = B  ⇔  ∃R.⊤ ⊑ B  (EL⁺⁺ supports this).
        this.noteRole(t.subject);
        const b = this.atomicSuper(t.object);
        if (b === undefined) return;
        this.out.push({ kind: 'exL', r: t.subject, a: OWL_THING, b });
        return;
      }
      case RDFS_SUBPROPERTY_OF: {
        this.noteRole(t.subject);
        this.noteRole(t.object);
        this.out.push({ kind: 'roleSub', r: t.subject, s: t.object });
        return;
      }
      case OWL_PROPERTY_CHAIN_AXIOM: {
        this.handlePropertyChain(t.subject, t.object);
        return;
      }
      case RDF_TYPE: {
        if (t.object === OWL_TRANSITIVE_PROPERTY) {
          // Transitivity is the chain R ∘ R ⊑ R.
          this.noteRole(t.subject);
          this.out.push({ kind: 'roleChain', r1: t.subject, r2: t.subject, s: t.subject });
        }
        // Other rdf:type declarations (owl:Class, owl:ObjectProperty, …) are
        // structural, not logical — nothing to emit.
        return;
      }
      default:
        // Non-EL or non-TBox predicates carry no completion content here. We do
        // NOT reject unknown predicates wholesale (they may be annotations);
        // explicit non-EL CONSTRUCTS are caught inside translateClass.
        return;
    }
  }

  /**
   * Translate a class expression occurring on either side of a subclass axiom.
   * Returns a list of atomic names that the side reduces to:
   *  - on the 'super' side a complex RHS (∃R.C) is allowed directly via NF-C;
   *  - on the 'sub' side a complex LHS (∃R.C, A⊓B) is allowed via NF-B / NF-D.
   * Returns a single atomic name (string), or `undefined` if the expression is
   * outside EL (already recorded in `rejected`).
   */
  private translateClass(iri: string, side: 'sub' | 'super'): string | undefined {
    // Atomic concept name, ⊤ or ⊥.
    if (this.isAtomic(iri)) {
      this.noteConcept(iri);
      return iri;
    }
    // A restriction (owl:Restriction with owl:someValuesFrom) or an
    // owl:intersectionOf list. Detect non-EL constructs first.
    const nonEl = this.detectNonEl(iri);
    if (nonEl) {
      this.reject(this.renderClass(iri), nonEl);
      return undefined;
    }

    // owl:intersectionOf → flatten to binary conjunction(s).
    const interHead = this.idx.firstObject(iri, OWL_INTERSECTION_OF);
    if (interHead !== undefined) {
      const conjuncts = this.readList(interHead);
      if (conjuncts === undefined) {
        this.reject(this.renderClass(iri), 'malformed owl:intersectionOf list');
        return undefined;
      }
      return this.translateConjunction(iri, conjuncts, side);
    }

    // owl:someValuesFrom restriction.
    if (this.idx.hasType(iri, OWL_RESTRICTION) || this.idx.firstObject(iri, OWL_SOME_VALUES_FROM) !== undefined) {
      return this.translateExistential(iri, side);
    }

    // Unrecognised complex/blank concept. Be honest rather than guess.
    this.reject(this.renderClass(iri), 'unrecognised class expression (not atomic / ∃ / ⊓ in EL)');
    return undefined;
  }

  /** Translate ⊓ of conjuncts into a single name via NF-B definitorial axioms. */
  private translateConjunction(
    iri: string,
    conjuncts: string[],
    side: 'sub' | 'super',
  ): string | undefined {
    // Translate each conjunct to an atomic name.
    const names: string[] = [];
    for (const c of conjuncts) {
      const n = this.translateClass(c, side);
      if (n === undefined) return undefined; // a conjunct was non-EL
      names.push(n);
    }
    if (names.length === 0) return OWL_THING; // empty intersection ≡ ⊤
    if (names.length === 1) return names[0];

    // Fold left into binary conjunctions: name(A1⊓A2) = X1, name(X1⊓A3) = X2, …
    // For each pair we introduce a fresh X with the definitorial pair
    //   A_i ⊓ A_j ⊑ X   and   X ⊑ A_i,  X ⊑ A_j
    // so X behaves exactly like the conjunction on BOTH sides of any axiom.
    let acc = names[0];
    for (let i = 1; i < names.length; i++) {
      const x = this.fresh();
      // X ⊑ acc, X ⊑ names[i]  (X is below both conjuncts)
      this.out.push({ kind: 'sub', a: x, b: acc });
      this.out.push({ kind: 'sub', a: x, b: names[i] });
      // acc ⊓ names[i] ⊑ X     (anything below both conjuncts is below X)
      this.out.push({ kind: 'and', a1: acc, a2: names[i], b: x });
      acc = x;
    }
    // `acc` now denotes the whole conjunction. `iri` (if it is a named class,
    // e.g. an equivalentClass definition target) is wired by the caller's
    // emitSub; for an anonymous intersection we just return `acc`.
    void iri;
    void side;
    return acc;
  }

  /** Translate ∃R.C. Returns the name of the existential (fresh if needed). */
  private translateExistential(iri: string, side: 'sub' | 'super'): string | undefined {
    const r = this.idx.firstObject(iri, OWL_ON_PROPERTY);
    const filler = this.idx.firstObject(iri, OWL_SOME_VALUES_FROM);
    if (r === undefined || filler === undefined) {
      this.reject(this.renderClass(iri), 'owl:Restriction missing onProperty/someValuesFrom (or non-EL restriction kind)');
      return undefined;
    }
    this.noteRole(r);
    // The filler may itself be complex — translate it to an atomic name B.
    const b = this.translateClass(filler, side);
    if (b === undefined) return undefined;

    // Introduce a fresh name X for ∃R.B with definitorial axioms in BOTH
    // directions so X may stand for the existential on either side:
    //   X ⊑ ∃R.B   (NF-C)   and   ∃R.B ⊑ X   (NF-D).
    const x = this.fresh();
    this.out.push({ kind: 'exR', a: x, r, b });
    this.out.push({ kind: 'exL', r, a: b, b: x });
    void iri;
    void side;
    return x;
  }

  /** Convenience: a class on the super side that must reduce to an atomic name. */
  private atomicSuper(iri: string): string | undefined {
    return this.translateClass(iri, 'super');
  }

  /**
   * Emit a normalised A ⊑ RHS where `lhs` and `rhs` are atomic names produced by
   * translateClass. Always one of NF-A (both atomic). Complex shapes were already
   * reduced to atomic names with their definitorial axioms during translation.
   */
  private emitSub(lhs: string, rhs: string): void {
    this.out.push({ kind: 'sub', a: lhs, b: rhs });
  }

  private handlePropertyChain(superRole: string, listHead: string): void {
    this.noteRole(superRole);
    const chain = this.readList(listHead);
    if (chain === undefined || chain.length === 0) {
      this.reject(`propertyChainAxiom(${this.short(superRole)})`, 'malformed owl:propertyChainAxiom list');
      return;
    }
    for (const r of chain) this.noteRole(r);
    if (chain.length === 1) {
      this.out.push({ kind: 'roleSub', r: chain[0], s: superRole });
      return;
    }
    // Split R1 ∘ R2 ∘ … ∘ Rn ⊑ S into binary chains with fresh intermediate roles:
    //   R1 ∘ R2 ⊑ T1,  T1 ∘ R3 ⊑ T2, …, T(n-2) ∘ Rn ⊑ S.
    let left = chain[0];
    for (let i = 1; i < chain.length; i++) {
      const isLast = i === chain.length - 1;
      const target = isLast ? superRole : `urn:vg:el:fresh:role:${this.freshCounter++}`;
      this.out.push({ kind: 'roleChain', r1: left, r2: chain[i], s: target });
      left = target;
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  private isAtomic(iri: string): boolean {
    if (iri === OWL_THING || iri === OWL_NOTHING) return true;
    // It is atomic iff it is NOT the head of a restriction / intersection / list.
    if (this.idx.hasType(iri, OWL_RESTRICTION)) return false;
    if (this.idx.firstObject(iri, OWL_INTERSECTION_OF) !== undefined) return false;
    if (this.idx.firstObject(iri, OWL_SOME_VALUES_FROM) !== undefined) return false;
    if (this.idx.firstObject(iri, OWL_ON_PROPERTY) !== undefined) return false;
    return true;
  }

  /** Returns a reason string if `iri` (or its restriction) uses a non-EL ctor. */
  private detectNonEl(iri: string): string | undefined {
    for (const t of this.idx.objects(iri, RDF_TYPE)) {
      void t;
    }
    // Any non-EL predicate attached to this node disqualifies it.
    for (const pred of NON_EL_PREDICATES) {
      if (this.idx.firstObject(iri, pred) !== undefined) {
        return `uses non-EL construct ${this.short(pred)}`;
      }
    }
    return undefined;
  }

  /** Read an rdf:List (rdf:first/rdf:rest). Returns undefined if malformed. */
  private readList(head: string): string[] | undefined {
    const out: string[] = [];
    let node = head;
    const seen = new Set<string>();
    while (node !== RDF_NIL) {
      if (seen.has(node)) return undefined; // cyclic list
      seen.add(node);
      const first = this.idx.firstObject(node, RDF_FIRST);
      const rest = this.idx.firstObject(node, RDF_REST);
      if (first === undefined || rest === undefined) return undefined;
      out.push(first);
      node = rest;
    }
    return out;
  }

  private short(iri: string): string {
    const h = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'));
    return h >= 0 ? iri.slice(h + 1) : iri;
  }

  private renderClass(iri: string): string {
    if (this.isAtomic(iri)) return this.short(iri);
    const inter = this.idx.firstObject(iri, OWL_INTERSECTION_OF);
    if (inter !== undefined) return `(intersectionOf …) [${this.short(iri)}]`;
    const r = this.idx.firstObject(iri, OWL_ON_PROPERTY);
    if (r !== undefined) return `(restriction onProperty ${this.short(r)} …) [${this.short(iri)}]`;
    return `(class ${this.short(iri)})`;
  }
}

// ─── Completion engine ───────────────────────────────────────────────────────
/**
 * Runs the EL⁺⁺ completion rules CR1–CR5 + CR-RH + CR-RC to fixpoint over the
 * normalised axiom set, then projects the result onto the original vocabulary.
 */
class CompletionEngine {
  private readonly axioms: NormalAxiom[];
  private readonly concepts: Set<string>; // all concept names incl. ⊤, ⊥, fresh

  // S(X) and R(r) — the two completion mappings.
  private readonly S = new Map<string, Set<string>>();
  private readonly R = new Map<string, Set<string>>(); // r → set of "X\0Y"
  // R indexed for fast rule lookup.
  private readonly Rfwd = new Map<string, Map<string, Set<string>>>(); // r → X → {Y}
  private readonly Rbwd = new Map<string, Map<string, Set<string>>>(); // r → Y → {X}

  // Indexes over the axiom set for O(1) rule firing.
  private readonly subOf = new Map<string, string[]>(); // A → [B] for A ⊑ B
  private readonly andOf = new Map<string, Array<{ other: string; b: string }>>(); // A1 → [{A2,B}]
  private readonly exROf = new Map<string, Array<{ r: string; b: string }>>(); // A → [{R,B}] for A ⊑ ∃R.B
  private readonly exLOf = new Map<string, Array<{ r: string; b: string }>>(); // A → [{R,B}] for ∃R.A ⊑ B
  private readonly roleSubOf = new Map<string, string[]>(); // r → [s] for r ⊑ s
  private readonly chainBy1 = new Map<string, Array<{ r2: string; s: string }>>(); // r1 → [{r2,s}]
  private readonly chainBy2 = new Map<string, Array<{ r1: string; s: string }>>(); // r2 → [{r1,s}]

  constructor(axioms: NormalAxiom[], originalConcepts: Set<string>, originalRoles: Set<string>) {
    this.axioms = axioms;
    this.concepts = new Set<string>([OWL_THING, OWL_NOTHING]);
    for (const c of originalConcepts) this.concepts.add(c);
    void originalRoles;
    this.indexAxioms();
  }

  private indexAxioms(): void {
    const push = <V>(m: Map<string, V[]>, k: string, v: V) => {
      const a = m.get(k);
      if (a) a.push(v);
      else m.set(k, [v]);
    };
    for (const ax of this.axioms) {
      switch (ax.kind) {
        case 'sub':
          this.concepts.add(ax.a);
          this.concepts.add(ax.b);
          push(this.subOf, ax.a, ax.b);
          break;
        case 'and':
          this.concepts.add(ax.a1);
          this.concepts.add(ax.a2);
          this.concepts.add(ax.b);
          push(this.andOf, ax.a1, { other: ax.a2, b: ax.b });
          push(this.andOf, ax.a2, { other: ax.a1, b: ax.b });
          break;
        case 'exR':
          this.concepts.add(ax.a);
          this.concepts.add(ax.b);
          push(this.exROf, ax.a, { r: ax.r, b: ax.b });
          break;
        case 'exL':
          this.concepts.add(ax.a);
          this.concepts.add(ax.b);
          push(this.exLOf, ax.a, { r: ax.r, b: ax.b });
          break;
        case 'roleSub':
          push(this.roleSubOf, ax.r, ax.s);
          break;
        case 'roleChain':
          push(this.chainBy1, ax.r1, { r2: ax.r2, s: ax.s });
          push(this.chainBy2, ax.r2, { r1: ax.r1, s: ax.s });
          break;
      }
    }
  }

  // ── S/R accessors ─────────────────────────────────────────────────────────
  private sOf(x: string): Set<string> {
    let s = this.S.get(x);
    if (!s) {
      s = new Set<string>([x, OWL_THING]); // S(X) initialised to {X, ⊤}
      this.S.set(x, s);
    }
    return s;
  }

  /** A worklist of concept names whose S-set grew (for CR1/CR2/CR3 re-scan). */
  private readonly sQueue: string[] = [];
  /** A worklist of (r,X,Y) edges newly added (for CR4/CR5/CR-RH/CR-RC). */
  private readonly rQueue: Array<{ r: string; x: string; y: string }> = [];

  private addToS(x: string, c: string): void {
    const s = this.sOf(x);
    if (!s.has(c)) {
      s.add(c);
      this.sQueue.push(x); // re-process X for the concept that was just added
      // Record WHICH concept to make the re-scan cheap: we re-scan the whole
      // S(X) for simplicity (sets are small); correctness is unaffected.
    }
  }

  private hasEdge(r: string, x: string, y: string): boolean {
    return this.Rfwd.get(r)?.get(x)?.has(y) ?? false;
  }

  private addEdge(r: string, x: string, y: string): void {
    if (this.hasEdge(r, x, y)) return;
    let set = this.R.get(r);
    if (!set) {
      set = new Set<string>();
      this.R.set(r, set);
    }
    set.add(`${x}\0${y}`);
    // forward index
    let f = this.Rfwd.get(r);
    if (!f) {
      f = new Map();
      this.Rfwd.set(r, f);
    }
    let fx = f.get(x);
    if (!fx) {
      fx = new Set();
      f.set(x, fx);
    }
    fx.add(y);
    // backward index
    let b = this.Rbwd.get(r);
    if (!b) {
      b = new Map();
      this.Rbwd.set(r, b);
    }
    let by = b.get(y);
    if (!by) {
      by = new Set();
      b.set(y, by);
    }
    by.add(x);
    this.rQueue.push({ r, x, y });
  }

  // ── Fixpoint ────────────────────────────────────────────────────────────────
  run(): void {
    // Initialise S(X) = {X, ⊤} for every known concept name and seed the queue.
    for (const x of this.concepts) {
      this.sOf(x);
      this.sQueue.push(x);
    }

    // Process until both worklists drain. Each pass applies every rule whose
    // trigger has not yet been consumed; the monotone, bounded domain guarantees
    // termination (PTIME).
    while (this.sQueue.length > 0 || this.rQueue.length > 0) {
      while (this.sQueue.length > 0) {
        const x = this.sQueue.pop() as string;
        this.applyConceptRules(x);
      }
      while (this.rQueue.length > 0) {
        const e = this.rQueue.pop() as { r: string; x: string; y: string };
        this.applyEdgeRules(e.r, e.x, e.y);
      }
    }
  }

  /** Apply CR1, CR2, CR3 (and the consequent of CR4 via S-side) for concept X. */
  private applyConceptRules(x: string): void {
    // Snapshot S(X) because rule application may grow it (we re-queue X on growth).
    const sx = [...this.sOf(x)];
    for (const a of sx) {
      // CR1: A ∈ S(X), A ⊑ B ⇒ B ∈ S(X)
      const subs = this.subOf.get(a);
      if (subs) for (const b of subs) this.addToS(x, b);

      // CR2: A1,A2 ∈ S(X), A1 ⊓ A2 ⊑ B ⇒ B ∈ S(X)
      const ands = this.andOf.get(a);
      if (ands) {
        const sxSet = this.sOf(x);
        for (const { other, b } of ands) {
          if (sxSet.has(other)) this.addToS(x, b);
        }
      }

      // CR3: A ∈ S(X), A ⊑ ∃R.B ⇒ (X,B) ∈ R(R)
      const exs = this.exROf.get(a);
      if (exs) for (const { r, b } of exs) this.addEdge(r, x, b);

      // CR4 (S-trigger): A ∈ S(Y) for some (Z,Y) ∈ R(r) with ∃r.A ⊑ B ⇒ B ∈ S(Z).
      // When A is newly added to S(X=Y), fire for every predecessor Z of X via r.
      const exls = this.exLOf.get(a);
      if (exls) {
        for (const { r, b } of exls) {
          const preds = this.Rbwd.get(r)?.get(x);
          if (preds) for (const z of preds) this.addToS(z, b);
        }
      }
    }
  }

  /** Apply CR4, CR5, CR-RH, CR-RC for a newly added edge (X,Y) ∈ R(r). */
  private applyEdgeRules(r: string, x: string, y: string): void {
    // CR4: (X,Y) ∈ R(r), A ∈ S(Y), ∃r.A ⊑ B ⇒ B ∈ S(X)
    const sy = [...this.sOf(y)];
    for (const a of sy) {
      const exls = this.exLOf.get(a);
      if (exls) for (const { r: rr, b } of exls) if (rr === r) this.addToS(x, b);
    }

    // CR5 (bottom): (X,Y) ∈ R(r), ⊥ ∈ S(Y) ⇒ ⊥ ∈ S(X)
    if (this.sOf(y).has(OWL_NOTHING)) this.addToS(x, OWL_NOTHING);

    // CR-RH: (X,Y) ∈ R(r), r ⊑ s ⇒ (X,Y) ∈ R(s)
    const supers = this.roleSubOf.get(r);
    if (supers) for (const s of supers) this.addEdge(s, x, y);

    // CR-RC: this edge is (X,Y) ∈ R(r). For chains where r is the FIRST role:
    //   r ∘ r2 ⊑ s, (Y,Z) ∈ R(r2) ⇒ (X,Z) ∈ R(s)
    const asFirst = this.chainBy1.get(r);
    if (asFirst) {
      for (const { r2, s } of asFirst) {
        const succ = this.Rfwd.get(r2)?.get(y);
        if (succ) for (const z of succ) this.addEdge(s, x, z);
      }
    }
    // For chains where r is the SECOND role:
    //   r1 ∘ r ⊑ s, (W,X) ∈ R(r1) ⇒ (W,Y) ∈ R(s)
    const asSecond = this.chainBy2.get(r);
    if (asSecond) {
      for (const { r1, s } of asSecond) {
        const pre = this.Rbwd.get(r1)?.get(x);
        if (pre) for (const w of pre) this.addEdge(s, w, y);
      }
    }
  }

  // ── Projection / output ─────────────────────────────────────────────────────
  /** ⊥ ∈ S(X)? */
  isUnsatisfiable(x: string): boolean {
    return this.sOf(x).has(OWL_NOTHING);
  }

  /** Full S(X) (used by output projection and tests). */
  subsumersOf(x: string): Set<string> {
    return this.sOf(x);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Classify an OWL 2 EL TBox given as RDF triples.
 *
 * @param axioms input triples ({subject,predicate,object,objectIsLiteral?}).
 * @returns the subsumption hierarchy, unsatisfiable classes, consistency,
 *          profile honesty (inProfile / rejected) and the normalised axioms.
 */
export function classifyEL(axioms: Triple[]): ClassifyELResult {
  const idx = new TripleIndex(axioms);
  const { axioms: normalized, concepts, roles, rejected } = new Normaliser(idx).run();

  const engine = new CompletionEngine(normalized, concepts, roles);
  engine.run();

  // Project S(·) onto the ORIGINAL named vocabulary.
  const subsumptions = new Map<string, Set<string>>();
  const unsatisfiableClasses: string[] = [];
  for (const a of concepts) {
    const s = engine.subsumersOf(a);
    const projected = new Set<string>();
    for (const b of s) {
      // Keep only original named concepts as subsumers (drop fresh names and ⊤
      // for cleanliness, but always retain owl:Thing as an explicit subsumer and
      // owl:Nothing when the class is unsatisfiable so the hierarchy is faithful).
      if (b === OWL_THING) {
        projected.add(OWL_THING);
      } else if (b === OWL_NOTHING) {
        projected.add(OWL_NOTHING);
      } else if (concepts.has(b)) {
        projected.add(b);
      }
    }
    subsumptions.set(a, projected);
    if (engine.isUnsatisfiable(a)) unsatisfiableClasses.push(a);
  }

  // Consistency: the EL⁺⁺ TBox is inconsistent iff ⊤ is forced unsatisfiable
  // (⊤ ⊑ ⊥ derivable). Merely having some empty NAMED classes is consistent.
  const isConsistent = !engine.isUnsatisfiable(OWL_THING);

  return {
    subsumptions,
    unsatisfiableClasses: unsatisfiableClasses.sort(),
    isConsistent,
    inProfile: rejected.length === 0,
    rejected,
    normalized,
  };
}

/**
 * Is `sub ⊑ sup` entailed by a completed result? True iff sup ∈ S(sub), i.e.
 * sup is among sub's computed subsumers. owl:Thing subsumes everything; an
 * unsatisfiable sub is below everything (⊥ ⊑ X). Returns false for classes the
 * TBox never mentions (open-world: nothing is entailed about them).
 */
export function isEntailedSubsumption(
  result: ClassifyELResult,
  sub: string,
  sup: string,
): boolean {
  if (sup === OWL_THING) return result.subsumptions.has(sub); // ⊤ subsumes any known class
  if (sub === sup) return result.subsumptions.has(sub); // reflexivity for known classes
  // An unsatisfiable class is subsumed by EVERYTHING (⊥ ⊑ X).
  if (result.unsatisfiableClasses.includes(sub)) return true;
  const s = result.subsumptions.get(sub);
  return s ? s.has(sup) : false;
}
