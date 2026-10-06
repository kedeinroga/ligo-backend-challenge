export const CASH_IN_STATUSES = ['pending', 'completed', 'failed'] as const;
export type CashInStatus = (typeof CASH_IN_STATUSES)[number];
