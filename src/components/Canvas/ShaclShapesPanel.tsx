import { useState, useEffect, useCallback } from 'react';
import { rdfManager } from '../../utils/rdfManager';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Shield, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { ShaclViolation } from '../../utils/reasoningTypes';

interface ShapeInfo {
  iri: string;
  label: string;
  targetClass: string | null;
  propertyCount: number;
}

interface ShapeGroup {
  source: string;
  shapes: ShapeInfo[];
}

export function ShaclShapesPanel() {
  const [groups, setGroups] = useState<ShapeGroup[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    conforms: boolean;
    violations: ShaclViolation[];
  } | null>(null);
  const [shapeCount, setShapeCount] = useState(0);

  const loadShapeInfo = useCallback(async () => {
    try {
      const SH_SHAPE_TYPES = new Set([
        'http://www.w3.org/ns/shacl#NodeShape',
        'http://www.w3.org/ns/shacl#Shape',
      ]);
      const SH_TARGET_CLASS = 'http://www.w3.org/ns/shacl#targetClass';
      const SH_PROPERTY = 'http://www.w3.org/ns/shacl#property';
      const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
      const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
      const SH_NAME = 'http://www.w3.org/ns/shacl#name';

      const { items } = await rdfManager.fetchQuadsPage({ graphName: 'urn:vg:shapes', limit: 0 });
      if (!items || items.length === 0) {
        setGroups([]);
        setShapeCount(0);
        return;
      }

      const nodeShapes = items
        .filter(q => q.predicate === RDF_TYPE && SH_SHAPE_TYPES.has(q.object))
        .map(q => q.subject);

      const shapes: ShapeInfo[] = nodeShapes.map(iri => {
        const targetQ = items.find(q => q.subject === iri && q.predicate === SH_TARGET_CLASS);
        const labelQ = items.find(q => q.subject === iri && (q.predicate === RDFS_LABEL || q.predicate === SH_NAME));
        const propCount = items.filter(q => q.subject === iri && q.predicate === SH_PROPERTY).length;
        const label = labelQ?.object ?? iri.split(/[#/]/).pop() ?? iri;
        return {
          iri,
          label,
          targetClass: targetQ?.object ?? null,
          propertyCount: propCount,
        };
      });

      setShapeCount(shapes.length);
      const group: ShapeGroup = { source: 'urn:vg:shapes', shapes };
      setGroups(shapes.length > 0 ? [group] : []);
    } catch (err) {
      console.warn('[ShaclShapesPanel] Failed to load shape info', err);
      setGroups([]);
      setShapeCount(0);
    }
  }, []);

  useEffect(() => {
    loadShapeInfo();
    const handler = () => { loadShapeInfo(); };
    rdfManager.onChange(handler);
    return () => { rdfManager.offChange(handler); };
  }, [loadShapeInfo]);

  const handleValidate = useCallback(async () => {
    setValidating(true);
    try {
      const result = await rdfManager.runShaclValidation();
      setValidationResult({ conforms: result.conforms, violations: result.violations });
    } catch (err) {
      console.error('[ShaclShapesPanel] Validation failed', err);
    } finally {
      setValidating(false);
    }
  }, []);

  const toggleGroup = (source: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const shortenIri = (iri: string) => {
    const hash = iri.lastIndexOf('#');
    const slash = iri.lastIndexOf('/');
    return iri.slice(Math.max(hash, slash) + 1) || iri;
  };

  if (shapeCount === 0) {
    return (
      <div className="px-3 py-4 text-center">
        <Shield className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground mb-1">No shapes loaded</p>
        <p className="text-xs text-muted-foreground">
          Add a SHACL shapes URL in Settings or via <code className="text-xs">?shaclShapes=</code> parameter
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-muted-foreground">{shapeCount} shapes</span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs"
          onClick={handleValidate}
          disabled={validating}
        >
          {validating ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <Shield className="w-3 h-3 mr-1" />
          )}
          Validate
        </Button>
      </div>

      {validationResult && (
        <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs ${
          validationResult.conforms
            ? 'bg-green-500/10 text-green-700 dark:text-green-400'
            : 'bg-destructive/10 text-destructive'
        }`}>
          {validationResult.conforms ? (
            <>
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Conforms</span>
            </>
          ) : (
            <>
              <XCircle className="w-3.5 h-3.5" />
              <span>{validationResult.violations.length} violations</span>
            </>
          )}
        </div>
      )}

      {groups.map(group => (
        <div key={group.source} className="border rounded-md overflow-hidden">
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors"
            onClick={() => toggleGroup(group.source)}
          >
            {expanded.has(group.source) ? (
              <ChevronDown className="w-3 h-3 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 shrink-0" />
            )}
            <span className="font-medium truncate">{shortenIri(group.source)}</span>
            <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
              {group.shapes.length}
            </Badge>
          </button>
          {expanded.has(group.source) && (
            <div className="border-t divide-y">
              {group.shapes.map(shape => (
                <div key={shape.iri} className="px-2 py-1.5 text-xs space-y-0.5">
                  <div className="font-medium truncate" title={shape.iri}>
                    {shape.label}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2">
                    {shape.targetClass && (
                      <span title={shape.targetClass}>
                        target: {shortenIri(shape.targetClass)}
                      </span>
                    )}
                    {shape.propertyCount > 0 && (
                      <span>{shape.propertyCount} constraints</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
