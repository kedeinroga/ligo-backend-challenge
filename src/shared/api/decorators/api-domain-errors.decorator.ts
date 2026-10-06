import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { DomainExceptionClass } from '../../domain/index.js';
import { httpMappingOf } from '../constants/domain-exceptions-response.constants.js';
import { ErrorResponseDto } from '../dto/error-response.dto.js';

/**
 * Documents the error responses of an endpoint from the exceptions it can
 * raise, grouped by status: `@ApiDomainErrors(DataNotFoundException, InsufficientFundsException)`.
 */
export const ApiDomainErrors = (...exceptions: DomainExceptionClass[]) => {
  const byStatus = new Map<number, string[]>();
  for (const exception of exceptions) {
    const status = httpMappingOf(exception).statusCode;
    byStatus.set(status, [
      ...(byStatus.get(status) ?? []),
      exception.staticCode,
    ]);
  }
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ...[...byStatus].map(([status, codes]) =>
      ApiResponse({
        status,
        description: codes.join(', '),
        schema: {
          allOf: [
            { $ref: getSchemaPath(ErrorResponseDto) },
            { properties: { code: { type: 'string', enum: codes } } },
          ],
        },
      }),
    ),
  );
};
