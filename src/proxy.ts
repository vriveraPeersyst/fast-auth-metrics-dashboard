import { withAuth } from "next-auth/middleware";

const allowedDomain = (process.env.ALLOWED_GOOGLE_DOMAIN ?? "peersyst.org").toLowerCase();

export default withAuth({
  callbacks: {
    authorized: ({ token }) => {
      const email = token?.email?.toLowerCase();
      return !!email && email.endsWith(`@${allowedDomain}`);
    },
  },
  pages: {
    signIn: "/sign-in",
  },
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sign-in).*)"],
};
