import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ok } from "../../common/response";

@Controller("webhooks")
export class PaymentsController {
  @Post("razorpay")
  razorpay(@Headers("x-razorpay-signature") signature: string | undefined, @Body() payload: any) {
    if (!signature) {
      throw new UnauthorizedException({ code: "invalid_signature", message: "Missing signature" });
    }

    return ok({ received: true, provider: "razorpay", event: payload?.event ?? null });
  }

  @Post("upi")
  upi(@Headers("x-upi-signature") signature: string | undefined, @Body() payload: any) {
    if (!signature) {
      throw new UnauthorizedException({ code: "invalid_signature", message: "Missing signature" });
    }

    return ok({ received: true, provider: "upi", event: payload?.event ?? null });
  }
}
