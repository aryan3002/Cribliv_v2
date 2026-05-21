import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";

// Maps service-layer typed errors to HTTP responses per [[API-Contract]] §B3.
// Anything without a recognized RENT_AGREEMENT_* code is re-thrown so Nest's
// default exception handling takes over (5xx).

const STATUS_BY_CODE: Record<string, HttpStatus> = {
  RENT_AGREEMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  RENT_AGREEMENT_FORBIDDEN: HttpStatus.FORBIDDEN,
  RENT_AGREEMENT_INVALID_PLAN: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_STEP_MISMATCH: HttpStatus.CONFLICT,
  RENT_AGREEMENT_STEP_VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_CROSS_FIELD_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_SIGNATURE_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_SIGNATURE_INVALID_PARTY: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_SIGNATURE_INVALID_METHOD: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_IMAGE_UNSAFE: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_CHECKOUT_INVALID_PROVIDER: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_FOUND: HttpStatus.NOT_FOUND,
  RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_READY: HttpStatus.CONFLICT,
  RENT_AGREEMENT_CHECKOUT_SIGNATURES_MISSING: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_PDF_NOT_READY: 425 as HttpStatus,
  RENT_AGREEMENT_DOWNLOAD_LIMIT_REACHED: HttpStatus.TOO_MANY_REQUESTS,
  RENT_AGREEMENT_EXPIRED: HttpStatus.GONE,
  RENT_AGREEMENT_REFUNDED: HttpStatus.GONE,
  RENT_AGREEMENT_STATE_UNSUPPORTED: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_IDEMPOTENCY_REQUIRED: HttpStatus.BAD_REQUEST,
  // Phase 15
  RENT_AGREEMENT_ESTAMP_NOT_READY: HttpStatus.CONFLICT,
  RENT_AGREEMENT_ESTAMP_NOT_ISSUED: HttpStatus.NOT_FOUND,
  RENT_AGREEMENT_ESIGN_NOT_READY: HttpStatus.CONFLICT,
  RENT_AGREEMENT_ESIGN_NOT_INITIATED: HttpStatus.NOT_FOUND,
  RENT_AGREEMENT_ESIGN_OTP_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  RENT_AGREEMENT_PAYMENT_PROVIDER_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE
};

interface TypedRentError extends Error {
  code?: string;
  errors?: Array<{ code: string; field: string; message: string }>;
}

@Catch()
export class RentAgreementExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const err = exception as TypedRentError;
    const code = err.code ?? "";
    // STATE_UNSUPPORTED comes from stamp-duty.service as `RENT_AGREEMENT_STATE_UNSUPPORTED:<CODE>`.
    const baseCode = code.split(":")[0];
    const status = STATUS_BY_CODE[baseCode];
    const res = host.switchToHttp().getResponse();

    if (status) {
      const body: Record<string, unknown> = {
        ok: false,
        error: { code: baseCode, message: err.message }
      };
      if (err.errors && err.errors.length > 0) {
        (body.error as Record<string, unknown>).errors = err.errors;
      }
      res.status(status).json(body);
      return;
    }

    // Not a RENT_AGREEMENT_* error. NEVER re-throw — a re-throw from a
    // controller-scoped filter escapes Nest and crashes the process. An
    // HttpException (401 / 403 / throttler / etc.) keeps its own status + body;
    // anything else is a genuine 500.
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ ok: false, error: { code: "INTERNAL", message: "Internal server error" } });
  }
}
