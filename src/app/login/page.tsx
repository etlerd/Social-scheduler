import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import { setupProblems } from "@/lib/config";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const problems = setupProblems();
  if (!problems.length && (await isAuthed())) redirect("/");
  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={40} height={40} />
          <span className="text-xl font-semibold">Social Scheduler</span>
        </div>
        {problems.length ? (
          <div className="card p-5 text-sm">
            <p className="font-medium mb-2">Server setup needed</p>
            <ul className="list-disc pl-5 text-muted space-y-1">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <p className="text-muted mt-3">Copy <code>.env.example</code> to <code>.env.local</code>, fill it in, and restart.</p>
          </div>
        ) : (
          <LoginForm />
        )}
      </div>
    </div>
  );
}
