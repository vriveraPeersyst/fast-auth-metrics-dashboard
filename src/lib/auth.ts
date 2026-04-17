import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const allowedGoogleDomain =
  (process.env.ALLOWED_GOOGLE_DOMAIN ?? "peersyst.org").toLowerCase();

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      const hostedDomain = (profile as { hd?: string } | undefined)?.hd?.toLowerCase();
      const emailVerified =
        (profile as { email_verified?: boolean } | undefined)?.email_verified === true;

      return (
        emailVerified &&
        !!email &&
        (email.endsWith(`@${allowedGoogleDomain}`) || hostedDomain === allowedGoogleDomain)
      );
    },
    async jwt({ token, profile }) {
      if (profile?.email) {
        token.email = profile.email;
      }

      return token;
    },
  },
};
