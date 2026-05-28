import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { UserContext } from "./types";

export const AuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  }
);
