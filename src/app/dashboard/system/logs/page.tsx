import { supabaseAdmin } from "@/lib/supabase-admin";
import LogsTable from "./logs-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function SystemLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: logs, count } = await supabaseAdmin
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Activity Logs</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {count ?? 0} total events — page {page} of {totalPages || 1}
        </p>
      </div>
      <LogsTable logs={logs ?? []} page={page} totalPages={totalPages || 1} />
    </div>
  );
}
