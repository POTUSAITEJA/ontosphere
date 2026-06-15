import { useState, useEffect, useCallback } from 'react';
import { rdfManager } from '../../utils/rdfManager';
import { Badge } from '../ui/badge';
import { Shield, ChevronDown, ChevronRight, AlertTriangle, XCircle } from 'lucide-react';

interface ConstraintInfo {
  path: string | null;
  message: string | null;
  severity: 'violation' | 'warning' | 'info';
}

interface ShapeInfo {
  iri: string;
  label: string;
  targetClass: string | null;
  constraints: ConstraintInfo[];
}

interface ShapeGroup {
  source: string;
  shapes: ShapeInfo[];
}

const SH = 'http://www.w3.org/ns/shacl#';

export function ShaclShapesPanel() {
  const [groups, setGroups] = useState<ShapeGroup[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [shapeCount, setShapeCount] = useState(0);

  const loadShapeInfo = useCallback(async () => {
    try {
      const SH_SHAPE_TYPES = new Set([SH + 'NodeShape', SH + 'Shape']);
      const SH_TARGET_CLASS = SH + 'targetClass';
      const SH_PROPERTY = SH + 'property';
      const SH_PATH = SH + 'path';
      const SH_MESSAGE = SH + 'message';
      const SH_SEVERITY = SH + 'severity';
      const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
      const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
      const SH_NAME = SH + 'name';

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
        const propBNodes = items
          .filter(q => q.subject === iri && q.predicate === SH_PROPERTY)
          .map(q => q.object);

        const constraints: ConstraintInfo[] = propBNodes.map(bn => {
          const pathQ = items.find(q => q.subject === bn && q.predicate === SH_PATH);
          const msgQ = items.find(q => q.subject === bn && q.predicate === SH_MESSAGE);
          const sevQ = items.find(q => q.subject === bn && q.predicate === SH_SEVERITY);
          const sevVal = sevQ?.object ?? '';
          const severity: ConstraintInfo['severity'] =
            sevVal.endsWith('Violation') ? 'violation' :
            sevVal.endsWith('Info') ? 'info' : 'warning';
          return {
            path: pathQ?.object ?? null,
            message: msgQ?.object ?? null,
            severity,
          };
        });

        const label = labelQ?.object ?? iri.split(/[#/]/).pop() ?? iri;
        return {
          iri,
          label,
          targetClass: targetQ?.object ?? null,
          constraints,
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

  const severityIcon = (sev: ConstraintInfo['severity']) => {
    if (sev === 'violation') return <XCircle className="w-3 h-3 text-destructive shrink-0" />;
    if (sev === 'warning') return <AlertTriangle className="w-3 h-3 text-warning shrink-0" />;
    return <Shield className="w-3 h-3 text-blue-400 shrink-0" />;
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
        <span className="text-xs text-muted-foreground">{shapeCount} shapes loaded</span>
      </div>

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
                <div key={shape.iri} className="px-2 py-1.5 text-xs space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate" title={shape.iri}>
                      {shape.label}
                    </span>
                    {shape.targetClass && (
                      <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0">
                        {shortenIri(shape.targetClass)}
                      </Badge>
                    )}
                  </div>
                  {shape.constraints.map((c, i) => (
                    <div key={i} className="flex items-start gap-1 text-muted-foreground pl-1">
                      {severityIcon(c.severity)}
                      <span className="break-words">
                        {c.message || (c.path ? `requires ${shortenIri(c.path)}` : 'constraint')}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
