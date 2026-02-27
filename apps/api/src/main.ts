import "reflect-metadata";
// Load .env before any module is imported so process.env is populated.
// In a pnpm monorepo the root .env lives two directories above apps/api/src (ts-node dev)
// or one above apps/api/dist (compiled prod). We probe both to be safe.
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
{
  const candidates = [
    path.resolve(__dirname, "../../../.env"), // ts-node: apps/api/src → monorepo root
    path.resolve(__dirname, "../../.env"), // compiled: apps/api/dist → apps/api
    path.resolve(process.cwd(), ".env") // fallback: wherever node was started from
  ];
  const envFile = candidates.find((p) => fs.existsSync(p)) ?? ".env";
  dotenv.config({ path: envFile });
}

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { assertVerificationProviderConfig } from "./modules/verification/providers/provider.config";

async function bootstrap() {
  assertVerificationProviderConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix("v1");

  // Security headers (CSP, HSTS, X-Content-Type-Options, etc.)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false // Allow cross-origin images
    })
  );

  // CORS: restrict to known origins (env-configurable)
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key"]
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
}

bootstrap();
