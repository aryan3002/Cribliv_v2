import { Module } from "@nestjs/common";

import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { PgRentInvoicesController } from "./controllers/pg-rent-invoices.controller";
import { PgRentSettingsController } from "./controllers/pg-rent-settings.controller";
import { RentAllocationService } from "./services/rent-allocation.service";
import { RentInvoiceEngineService } from "./services/rent-invoice-engine.service";
import { RentInvoiceService } from "./services/rent-invoice.service";
import { RentPaymentService } from "./services/rent-payment.service";
import { RentReceiptService } from "./services/rent-receipt.service";
import { RentSettingsService } from "./services/rent-settings.service";

// Providers and controllers are appended by later tasks in this plan; the
// arrays start empty so the module can be registered (and AppModule boot
// tested) before any service exists.
@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [PgRentSettingsController, PgRentInvoicesController],
  providers: [
    RentSettingsService,
    RentAllocationService,
    RentInvoiceEngineService,
    RentInvoiceService,
    RentReceiptService,
    RentPaymentService
  ],
  exports: [
    RentSettingsService,
    RentAllocationService,
    RentInvoiceEngineService,
    RentInvoiceService,
    RentReceiptService,
    RentPaymentService
  ]
})
export class PgRentModule {}
