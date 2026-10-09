import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const GUEST_COOKIE = "bci_guest_access";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (session) return NextResponse.next();

  const guest = request.cookies.get(GUEST_COOKIE)?.value === "1";
  const memberOnly = request.nextUrl.pathname.startsWith("/my-schedule") || request.nextUrl.pathname.startsWith("/registration") || request.nextUrl.pathname.startsWith("/notifications") || request.nextUrl.pathname.startsWith("/tasks/") || request.nextUrl.pathname.startsWith("/graph");
  if (guest && !memberOnly) return NextResponse.next();
  if (guest && memberOnly) return NextResponse.redirect(new URL("/dashboard", request.url));

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/my-schedule/:path*",
    "/availability/:path*",
    "/members/:path*",
    "/groups/:path*",
    "/registration/:path*",
    "/tasks/:path*",
    "/notifications/:path*",
    "/graph/:path*",
  ],
};
