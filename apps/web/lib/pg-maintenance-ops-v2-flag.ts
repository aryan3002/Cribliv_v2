export function isPgMaintenanceOpsV2Enabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2;
  return raw === "true" || raw === "1";
}
