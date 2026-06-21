/**
 * @fileoverview Ontology Metrics Dashboard panel.
 *
 * Gathers structural counts from the data graph (via a handful of small SPARQL
 * COUNT queries plus rdfManager.getGraphCounts), then renders compact stat
 * cards, a per-namespace breakdown table, and a set of OQuaRE-flavored quality
 * heuristics. The pure ratio math lives in utils/ontologyMetrics so it stays
 * unit-testable; this component only does the gathering and presentation.
 *
 * NOTE: the "quality" ratios are simple heuristics, NOT a certified OQuaRE
 * assessment — the UI labels them as such.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BarChart3,
  RefreshCw,
  Loader2,
  Gauge,
  Boxes,
  Link2,
  Tag,
  Users,
  Database,
} from 'lucide-react';
import { rdfManager } from '../../utils/rdfManager';
import type { NamespaceEntry } from '../../constants/namespaces';
import {
  computeOntologyMetrics,
  formatRatio,
  formatPercent,
  type OntologyRawCounts,
} from '../../utils/ontologyMetrics';
import { cn } from '../../lib/utils';

const DATA_GRAPH = 'urn:vg:data';
const INFERRED_GRAPH = 'urn:vg:inferred';

/** SPARQL COUNT queries keyed by the raw-count field they populate. */
const COUNT_QUERIES: Array<{ key: keyof OntologyRawCounts; sparql: string }> = [
  {
    key: 'totalTriples',
    sparql: 'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
  },
  {
    key: 'subjectCount',
    sparql: 'SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s ?p ?o }',
  },
  {
    key: 'classCount',
    sparql:
      'SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ' +
      '{ ?c a <http://www.w3.org/2002/07/owl#Class> } UNION ' +
      '{ ?c a <http://www.w3.org/2000/01/rdf-schema#Class> } }',
  },
  {
    key: 'objectPropertyCount',
    sparql:
      'SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p a <http://www.w3.org/2002/07/owl#ObjectProperty> }',
  },
  {
    key: 'datatypePropertyCount',
    sparql:
      'SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p a <http://www.w3.org/2002/07/owl#DatatypeProperty> }',
  },
  {
    key: 'namedIndividualCount',
    sparql:
      'SELECT (COUNT(DISTINCT ?i) AS ?n) WHERE { ?i a <http://www.w3.org/2002/07/owl#NamedIndividual> }',
  },
  {
    key: 'labeledClassCount',
    sparql:
      'SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ' +
      '{ { ?c a <http://www.w3.org/2002/07/owl#Class> } UNION ' +
      '{ ?c a <http://www.w3.org/2000/01/rdf-schema#Class> } } ' +
      '?c <http://www.w3.org/2000/01/rdf-schema#label> ?l }',
  },
];

/** Per-prefix subject count for the namespace breakdown table. */
interface NamespaceRow {
  prefix: string;
  uri: string;
  subjects: number;
}

interface SparqlSelectResult {
  type?: string;
  rows?: Array<Record<string, string>>;
}

/** Pull the single ?n binding out of a `SELECT (COUNT(...) AS ?n)` result. */
function readCount(result: unknown): number {
  const rows = (result as SparqlSelectResult)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const raw = rows[0]?.n;
  // COUNT bindings may arrive as typed-literal strings; parse the leading int.
  const n = Number.parseInt(String(raw ?? '').replace(/\D.*$/, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function MetricsPanel() {
  const [counts, setCounts] = useState<OntologyRawCounts | null>(null);
  const [nsRows, setNsRows] = useState<NamespaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const gather = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Structural counts — small COUNT queries run in parallel.
      const countResults = await Promise.all(
        COUNT_QUERIES.map((q) => rdfManager.sparqlQuery(q.sparql, { graphName: DATA_GRAPH })),
      );
      const partial: Partial<OntologyRawCounts> = {};
      COUNT_QUERIES.forEach((q, i) => {
        partial[q.key] = readCount(countResults[i]);
      });

      // Asserted vs inferred triple counts from the per-graph tallies.
      const graphCounts = await rdfManager.getGraphCounts();
      const asserted = Number(graphCounts?.[DATA_GRAPH] ?? partial.totalTriples ?? 0) || 0;
      const inferred = Number(graphCounts?.[INFERRED_GRAPH] ?? 0) || 0;

      const next: OntologyRawCounts = {
        totalTriples: partial.totalTriples ?? 0,
        classCount: partial.classCount ?? 0,
        objectPropertyCount: partial.objectPropertyCount ?? 0,
        datatypePropertyCount: partial.datatypePropertyCount ?? 0,
        namedIndividualCount: partial.namedIndividualCount ?? 0,
        subjectCount: partial.subjectCount ?? 0,
        labeledClassCount: partial.labeledClassCount ?? 0,
        assertedTriples: asserted,
        inferredTriples: inferred,
      };

      // Per-namespace subject breakdown: one COUNT query per registered prefix.
      const namespaces: NamespaceEntry[] = rdfManager.getNamespaces();
      const seen = new Set<string>();
      const candidates = namespaces.filter((ns) => {
        if (!ns?.uri) return false;
        if (seen.has(ns.uri)) return false;
        seen.add(ns.uri);
        return true;
      });
      const nsCounts = await Promise.all(
        candidates.map((ns) =>
          rdfManager.sparqlQuery(
            `SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s ?p ?o FILTER(STRSTARTS(STR(?s), "${ns.uri.replace(/"/g, '\\"')}")) }`,
            { graphName: DATA_GRAPH },
          ),
        ),
      );
      const rows: NamespaceRow[] = candidates
        .map((ns, i) => ({
          prefix: ns.prefix || ':',
          uri: ns.uri,
          subjects: readCount(nsCounts[i]),
        }))
        .filter((r) => r.subjects > 0)
        .sort((a, b) => b.subjects - a.subjects);

      if (mounted.current) {
        setCounts(next);
        setNsRows(rows);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (mounted.current) {
        setError(message);
        toast.error(`Metrics failed: ${message}`);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Gather on mount, and refresh when subjects change in the data graph.
  useEffect(() => {
    mounted.current = true;
    void gather();
    const handler = (
      _subjects: string[],
      _quads?: unknown,
      _snapshot?: unknown,
      meta?: Record<string, unknown> | null,
    ) => {
      const graphName = meta && typeof meta.graphName === 'string' ? meta.graphName : null;
      if (graphName === null || graphName === DATA_GRAPH || graphName === INFERRED_GRAPH) {
        void gather();
      }
    };
    rdfManager.onSubjectsChange(handler as never);
    return () => {
      mounted.current = false;
      rdfManager.offSubjectsChange(handler as never);
    };
  }, [gather]);

  const metrics = useMemo(
    () => (counts ? computeOntologyMetrics(counts) : null),
    [counts],
  );

  const isEmpty = !loading && !error && counts !== null && counts.totalTriples === 0;

  return (
    <div className="space-y-2.5 px-2 pb-1">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5" />
          Ontology metrics
        </span>
        <button
          type="button"
          onClick={() => void gather()}
          disabled={loading}
          aria-label="Refresh metrics"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Refresh
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive break-words"
        >
          {error}
        </div>
      )}

      {loading && !counts && (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin opacity-60" />
          Computing metrics…
        </div>
      )}

      {isEmpty && (
        <div className="px-3 py-6 text-center">
          <BarChart3 className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="mb-1 text-sm text-muted-foreground">No data yet</p>
          <p className="text-xs text-muted-foreground">Load data to see metrics.</p>
        </div>
      )}

      {counts && !isEmpty && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-1.5" aria-label="Ontology counts">
            <StatCard icon={Database} label="Triples" value={counts.totalTriples} />
            <StatCard icon={Users} label="Subjects" value={counts.subjectCount} />
            <StatCard icon={Boxes} label="Classes" value={counts.classCount} />
            <StatCard
              icon={Link2}
              label="Object props"
              value={counts.objectPropertyCount}
            />
            <StatCard
              icon={Tag}
              label="Datatype props"
              value={counts.datatypePropertyCount}
            />
            <StatCard
              icon={Users}
              label="Individuals"
              value={counts.namedIndividualCount}
            />
          </div>

          {/* Namespace breakdown */}
          <section aria-label="Per-namespace subject breakdown" className="space-y-1">
            <h3 className="px-1 text-[11px] font-medium text-muted-foreground">
              Subjects by namespace
            </h3>
            {nsRows.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground/80">
                No namespaced subjects found.
              </p>
            ) : (
              <div className="max-h-48 overflow-auto rounded-md border">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th
                        scope="col"
                        className="border-b px-2 py-1 text-left font-mono font-medium"
                      >
                        prefix
                      </th>
                      <th
                        scope="col"
                        className="border-b px-2 py-1 text-right font-medium"
                      >
                        subjects
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {nsRows.map((row) => (
                      <tr key={row.uri} className="odd:bg-muted/30">
                        <td
                          className="border-b px-2 py-1 font-mono"
                          title={row.uri}
                        >
                          {row.prefix}
                        </td>
                        <td className="border-b px-2 py-1 text-right tabular-nums">
                          {row.subjects}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Quality heuristics */}
          {metrics && (
            <section aria-label="Quality heuristics" className="space-y-1">
              <h3 className="flex items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground">
                <Gauge className="h-3 w-3" />
                Quality heuristics
              </h3>
              <div className="space-y-0.5 rounded-md border px-2 py-1.5">
                <RatioRow
                  label="Avg properties / class"
                  value={formatRatio(metrics.avgPropertiesPerClass)}
                />
                <RatioRow
                  label="Class : property ratio"
                  value={formatRatio(metrics.classToPropertyRatio)}
                />
                <RatioRow
                  label="Classes with rdfs:label"
                  value={formatPercent(metrics.labeledClassRatio)}
                />
                <RatioRow
                  label="Inferred : asserted triples"
                  value={formatRatio(metrics.inferredToAssertedRatio)}
                />
              </div>
              <p className="px-1 text-[10px] leading-snug text-muted-foreground/80">
                Simple OQuaRE-flavored heuristics — directional signals, not a
                certified OQuaRE assessment.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database;
  label: string;
  value: number;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5',
      )}
    >
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function RatioRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}
