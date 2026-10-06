/**
 * Base class of every exception raised by the domain and the application.
 *
 * - `staticCode` (static): stable, kebab-case code of the class. It is the key of
 *   DOMAIN_EXCEPTIONS_TO_HTTP_RESPONSE and the `code` returned to clients.
 * - `instanceCode`: the same code, readable from an instance.
 *
 * The HTTP layer maps codes to status codes; the domain never knows about HTTP.
 */
export abstract class DomainException extends Error {
  static readonly staticCode: string = 'domain-exception';
  abstract readonly instanceCode: string;

  constructor(message = '', options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export type DomainExceptionClass = (abstract new (
  ...args: never[]
) => DomainException) & { staticCode: string };
