export interface FieldError {
  code: string;
  field: string;
  message: string;
}

export class RaError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly fieldErrors?: FieldError[];

  constructor(message: string, httpStatus: number, code: string, fieldErrors?: FieldError[]) {
    super(message);
    this.name = "RaError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  static fromResponse(status: number, json: unknown): RaError {
    const j = json as
      | { error?: { code?: string; message?: string; errors?: FieldError[] } }
      | undefined;
    if (j?.error?.code) {
      return new RaError(j.error.message ?? `HTTP ${status}`, status, j.error.code, j.error.errors);
    }
    return new RaError(`HTTP ${status}`, status, "UNKNOWN");
  }
}
