"use client";

import { signIn } from "next-auth/react";

export function GoogleSignInButton() {
  return (
    <button
      className="actionButton"
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/" })}
    >
      Sign in with Google
    </button>
  );
}
