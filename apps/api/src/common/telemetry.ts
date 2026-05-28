export function logTelemetry(event: string, payload: Record<string, unknown>) {
  // Keep telemetry as JSON for easy ingestion by log routers.
  console.log(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...payload
    })
  );
}
