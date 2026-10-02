import { Suspense } from "react";
import { AccountsView } from "@/components/AccountsView";

export default function Page() {
  return (
    <Suspense>
      <AccountsView />
    </Suspense>
  );
}
