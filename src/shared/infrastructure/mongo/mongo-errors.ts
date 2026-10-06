import { MongoError, MongoServerError } from 'mongodb';
import { DataSourceException, DomainException } from '../../domain/index.js';

const DUPLICATE_KEY_CODE = 11000;
const TRANSIENT_TRANSACTION_LABEL = 'TransientTransactionError';

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === DUPLICATE_KEY_CODE;
}

/** A write conflict between two transactions: safe to reload and retry. */
export function isTransientTransactionError(error: unknown): boolean {
  return (
    error instanceof MongoError &&
    error.hasErrorLabel(TRANSIENT_TRANSACTION_LABEL)
  );
}

/**
 * Runs driver work so that no driver error escapes infrastructure: domain
 * exceptions pass through, everything else becomes a DataSourceException.
 */
export async function translateDriverErrors<T>(
  message: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainException) {
      throw error;
    }
    throw new DataSourceException(message, { cause: error });
  }
}
