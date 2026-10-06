import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

/** Environment contract. The app refuses to start with an invalid config. */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  PORT = 3000;

  @IsString()
  MONGO_URI = 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';

  @IsString()
  MONGO_DB = 'ligo';

  /** Fail fast when Mongo is unreachable (driver default is 30s). */
  @IsInt()
  @Min(100)
  @Transform(({ value }) => Number(value))
  MONGO_SERVER_SELECTION_TIMEOUT_MS = 5_000;

  /** Per dependency budget of /health/ready (Kubernetes probe timeout is 1s). */
  @IsInt()
  @Min(50)
  @Transform(({ value }) => Number(value))
  HEALTH_CHECK_TIMEOUT_MS = 800;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  THROTTLE_TTL_MS = 60_000;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  THROTTLE_LIMIT = 100;

  /** Comma separated list of origins, or "*". */
  @IsString()
  CORS_ALLOWED_ORIGIN = '*';

  /** Defaults to false in production (set by validateEnv). */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  SWAGGER_ENABLED?: boolean;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n${errors.toString()}`);
  }
  env.SWAGGER_ENABLED ??= env.NODE_ENV !== 'production';
  return env;
}
