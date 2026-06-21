import React from 'react';
import { HelpCircle } from 'lucide-react';
import { rdfManager } from '../../utils/rdfManager';
import { toPrefixed } from '../../utils/termUtils';

/**
 * EntailmentExplanation
 * ---------------------
 * A small, unobtrusive "why was this inferred?" affordance shown next to an
 * INFERRED triple (an inferred rdf:type, an inferred data property, or an
 * inferred object-property/link) on the canvas.
 *
 * It lazily calls the existing public `rdfManager.explainEntailment(subject,
 * predicate, object)` capability ONLY when the user opens the popover — never
 * on render — so we never hammer the reasoner for every node/link on screen.
 *
 * The popover is rendered inline (no portal) as an absolutely positioned panel
 * so it works reliably inside Reactodia's HTML element templates and in the
 * jsdom test environment. It is keyboard operable: the trigger is a real
 * <button> (aria-label "Explain inference"), Escape closes the panel, and a
 * click outside dismisses it.
 */

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';

export interface ExplainTriple {
  subject: string;
  predicate: string;
  object: string;
  /** When true, the object is an RDF literal value rather than an IRI. */
  objectIsLiteral?: boolean;
}

type ExplainResult = Awaited<ReturnType<typeof rdfManager.explainEntailment>>;

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; result: ExplainResult }
  | { status: 'error'; message: string };

/**
 * Render a single axiom triple as a compact, human-readable line. We use real
 * mathematical/typographic glyphs where the relation is well known (⊑ for
 * subClassOf / subPropertyOf) and fall back to the abbreviated predicate name
 * for everything else.
 */
function renderAxiom(
  axiom: { subject: string; predicate: string; object: string },
): string {
  const s = toPrefixed(axiom.subject);
  const o = toPrefixed(axiom.object);
  if (axiom.predicate === SUBCLASS_OF || axiom.predicate === SUBPROPERTY_OF) {
    return `${s} ⊑ ${o}`;
  }
  if (axiom.predicate === RDF_TYPE) {
    return `${s} rdf:type ${o}`;
  }
  return `${s} ${toPrefixed(axiom.predicate)} ${o}`;
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  color: 'var(--reactodia-paper-fg-muted, #6b7280)',
  marginBottom: 4,
};

function ExplanationBody({ state }: { state: LoadState }): React.ReactElement {
  if (state.status === 'loading') {
    return (
      <div style={{ fontSize: 11, color: 'var(--reactodia-paper-fg-muted, #6b7280)' }}>
        Explaining inference…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div style={{ fontSize: 11, color: 'var(--reactodia-color-danger, #dc2626)' }}>
        Could not explain this inference: {state.message}
      </div>
    );
  }
  if (state.status !== 'loaded') {
    return (
      <div style={{ fontSize: 11, color: 'var(--reactodia-paper-fg-muted, #6b7280)' }}>
        Open to explain why this was inferred.
      </div>
    );
  }

  const { result } = state;

  // 1. Ontology inconsistent — the entailment reduction is not valid.
  if (result.ontologyInconsistent) {
    return (
      <div style={{ fontSize: 11, color: 'var(--reactodia-color-danger, #dc2626)' }}>
        Cannot explain: the ontology is inconsistent — fix consistency first.
      </div>
    );
  }

  // 2. Asserted (not inferred).
  if (result.isEntailed === false) {
    return (
      <div style={{ fontSize: 11, color: 'var(--reactodia-paper-fg, #374151)' }}>
        This is an asserted triple (not inferred).
      </div>
    );
  }

  // 3. Vacuous — subject class is unsatisfiable.
  if (result.vacuous) {
    return (
      <div style={{ fontSize: 11, color: 'var(--reactodia-paper-fg, #374151)' }}>
        Holds vacuously (the subject class is unsatisfiable).
      </div>
    );
  }

  const justifications = Array.isArray(result.justifications)
    ? result.justifications.filter(j => Array.isArray(j) && j.length > 0)
    : [];

  // 4. Entailed but no detailed justification available (unsupported shape).
  if (justifications.length === 0) {
    return (
      <div style={{ fontSize: 11, color: 'var(--reactodia-paper-fg, #374151)' }}>
        Inferred (no detailed justification available for this relation type).
      </div>
    );
  }

  // 5. Entailed with one or more justifications.
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--reactodia-paper-fg, #374151)', marginBottom: 6 }}>
        Inferred because:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {justifications.map((justification, ji) => (
          <div key={ji}>
            {justifications.length > 1 && (
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--reactodia-paper-fg-muted, #9ca3af)', marginBottom: 2 }}>
                {ji === 0 ? 'Support' : 'Alternative support'} {ji + 1}
              </div>
            )}
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {justification.map((axiom, ai) => (
                <li
                  key={ai}
                  style={{
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: 'var(--reactodia-paper-fg, #374151)',
                    fontFamily: 'var(--reactodia-font-monospace, ui-monospace, monospace)',
                    wordBreak: 'break-word',
                  }}
                >
                  {renderAxiom(axiom)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface EntailmentExplanationProps {
  triple: ExplainTriple;
  /** Optional override of the rdfManager (primarily for testing). */
  explain?: typeof rdfManager.explainEntailment;
  /** Accessible context appended to the trigger's aria-label, e.g. the type name. */
  label?: string;
}

export function EntailmentExplanation(
  { triple, explain, label }: EntailmentExplanationProps,
): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<LoadState>({ status: 'idle' });
  const containerRef = React.useRef<HTMLSpanElement>(null);

  const runExplain = React.useCallback(() => {
    setState({ status: 'loading' });
    const call = explain ?? rdfManager.explainEntailment.bind(rdfManager);
    Promise.resolve(
      call(triple.subject, triple.predicate, triple.object, {
        objectIsLiteral: triple.objectIsLiteral,
      }),
    )
      .then(result => setState({ status: 'loaded', result }))
      .catch((err: unknown) =>
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [explain, triple.subject, triple.predicate, triple.object, triple.objectIsLiteral]);

  const toggle = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(prev => {
        const next = !prev;
        // Lazy: only call the reasoner the first time the popover is opened.
        if (next && state.status === 'idle') runExplain();
        return next;
      });
    },
    [runExplain, state.status],
  );

  // Close on Escape and on outside click while open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open]);

  const ariaLabel = label ? `Explain inference: ${label}` : 'Explain inference';

  return (
    <span
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Why was this inferred?"
        onClick={toggle}
        onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          padding: 0,
          marginLeft: 3,
          border: 'none',
          background: 'transparent',
          color: 'var(--vg-inferred-color)',
          cursor: 'pointer',
          opacity: 0.75,
          lineHeight: 0,
          verticalAlign: 'middle',
        }}
      >
        <HelpCircle size={12} aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel}
          onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); }}
          onWheel={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 9999,
            minWidth: 220,
            maxWidth: 320,
            maxHeight: 280,
            overflowY: 'auto',
            padding: '10px 12px',
            background: 'var(--reactodia-paper-bg, #ffffff)',
            color: 'var(--reactodia-paper-fg, #374151)',
            border: '1px solid var(--reactodia-paper-border, #d1d5db)',
            borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
            textAlign: 'left',
            cursor: 'default',
            userSelect: 'text',
          }}
        >
          <div style={labelStyle}>Why was this inferred?</div>
          <ExplanationBody state={state} />
        </div>
      )}
    </span>
  );
}

export default EntailmentExplanation;
