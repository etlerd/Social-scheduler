import { PublishError } from "../errors";

/** fetch wrapper: network failures become retryable PublishErrors. */
export async function call(url: string, init?: RequestInit & { duplex?: "half" }): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new PublishError(`Network error: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
  }
}

export async function bodyJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
