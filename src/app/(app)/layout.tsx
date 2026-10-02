import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import { setupProblems } from "@/lib/config";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (setupProblems().length || !(await isAuthed())) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
