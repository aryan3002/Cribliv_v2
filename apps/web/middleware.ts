import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const locales = ["en", "hi"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    const locale = request.cookies.get("locale")?.value;
    const targetLocale = locale && locales.includes(locale) ? locale : "en";
    return NextResponse.redirect(new URL(`/${targetLocale}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"]
};
