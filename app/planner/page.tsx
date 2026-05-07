import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ViewShell } from "@/components/views/ViewShell";

export default async function PlannerPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-zinc-50 pt-3 text-zinc-900">
      <ViewShell />
    </main>
  );
}
