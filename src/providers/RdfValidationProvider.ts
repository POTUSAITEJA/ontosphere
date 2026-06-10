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

  setErrors(map: Map<string, string[]>): void {
    this._errorMap = new Map(map);
  }

  clearErrors(): void {
    this._errorMap.clear();
  }

  async validate(e: ValidationEvent): Promise<ValidationResult> {
    const items: ValidatedElement[] = [];
    const errors = e.target.properties?.[ERROR_PRED] ?? [];
    const warnings = e.target.properties?.[WARNING_PRED] ?? [];
    const injected = this._errorMap.get(e.target.id as string) ?? [];

    if (errors.length > 0 || injected.length > 0) {
      const msg = injected[0] ?? (errors[0] as any)?.value ?? 'Reasoning error';
      items.push({
        type: 'element',
        target: e.target.id as ElementIri,
        severity: 'error',
        message: msg,
      });
    } else if (warnings.length > 0) {
      items.push({
        type: 'element',
        target: e.target.id as ElementIri,
        severity: 'warning',
        message: (warnings[0] as any)?.value ?? 'Reasoning warning',
      });
    }
    return { items };
  }
}
