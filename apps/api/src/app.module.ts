import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { CoreModule } from "./common/core.module";
import { GuardsModule } from "./common/guards.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { SearchModule } from "./modules/search/search.module";
import { ListingsModule } from "./modules/listings/listings.module";
import { ShortlistModule } from "./modules/shortlist/shortlist.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { OwnerModule } from "./modules/owner/owner.module";
import { VerificationModule } from "./modules/verification/verification.module";
import { PgModule } from "./modules/pg/pg.module";
import { AdminModule } from "./modules/admin/admin.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { AuditModule } from "./modules/audit/audit.module";
import { HealthModule } from "./modules/health/health.module";
import { SalesModule } from "./modules/sales/sales.module";
import { AiModule } from "./modules/ai/ai.module";
import { VoiceModule } from "./modules/voice/voice.module";
import { VoiceAgentModule } from "./modules/voice-agent/voice-agent.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { FraudModule } from "./modules/fraud/fraud.module";
import { BoostModule } from "./modules/boost/boost.module";
import { SubscriptionModule } from "./modules/subscriptions/subscription.module";
import { AlertsModule } from "./modules/alerts/alerts.module";
import { MapModule } from "./modules/map/map.module";

@Module({
  imports: [
    // Global rate limiting: 100 requests per 60 seconds per IP
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    CoreModule,
    GuardsModule,
    AuthModule,
    UsersModule,
    SearchModule,
    ListingsModule,
    ShortlistModule,
    WalletModule,
    ContactsModule,
    OwnerModule,
    VerificationModule,
    PgModule,
    AdminModule,
    PaymentsModule,
    AuditModule,
    HealthModule,
    SalesModule,
    AiModule,
    VoiceModule,
    VoiceAgentModule,
    NotificationsModule,
    AnalyticsModule,
    LeadsModule,
    FraudModule,
    BoostModule,
    SubscriptionModule,
    AlertsModule,
    MapModule
  ],
  providers: [
    // Apply ThrottlerGuard globally to all routes
    { provide: APP_GUARD, useClass: ThrottlerGuard }
  ]
})
export class AppModule {}
