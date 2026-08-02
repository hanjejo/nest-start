const MAX_FAILURE_REASON_LENGTH = 1_000;

export function safeFailureReason(error: unknown): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : 'Unknown integration event failure';

  return raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '[redacted-connection]')
    .replace(
      /\b(bearer|password|token|secret|authorization)\s*[:=]\s*\S+/gi,
      '$1=[redacted]',
    )
    .slice(0, MAX_FAILURE_REASON_LENGTH);
}
