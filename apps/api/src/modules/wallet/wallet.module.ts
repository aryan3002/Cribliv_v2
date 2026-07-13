import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { WalletController } from "./wallet.controller";
import { WalletPurchaseService } from "./wallet-purchase.service";

export { debitWalletCredits, expireSignupCredits, WalletBalanceError } from "./wallet-balance";

@Module({
  imports: [PaymentsModule],
  controllers: [WalletController],
  providers: [WalletPurchaseService],
  exports: [WalletPurchaseService]
})
export class WalletModule {}
