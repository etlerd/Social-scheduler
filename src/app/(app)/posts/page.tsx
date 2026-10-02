import { Suspense } from "react";
import { PostsView } from "@/components/PostsView";

export default function Page() {
  return (
    <Suspense>
      <PostsView />
    </Suspense>
  );
}
