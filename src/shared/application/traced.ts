/**
 * Every command and query carries the traceId of the request that created it,
 * as its last constructor parameter: `new OpenAccountCommand(payload, traceId)`.
 */
export interface Traced {
  readonly traceId: string;
}
