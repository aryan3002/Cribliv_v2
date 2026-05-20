import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { AppStateService } from "../../common/app-state.service";
import { DraftsService } from "./drafts/drafts.service";
import { SignaturesService } from "./signatures/signatures.service";
import { CheckoutService } from "./checkout/checkout.service";
import { DownloadsService } from "./downloads/downloads.service";
import { StampDutyService } from "./stamp-duty/stamp-duty.service";
import { STAMP_DUTY_SEED } from "./stamp-duty/stamp-duty.repository";
import { listActivePlans } from "./plans/plans.catalog";
import { RentAgreementExceptionFilter } from "./rent-agreement.exception-filter";
import { InMemoryPdfStorage } from "./pdf/in-memory-pdf-storage";

// Mirrors the DI token in rent-agreement.module.ts (kept as a string literal to
// avoid a circular import controller ↔ module).
const RENT_AGREEMENT_PDF_STORAGE_TOKEN = "RENT_AGREEMENT_PDF_STORAGE";

interface AuthedReq {
  user: { id: string; role: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function getIp(req: AuthedReq): string {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.ip ?? "unknown";
}

function getUserAgent(req: AuthedReq): string | null {
  const ua = req.headers?.["user-agent"];
  return typeof ua === "string" ? ua : null;
}

function requireIdempotencyKey(req: AuthedReq): string {
  const key = req.headers?.["idempotency-key"];
  if (typeof key !== "string" || key.length === 0) {
    const err = new Error("idempotency-key header is required") as Error & { code: string };
    err.code = "RENT_AGREEMENT_IDEMPOTENCY_REQUIRED";
    throw err;
  }
  return key;
}

function notFound(): Error {
  const err = new Error("Agreement not found") as Error & { code: string };
  err.code = "RENT_AGREEMENT_NOT_FOUND";
  return err;
}

function makeBadInput(message: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = "RENT_AGREEMENT_STEP_VALIDATION_FAILED";
  return err;
}

@UseFilters(RentAgreementExceptionFilter)
@Controller("rent-agreement")
export class RentAgreementController {
  constructor(
    @Inject(DraftsService) private readonly drafts: DraftsService,
    @Inject(SignaturesService) private readonly signatures: SignaturesService,
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(DownloadsService) private readonly downloads: DownloadsService,
    @Inject(StampDutyService) private readonly stampDuty: StampDutyService,
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Optional()
    @Inject(RENT_AGREEMENT_PDF_STORAGE_TOKEN)
    private readonly pdfStorage?: InMemoryPdfStorage
  ) {}

  // ─── Public ────────────────────────────────────────────────────────────

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("plans")
  async listPlans() {
    return ok(listActivePlans());
  }

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("states")
  async listStates() {
    const states = STAMP_DUTY_SEED.map((r) => ({
      state_code: r.state_code,
      state_name: r.state_name,
      formula_summary: r.notes ?? `${(r.percentage * 100).toFixed(2)}% (${r.formula_type})`
    }));
    return ok(states);
  }

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("stamp-duty")
  async calculateStampDuty(
    @Query("state") state: string,
    @Query("rent") rent: string,
    @Query("tenure") tenure: string,
    @Query("deposit") deposit?: string
  ) {
    if (!state) throw makeBadInput("state query param is required");
    const monthlyRentPaise = Number(rent);
    const tenureMonths = Number(tenure);
    const securityDepositPaise = deposit ? Number(deposit) : 0;
    if (!Number.isFinite(monthlyRentPaise) || monthlyRentPaise <= 0) {
      throw makeBadInput("rent must be a positive integer (paise)");
    }
    if (!Number.isFinite(tenureMonths) || tenureMonths <= 0 || tenureMonths > 132) {
      throw makeBadInput("tenure must be a positive integer between 1 and 132");
    }
    const result = await this.stampDuty.calculate({
      stateCode: state,
      monthlyRentPaise,
      tenureMonths,
      securityDepositPaise
    });
    return ok({
      state_code: result.rule.state_code,
      state_name: result.rule.state_name,
      stamp_duty_paise: result.dutyPaise,
      breakdown: result.breakdown,
      rule: {
        formula_type: result.rule.formula_type,
        percentage: result.rule.percentage,
        min_amount_paise: result.rule.min_amount_paise
      }
    });
  }

  // ─── Auth-required (creator-scoped) ───────────────────────────────────

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 3600_000, limit: 10 } })
  @Post("draft")
  async createDraft(
    @Req() req: AuthedReq,
    @Body() body: { plan_id: string; locale?: "en" | "hi" }
  ) {
    const idemKey = requireIdempotencyKey(req);
    const draft = await this.drafts.create(
      req.user.id,
      { plan_id: body.plan_id as "basic" | "standard" | "premium", locale: body.locale ?? "en" },
      idemKey
    );
    return ok(draft);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("my")
  async listMine(@Req() req: AuthedReq) {
    return ok(await this.drafts.listForUser(req.user.id));
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(":id")
  async getOne(@Req() req: AuthedReq, @Param("id") id: string) {
    const row = await this.drafts.getOne(req.user.id, id);
    if (!row) throw notFound();
    return ok(row);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Patch(":id/step/:step")
  async patchStep(
    @Req() req: AuthedReq,
    @Param("id") id: string,
    @Param("step", ParseIntPipe) step: number,
    @Body() body: unknown
  ) {
    return ok(await this.drafts.patchStep(req.user.id, id, step, body));
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post(":id/step/:step/advance")
  async advanceStep(
    @Req() req: AuthedReq,
    @Param("id") id: string,
    @Param("step", ParseIntPipe) step: number,
    @Body() body: unknown
  ) {
    return ok(await this.drafts.advance(req.user.id, id, step, body));
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post(":id/step/:step/back")
  @HttpCode(200)
  async backStep(
    @Req() req: AuthedReq,
    @Param("id") id: string,
    @Param("step", ParseIntPipe) step: number
  ) {
    return ok(await this.drafts.back(req.user.id, id, step));
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post(":id/signature")
  async saveSignature(
    @Req() req: AuthedReq,
    @Param("id") id: string,
    @Body()
    body: {
      party: "owner" | "tenant";
      method: "canvas" | "upload";
      image_b64: string;
      content_type: string;
    }
  ) {
    const draft = await this.drafts.getOne(req.user.id, id);
    if (!draft) throw notFound();
    const raw = Buffer.from(body.image_b64, "base64");
    const result = await this.signatures.save({
      agreementId: id,
      party: body.party,
      method: body.method,
      plan: (draft as unknown as { plan_id: string }).plan_id,
      raw,
      declaredContentType: body.content_type
    });
    return ok(result);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(":id/checkout")
  async startCheckout(
    @Req() req: AuthedReq,
    @Param("id") id: string,
    @Body() body: { provider: "razorpay" | "upi" }
  ) {
    const idemKey = requireIdempotencyKey(req);
    const result = await this.checkout.createOrder({
      userId: req.user.id,
      draftId: id,
      idempotencyKey: idemKey,
      provider: body.provider
    });
    return ok(result);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get(":id/status")
  async getStatus(@Req() req: AuthedReq, @Param("id") id: string) {
    const draft = await this.drafts.getOne(req.user.id, id);
    if (!draft) throw notFound();
    const drow = draft as unknown as { status: string; pdf_blob_path?: string | null };
    return ok({
      status: drow.status,
      pdf_ready: drow.status === "generated" && !!drow.pdf_blob_path,
      queue_position: null,
      error: null
    });
  }

  // ─── Dev-only bootstrap ───────────────────────────────────────────────────
  // Mints a session token for the seed tenant user so the local frontend can
  // exercise auth-required routes without going through NextAuth. NEVER ship to
  // production — the response leaks an access token to anyone who can reach this
  // endpoint. Guarded by NODE_ENV !== 'production'.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("_dev/bootstrap")
  async devBootstrap() {
    if (process.env.NODE_ENV === "production") {
      return ok({ error: "disabled in production" });
    }
    let tenant: { id: string; role: string } | undefined;
    for (const u of this.appState.users.values()) {
      if (u.role === "tenant") {
        tenant = { id: u.id, role: u.role };
        break;
      }
    }
    if (!tenant) {
      return ok({ error: "no tenant seed user found" });
    }
    const session = this.appState.createSession(tenant.id);
    return ok({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      user: tenant
    });
  }

  // ─── Dev-only PDF bytes streamer ──────────────────────────────────────────
  // Used by the DevApiSasIssuer-issued SAS URLs so the frontend can open the PDF
  // in a new tab without hitting Azure Blob. PROD: this endpoint is unreachable
  // because AzureSasIssuer issues real Azure-signed URLs and this controller
  // method only resolves when pdfStorage is the InMemoryPdfStorage. Returns 404
  // when the storage isn't in-memory or the blob path is unknown.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("_dev/pdf-bytes/:blobPath")
  async devPdfBytes(@Param("blobPath") blobPath: string, @Res() res: Response) {
    if (!this.pdfStorage || typeof this.pdfStorage.get !== "function") {
      res.status(404).json({ error: "dev pdf-bytes endpoint not available" });
      return;
    }
    const decoded = decodeURIComponent(blobPath);
    const buf = this.pdfStorage.get(decoded);
    if (!buf) {
      res.status(404).json({ error: "blob not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="agreement.pdf"`);
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 3600_000, limit: 30 } })
  @Get(":id/download")
  async claimDownload(@Req() req: AuthedReq, @Param("id") id: string) {
    const result = await this.downloads.claim({
      agreementId: id,
      userId: req.user.id,
      ip: getIp(req),
      userAgent: getUserAgent(req)
    });
    return ok({
      sas_url: result.sasUrl,
      expires_at: result.expiresAt.toISOString(),
      remaining: result.remaining
    });
  }
}
