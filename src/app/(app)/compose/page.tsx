import { Composer } from "@/components/Composer";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return <Composer key={`${q.id ?? ""}${q.duplicate ?? ""}${q.date ?? ""}${q.media ?? ""}`} editId={q.id} duplicateId={q.duplicate} date={q.date} mediaParam={q.media} />;
}
