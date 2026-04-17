"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button className="ghostButton" type="button" onClick={() => signOut({ callbackUrl: "/sign-in" })}>
      Sign out
    </button>
  );
}
