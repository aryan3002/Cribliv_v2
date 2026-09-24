import { Module } from "@nestjs/common";

import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { AzureSasIssuer } from "../rent-agreement/downloads/azure-sas-issuer";
import { DevApiSasIssuer } from "../rent-agreement/downloads/dev-api-sas-issuer";
import { AzurePdfStorage } from "../rent-agreement/pdf/azure-pdf-storage";
import {
  buildAzureConnectionString,
  readAzureStorageConfig
} from "../rent-agreement/pdf/azure-storage-config";
import { InMemoryPdfStorage } from "../rent-agreement/pdf/in-memory-pdf-storage";
import { PgRentInvoicesController } from "./controllers/pg-rent-invoices.controller";
import { PgRentPaymentsController } from "./controllers/pg-rent-payments.controller";
import { PgRentSettingsController } from "./controllers/pg-rent-settings.controller";
import { PgRentSettlementController } from "./controllers/pg-rent-settlement.controller";
import { PgRentTenantClaimsController } from "./controllers/pg-rent-tenant-claims.controller";
import { receiptContainer as RECEIPT_CONTAINER } from "./receipt/receipt-container";
import { LazyReceiptRenderer } from "./receipt/receipt-renderer";
import { RentAllocationService } from "./services/rent-allocation.service";
import { RentInvoiceEngineService } from "./services/rent-invoice-engine.service";
import { RentInvoiceService } from "./services/rent-invoice.service";
import { RentPaymentService } from "./services/rent-payment.service";
import {
  PG_RENT_PDF_STORAGE,
  PG_RENT_RECEIPT_RENDERER,
  PG_RENT_SAS_ISSUER,
  RentReceiptService
} from "./services/rent-receipt.service";
import { RentSettingsService } from "./services/rent-settings.service";
import { RentSettlementService } from "./services/rent-settlement.service";
import { RentMessageService } from "./services/rent-message.service";
import { RentPayInstructionService } from "./services/rent-pay-instruction.service";
import { RentQueueService } from "./services/rent-queue.service";

@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [
    PgRentSettingsController,
    PgRentInvoicesController,
    PgRentPaymentsController,
    PgRentSettlementController,
    PgRentTenantClaimsController
  ],
  providers: [
    RentSettingsService,
    RentAllocationService,
    RentInvoiceEngineService,
    RentInvoiceService,
    RentReceiptService,
    RentPaymentService,
    RentSettlementService,
    RentPayInstructionService,
    RentMessageService,
    RentQueueService,
    { provide: PG_RENT_RECEIPT_RENDERER, useFactory: () => new LazyReceiptRenderer() },
    {
      provide: PG_RENT_PDF_STORAGE,
      useFactory: () => {
        const azure = readAzureStorageConfig();
        return azure.present
          ? new AzurePdfStorage({
              connectionString: buildAzureConnectionString(azure.accountName, azure.accountKey),
              containerName: RECEIPT_CONTAINER()
            })
          : new InMemoryPdfStorage();
      }
    },
    {
      provide: PG_RENT_SAS_ISSUER,
      useFactory: () => {
        const azure = readAzureStorageConfig();
        return azure.present
          ? new AzureSasIssuer({
              accountName: azure.accountName,
              accountKey: azure.accountKey,
              containerName: RECEIPT_CONTAINER()
            })
          : new DevApiSasIssuer({ baseUrl: process.env.RENT_AGREEMENT_DEV_BASE_URL ?? "" });
      }
    }
  ],
  exports: [
    RentSettingsService,
    RentAllocationService,
    RentInvoiceEngineService,
    RentInvoiceService,
    RentReceiptService,
    RentPaymentService,
    RentSettlementService
  ]
})
export class PgRentModule {}
