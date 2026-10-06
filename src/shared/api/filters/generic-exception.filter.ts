import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { DefaultException, DomainException } from '../../domain/index.js';
import { LogsService } from '../../application/ports/logs.service.js';
import {
  DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE,
  httpMappingOf,
} from '../constants/domain-exceptions-response.constants.js';
import { ErrorResponseDto } from '../dto/error-response.dto.js';
import { ICustomRequest } from '../interfaces/request.interface.js';

const INTERNAL =
  DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE[DefaultException.staticCode];

/**
 * Single error format for the whole API (ErrorResponseDto).
 * - DomainException: status from DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE. 4xx expose the
 *   exception message (useful to the client); 5xx only the generic description.
 * - HttpException (validation, throttling, ...): its own status and message.
 * - Anything else: 500 with a generic description; details go to the logs only.
 */
@Catch()
export class GenericExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LogsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ICustomRequest>();
    const body = this.toBody(exception, request);

    const context = {
      traceId: body.traceId,
      method: request.method,
      path: body.path,
      statusCode: body.statusCode,
      code: body.code,
    };
    if (body.statusCode >= 500) {
      this.logger.error('Request failed', exception, context);
    } else {
      this.logger.warn(body.errorMessageDescription, context);
    }

    http.getResponse<Response>().status(body.statusCode).json(body);
  }

  private toBody(
    exception: unknown,
    request: ICustomRequest,
  ): ErrorResponseDto {
    const base = {
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
      traceId: request.globalTraceId,
    };

    if (exception instanceof DomainException) {
      const mapping = httpMappingOf(exception.constructor);
      const exposeMessage = mapping.statusCode < 500 && exception.message;
      return {
        statusCode: mapping.statusCode,
        code: exception.instanceCode,
        errorMessage: mapping.errorMessage,
        errorMessageDescription: exposeMessage
          ? exception.message
          : mapping.errorMessageDescription,
        ...base,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: `http-${status}`,
        errorMessage: HttpStatus[status] ?? 'Error',
        errorMessageDescription: exception.message,
        ...base,
      };
    }

    return {
      statusCode: INTERNAL.statusCode,
      code: DefaultException.staticCode,
      errorMessage: INTERNAL.errorMessage,
      errorMessageDescription: INTERNAL.errorMessageDescription,
      ...base,
    };
  }
}
