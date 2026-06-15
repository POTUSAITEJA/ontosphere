export interface ReasoningError {
  nodeId?: string;
  edgeId?: string;
  message: string;
  rule: string;
  severity: "critical" | "error";
}

export interface ReasoningWarning {
  nodeId?: string;
  edgeId?: string;
  message: string;
  rule: string;
  severity?: "critical" | "warning" | "info";
}

export interface ReasoningInference {
  type: "property" | "class" | "relationship";
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface ShaclViolation {
  focusNode: string | null;
  path: string | null;
  severity: string | null;
  message: string | null;
  sourceShape: string | null;
  constraint: string | null;
  source: "shacl";
}

export interface ReasoningResult {
  id: string;
  timestamp: number;
  status: "running" | "completed" | "error";
  duration?: number;
  errors: ReasoningError[];
  warnings: ReasoningWarning[];
  inferences: ReasoningInference[];
  inferredQuads?: { subject: string; predicate: string; object: string; graph?: string }[];
  isConsistent?: boolean | null;
  meta?: {
    usedReasoner?: boolean;
    workerDurationMs?: number;
    totalDurationMs?: number;
    addedCount?: number;
    ruleQuadCount?: number;
  };
}
