import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "@/lib/auth/server";

import {
  apiAuthPrefix,
  apiPlaidWebhookPrefix,
  authRoutes,
  DEFAULT_LOGIN_REDIRECT,
  publicRoutes,
} from "./routes";

export async function proxy(request: NextRequest) {
  const session = getSessionCookie(request);

  const isApiAuth = request.nextUrl.pathname.startsWith(apiAuthPrefix);

  const isPublicRoute = publicRoutes.includes(request.nextUrl.pathname);

  const isAuthRoute = () => {
    return authRoutes.some((path) => request.nextUrl.pathname.startsWith(path));
  };

  if (isApiAuth) {
    return NextResponse.next();
  }

  const isPlaidWebhook = request.nextUrl.pathname.startsWith(
    apiPlaidWebhookPrefix,
  );
  if (isPlaidWebhook) {
    return NextResponse.next();
  }

  if (isAuthRoute()) {
    // The cookie alone is optimistic: a session that expired, was revoked or
    // no longer exists (e.g. a recreated database) still sends one. Checking
    // it here keeps such users from bouncing between /signin and the pages
    // that redirect back to it.
    if (session && (await auth.api.getSession({ headers: request.headers }))) {
      return NextResponse.redirect(
        new URL(DEFAULT_LOGIN_REDIRECT, request.url),
      );
    }
    return NextResponse.next();
  }

  if (!session && !isPublicRoute) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
