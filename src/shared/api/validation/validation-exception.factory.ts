import { ValidationError } from '@nestjs/common';
import { DataInputException } from '../../domain/index.js';

/**
 * Flattens class-validator errors into readable messages. class-validator
 * already starts each message with the property name, so only nested fields
 * get their parent path: "address.street must be a string".
 */
export function validationMessages(
  errors: ValidationError[],
  parentPath = '',
): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}).map(
      (message) => `${parentPath}${message}`,
    ),
    ...validationMessages(
      error.children ?? [],
      `${parentPath}${error.property}.`,
    ),
  ]);
}

/** ValidationPipe errors are DomainExceptions too: one error format (400). */
export function validationExceptionFactory(
  errors: ValidationError[],
): DataInputException {
  return new DataInputException(validationMessages(errors).join('; '));
}
