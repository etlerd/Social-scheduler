import { route } from "@/lib/api";
import { storageReport } from "@/lib/storage";

export const GET = route(async () => Response.json(storageReport()));
