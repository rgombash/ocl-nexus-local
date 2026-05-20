import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import ConfigManagerClient from "./config-manager-client";

export const metadata = {
  title: "Configuration Vault | OCL Nexus Local",
  description: "Manage encrypted environment variables and configuration sets",
};

export default async function ConfigManagerPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <ConfigManagerClient />;
}
