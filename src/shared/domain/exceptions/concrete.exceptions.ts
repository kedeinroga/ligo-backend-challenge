import { DomainException } from './domain.exception.js';

/** Unexpected error with no better classification (500). */
export class DefaultException extends DomainException {
  static override readonly staticCode: string = 'default-exception';
  readonly instanceCode: string = DefaultException.staticCode;
}

/** A data store failed (500). */
export class DataSourceException extends DomainException {
  static override readonly staticCode: string = 'data-source-exception';
  readonly instanceCode: string = DataSourceException.staticCode;
}

/** An external service (broker, provider) failed or is unavailable (503). */
export class ServiceException extends DomainException {
  static override readonly staticCode: string = 'service-exception';
  readonly instanceCode: string = ServiceException.staticCode;
}

/** Invalid input: malformed value, failed validation (400). */
export class DataInputException extends DomainException {
  static override readonly staticCode: string = 'data-input-exception';
  readonly instanceCode: string = DataInputException.staticCode;
}

/** The requested resource does not exist (404). */
export class DataNotFoundException extends DomainException {
  static override readonly staticCode: string = 'data-not-found-exception';
  readonly instanceCode: string = DataNotFoundException.staticCode;
}

/** The request conflicts with the current state, e.g. a duplicate (409). */
export class DataConflictException extends DomainException {
  static override readonly staticCode: string = 'data-conflict-exception';
  readonly instanceCode: string = DataConflictException.staticCode;
}

/** The aggregate changed since it was loaded: optimistic concurrency (409). */
export class ConcurrencyException extends DataConflictException {
  static override readonly staticCode: string = 'concurrency-exception';
  override readonly instanceCode: string = ConcurrencyException.staticCode;
}

/** A business invariant would be broken, e.g. insufficient funds (422). */
export class BusinessRuleViolationException extends DomainException {
  static override readonly staticCode: string =
    'business-rule-violation-exception';
  readonly instanceCode: string = BusinessRuleViolationException.staticCode;
}
