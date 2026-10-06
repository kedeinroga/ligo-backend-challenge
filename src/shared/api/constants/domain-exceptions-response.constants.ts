import { HttpStatus } from '@nestjs/common';
import {
  AuthenticationException,
  BusinessRuleViolationException,
  ConcurrencyException,
  DataConflictException,
  DataInputException,
  DataNotFoundException,
  DataSourceException,
  DefaultException,
  DomainException,
  ServiceException,
} from '../../domain/index.js';

export interface HttpExceptionMapping {
  statusCode: number;
  errorMessage: string;
  errorMessageDescription: string;
}

/**
 * Every DomainException base class has an entry. Subclasses (e.g.
 * InsufficientFundsException extends BusinessRuleViolationException) inherit
 * the mapping of their closest mapped ancestor but keep their own `code`.
 */
export const DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE: Record<
  string,
  HttpExceptionMapping
> = {
  [DefaultException.staticCode]: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    errorMessage: 'Internal Error',
    errorMessageDescription: 'An unexpected error occurred.',
  },
  [DataSourceException.staticCode]: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    errorMessage: 'Internal Error',
    errorMessageDescription: 'A data store error occurred.',
  },
  [ServiceException.staticCode]: {
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    errorMessage: 'Service Unavailable',
    errorMessageDescription: 'A dependency is unavailable. Retry later.',
  },
  [DataInputException.staticCode]: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorMessage: 'Invalid Request',
    errorMessageDescription: 'The provided data is not valid.',
  },
  [AuthenticationException.staticCode]: {
    statusCode: HttpStatus.UNAUTHORIZED,
    errorMessage: 'Unauthorized',
    errorMessageDescription: 'The caller could not be authenticated.',
  },
  [DataNotFoundException.staticCode]: {
    statusCode: HttpStatus.NOT_FOUND,
    errorMessage: 'Not Found',
    errorMessageDescription: 'The requested resource was not found.',
  },
  [DataConflictException.staticCode]: {
    statusCode: HttpStatus.CONFLICT,
    errorMessage: 'Conflict',
    errorMessageDescription: 'The request conflicts with the current state.',
  },
  [ConcurrencyException.staticCode]: {
    statusCode: HttpStatus.CONFLICT,
    errorMessage: 'Conflict',
    errorMessageDescription:
      'The resource was modified concurrently. Reload and retry.',
  },
  [BusinessRuleViolationException.staticCode]: {
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    errorMessage: 'Unprocessable Entity',
    errorMessageDescription: 'The request violates a business rule.',
  },
};

/** Mapping of an exception class or of its closest mapped ancestor. */
export function httpMappingOf(exceptionClass: unknown): HttpExceptionMapping {
  let ctor = exceptionClass;
  while (typeof ctor === 'function' && ctor !== DomainException) {
    const code = (ctor as { staticCode?: string }).staticCode;
    if (code && DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE[code]) {
      return DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE[code];
    }
    ctor = Object.getPrototypeOf(ctor);
  }
  return DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE[DefaultException.staticCode];
}
