import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { hasFlag } from "@/lib/flags";
import DashboardSidebar from "./sidebar";

// Force dynamic rendering to avoid caching issues
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("users")
    .select("email, flags")
    .eq("id", user.id)
    .single();

  const flags = profile?.flags as Record<string, unknown> | null | undefined;
  const isVip = hasFlag<boolean>(flags, "is_vip", false) === true;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <DashboardSidebar
        userEmail={user.email ?? ""}
        isVip={isVip}
      />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
