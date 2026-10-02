import { PostDetail } from "@/components/PostDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PostDetail id={(await params).id} />;
}
