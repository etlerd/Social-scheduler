import { route } from "@/lib/api";
import { overview } from "@/lib/posts";

export const GET = route(async () => Response.json(overview()));
