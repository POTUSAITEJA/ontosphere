#!/usr/bin/env node
// scripts/bench-reasoning.mjs
//
// MODULE-SIZE-vs-ONTOLOGY-SIZE microbenchmark — the empirical evidence for the
// paper's INCREMENTAL-reasoning claim: a syntactic-locality star-module extracted
// for a SMALL edit signature is far smaller than the full ontology, and extraction
// is fast and sub-linear in the part of the ontology it must touch.
//
// For a few synthetic ontologies of growing size (chains and stars of N classes)
// this script measures, for a SMALL fixed edit signature:
//   (a) the size of the extracted ⊤⊥* star-module vs the full ontology axiom count,
//   (b) extraction wall-clock — the MEDIAN over >= 20 timed runs after a warmup.
//
// It imports ONLY the pure extractor (extractStarModule / signatureOf) from
// localityModule.ts and uses Node built-ins exclusively (no deps, no Konclude/WASM).
// Results are printed to stdout as a small markdown table; pipe/tee to logs/ to keep
// a copy, e.g.:
//
//     node scripts/bench-reasoning.mjs 2>&1 | tee logs/bench-reasoning.log
//
// Run requirements: Node with native TypeScript type-stripping (Node >= 22.6 with
// --experimental-strip-types, on by default in Node >= 23). localityModule.ts uses
// explicit .ts import specifiers, which the type-stripping loader resolves.

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

// Resolve localityModule.ts relative to THIS script so the benchmark runs from any
// working directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localityUrl = pathToFileURL(
  path.resolve(__dirname, "../src/workers/localityModule.ts"),
).href;

const { extractStarModule, signatureOf } = await import(localityUrl);

// ───────────────────────────── Vocabulary ───────────────────────────────────
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const EX = "http://example.org/bench/";

const RDF_TYPE = `${RDF}type`;
const SUBCLASS = `${RDFS}subClassOf`;
const OWL_CLASS = `${OWL}Class`;
const OWL_OBJ_PROP = `${OWL}ObjectProperty`;
const SOME_VALUES = `${OWL}someValuesFrom`;
const ON_PROPERTY = `${OWL}onProperty`;
const RESTRICTION = `${OWL}Restriction`;

const T = (subject, predicate, object, objectIsLiteral = false) => ({
  subject,
  predicate,
  object,
  objectIsLiteral,
});

const cls = (i) => `${EX}C${i}`;
const prop = (i) => `${EX}p${i}`;
const bnode = (i) => `_:r${i}`;

// ───────────────────────────── Synthetic ontologies ─────────────────────────
//
// Each generator returns the full triple list. Declarations are included so the
// extractor's includeDeclarationsForSignature pass behaves like the runtime.

/**
 * CHAIN: C0 ⊑ C1 ⊑ C2 ⊑ … ⊑ C(N-1). A long subsumption chain. A star-module for a
 * single class near one end should be a short prefix/suffix of the chain — the
 * canonical "locality keeps only the relevant slice" shape.
 */
function buildChain(n) {
  const triples = [];
  for (let i = 0; i < n; i++) triples.push(T(cls(i), RDF_TYPE, OWL_CLASS));
  for (let i = 0; i < n - 1; i++) triples.push(T(cls(i), SUBCLASS, cls(i + 1)));
  return triples;
}

/**
 * STAR: one hub class C0 with N-1 spokes C_i ⊑ ∃p_i.C0 (an existential restriction
 * back to the hub). Editing one spoke should pull in only that spoke's restriction
 * plus the hub — NOT the other N-2 spokes. Exercises the blank-node restriction
 * closure and the ∃R.D locality case.
 */
function buildStar(n) {
  const triples = [];
  const hub = cls(0);
  triples.push(T(hub, RDF_TYPE, OWL_CLASS));
  for (let i = 1; i < n; i++) {
    const r = bnode(i);
    triples.push(T(cls(i), RDF_TYPE, OWL_CLASS));
    triples.push(T(prop(i), RDF_TYPE, OWL_OBJ_PROP));
    // C_i ⊑ ∃p_i.C0
    triples.push(T(cls(i), SUBCLASS, r));
    triples.push(T(r, RDF_TYPE, RESTRICTION));
    triples.push(T(r, ON_PROPERTY, prop(i)));
    triples.push(T(r, SOME_VALUES, hub));
  }
  return triples;
}

const SHAPES = [
  {
    name: "chain",
    build: buildChain,
    // Edit signature: a single class a few steps into the chain. signatureOf over
    // the edited axiom (Ck ⊑ Ck+1) yields {Ck, Ck+1} — a realistically small Σ.
    signature: (n) => {
      const k = Math.min(3, Math.max(0, n - 2));
      return [...signatureOf([T(cls(k), SUBCLASS, cls(k + 1))])];
    },
  },
  {
    name: "star",
    build: buildStar,
    // Edit signature: a single spoke class (its restriction is the edited axiom).
    signature: (n) => {
      const k = Math.min(1, n - 1);
      return [cls(k)];
    },
  },
];

const SIZES = [50, 200, 800, 3200];

// ───────────────────────────── Timing harness ───────────────────────────────
const WARMUP_RUNS = 5;
const TIMED_RUNS = 25; // >= 20 as required; median is robust to GC jitter.

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Time one extraction; returns { ms, moduleSize }. */
function timeExtraction(axioms, signature) {
  const t0 = performance.now();
  const mod = extractStarModule(axioms, signature, {
    includeDeclarationsForSignature: true,
  });
  const t1 = performance.now();
  return { ms: t1 - t0, moduleSize: mod.length };
}

function benchOne(shape, n) {
  const axioms = shape.build(n);
  const signature = shape.signature(n);
  const fullSize = axioms.length;

  // Warmup (JIT / shape stabilisation) — results discarded.
  let moduleSize = 0;
  for (let i = 0; i < WARMUP_RUNS; i++) {
    moduleSize = timeExtraction(axioms, signature).moduleSize;
  }

  // Timed runs.
  const samples = [];
  for (let i = 0; i < TIMED_RUNS; i++) {
    const { ms, moduleSize: m } = timeExtraction(axioms, signature);
    samples.push(ms);
    moduleSize = m; // deterministic — same every run
  }

  return {
    shape: shape.name,
    n,
    fullSize,
    moduleSize,
    sigSize: signature.length,
    medianMs: median(samples),
    minMs: Math.min(...samples),
    ratioPct: (moduleSize / fullSize) * 100,
  };
}

// ───────────────────────────── Run + report ─────────────────────────────────
const rows = [];
for (const shape of SHAPES) {
  for (const n of SIZES) {
    rows.push(benchOne(shape, n));
  }
}

const fmtMs = (x) => x.toFixed(3);
const fmtPct = (x) => x.toFixed(2);

console.log("# Module-size vs ontology-size (syntactic-locality star module)\n");
console.log(
  `Edit signature is a SMALL fixed slice; median wall-clock over ${TIMED_RUNS} ` +
    `runs after ${WARMUP_RUNS} warmup runs. Pure extractStarModule (no Konclude/WASM).\n`,
);
console.log(
  "| shape | N (classes) | |Σ| edit sig | full axioms | module axioms | module / full | median ms | min ms |",
);
console.log(
  "|-------|------------:|-----------:|------------:|--------------:|--------------:|----------:|-------:|",
);
for (const r of rows) {
  console.log(
    `| ${r.shape} | ${r.n} | ${r.sigSize} | ${r.fullSize} | ${r.moduleSize} | ` +
      `${fmtPct(r.ratioPct)}% | ${fmtMs(r.medianMs)} | ${fmtMs(r.minMs)} |`,
  );
}

console.log("\n## Interpretation\n");
console.log(
  "- The `module / full` column is the incremental-reasoning payoff: the slice a\n" +
    "  reasoner must actually process for a small edit, as a fraction of the whole\n" +
    "  ontology. For locality-friendly shapes it stays small (often near-constant)\n" +
    "  even as N grows — the evidence behind the incremental claim.\n" +
    "- `median ms` is the extraction cost only (no reasoning); it tracks the work of\n" +
    "  scanning axioms for the locality fixpoint, not the module size.",
);
