---
status: accepted
---

# Use OpenTelemetry SDK with Pino logging

OpenTelemetry SDK and instrumentation provide application telemetry, while Pino is the single application logger and emits structured JSON to stdout with trace and correlation context. The OpenTelemetry Collector exports those signals into LGTM, avoiding a second logging abstraction.
