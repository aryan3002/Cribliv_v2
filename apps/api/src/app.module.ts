import { Module } from "@nestjs/common";
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

@Module({
  imports: [
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
    HealthModule
  ]
})
export class AppModule {}
