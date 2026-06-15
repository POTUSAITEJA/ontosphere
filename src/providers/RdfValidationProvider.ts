import type {
  ValidationProvider,
  ValidationEvent,
  ValidationResult,
  ValidatedElement,
  ElementIri,
} from '@reactodia/workspace';

const ERROR_PRED = 'urn:vg:reasoningError';
const WARNING_PRED = 'urn:vg:reasoningWarning';

export class RdfValidationProvider implements ValidationProvider {
  private _errorMap = new Map<string, string[]>();
  private _warningMap = new Map<string, string[]>();

  setErrors(map: Map<string, string[]>): void {
    this._errorMap = new Map(map);
  }

  setWarnings(map: Map<string, string[]>): void {
    this._warningMap = new Map(map);
  }

  clearErrors(): void {
    this._errorMap.clear();
    this._warningMap.clear();
  }

  getAffectedIris(): Set<string> {
    const iris = new Set<string>();
    for (const k of this._errorMap.keys()) iris.add(k);
    for (const k of this._warningMap.keys()) iris.add(k);
    return iris;
  }

  async validate(e: ValidationEvent): Promise<ValidationResult> {
    const items: ValidatedElement[] = [];
    const errors = e.target.properties?.[ERROR_PRED] ?? [];
    const warnings = e.target.properties?.[WARNING_PRED] ?? [];
    const injectedErrors = this._errorMap.get(e.target.id as string) ?? [];
    const injectedWarnings = this._warningMap.get(e.target.id as string) ?? [];

    if (errors.length > 0 || injectedErrors.length > 0) {
      const msg = injectedErrors[0] ?? (errors[0] as any)?.value ?? 'Reasoning error';
      items.push({
        type: 'element',
        target: e.target.id as ElementIri,
        severity: 'error',
        message: msg,
      });
    }

    if (warnings.length > 0 || injectedWarnings.length > 0) {
      const msg = injectedWarnings[0] ?? (warnings[0] as any)?.value ?? 'Reasoning warning';
      items.push({
        type: 'element',
        target: e.target.id as ElementIri,
        severity: 'warning',
        message: msg,
      });
    }

    return { items };
  }
}
