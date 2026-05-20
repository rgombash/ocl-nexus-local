"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase";

export default function LogoutButton() {
  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    // Hard navigation: destroys the Supabase browser-client singleton and all
    // in-memory auth state so the next signIn starts completely fresh.
    // replace() removes /dashboard from history so the back button can't return
    // to a protected page after logout.
    window.location.replace("/login");
  };

  return (
    <button
      onClick={handleLogout}
      className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
    >
      Logout
    </button>
  );
}
