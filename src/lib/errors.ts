export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Thrown by providers. `retryable` failures are retried with backoff; `reconnect` flags the account. */
export class PublishError extends Error {
  retryable: boolean;
  reconnect: boolean;
  constructor(message: string, opts: { retryable?: boolean; reconnect?: boolean } = {}) {
    super(message);
    this.retryable = opts.retryable ?? false;
    this.reconnect = opts.reconnect ?? false;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
