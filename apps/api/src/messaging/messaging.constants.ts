export const INTEGRATION_EVENT_TRANSPORT = Symbol(
  'INTEGRATION_EVENT_TRANSPORT',
);

export const INTEGRATION_EVENTS_EXCHANGE = 'integration.events';

export type RetryPolicy = Readonly<{
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}>;

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
});

export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new TypeError('Retry attempt must be a positive integer');
  }
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

export type IntegrationEventTopology = Readonly<{
  context: string;
  exchange: string;
  queue: string;
  retryQueues: readonly string[];
  deadLetterQueue: string;
  eventTypes: readonly string[];
}>;

export function integrationEventTopology(
  context: string,
  eventTypes: readonly string[],
  retryQueueCount = DEFAULT_RETRY_POLICY.maxAttempts - 1,
): IntegrationEventTopology {
  const normalizedContext = context.trim().toLowerCase();
  if (!normalizedContext) {
    throw new TypeError('RabbitMQ context is required');
  }
  if (retryQueueCount < 1) {
    throw new TypeError('RabbitMQ must have at least one retry queue');
  }

  const queue = `${normalizedContext}.integration.events`;
  return Object.freeze({
    context: normalizedContext,
    exchange: INTEGRATION_EVENTS_EXCHANGE,
    queue,
    retryQueues: Object.freeze(
      Array.from(
        { length: retryQueueCount },
        (_, index) => `${queue}.retry.${index + 1}`,
      ),
    ),
    deadLetterQueue: `${queue}.dlq`,
    eventTypes: Object.freeze([...eventTypes]),
  });
}
