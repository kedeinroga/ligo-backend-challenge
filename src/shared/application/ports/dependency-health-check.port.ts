/** A dependency the service needs to receive traffic (database, cache, broker). */
export abstract class DependencyHealthCheck {
  abstract readonly name: string;
  /** Resolves when the dependency is reachable, rejects otherwise. */
  abstract check(): Promise<void>;
}

/**
 * The checks enabled for this deployment (built by the infrastructure module)
 * and the time budget of each one: a hung dependency must report `down`
 * before the Kubernetes probe times out.
 */
export class DependencyHealthChecks {
  constructor(
    readonly checks: readonly DependencyHealthCheck[],
    readonly timeoutMs: number,
  ) {}
}
