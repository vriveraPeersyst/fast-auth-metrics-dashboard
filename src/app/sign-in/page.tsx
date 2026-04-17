import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { allowedGoogleDomain, authOptions } from "@/lib/auth";

export default async function SignInPage() {
  const session = await getServerSession(authOptions);

  if (session?.user?.email?.toLowerCase().endsWith(`@${allowedGoogleDomain}`)) {
    redirect("/");
  }

  return (
    <main className="signInRoot">
      <section className="signInCard">
        <p className="kicker">FastAuth Metrics</p>
        <h1>Private Dashboard Access</h1>
        <p>
          This dashboard only accepts Google accounts from the {allowedGoogleDomain} domain.
        </p>
        <GoogleSignInButton />
      </section>
    </main>
  );
}
