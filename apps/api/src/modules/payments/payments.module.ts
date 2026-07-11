import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller";
import { RazorpayOrdersService } from "./razorpay-orders.service";

@Module({
  controllers: [PaymentsController],
  providers: [RazorpayOrdersService],
  exports: [RazorpayOrdersService]
})
export class PaymentsModule {}
