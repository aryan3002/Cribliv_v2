import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { WalletController } from "./wallet.controller";
import { WalletPurchaseService } from "./wallet-purchase.service";

@Module({
  imports: [PaymentsModule],
  controllers: [WalletController],
  providers: [WalletPurchaseService],
  exports: [WalletPurchaseService]
})
export class WalletModule {}
