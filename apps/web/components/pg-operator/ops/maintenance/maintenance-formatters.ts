import type {
  PgMaintenanceCategory,
  PgMaintenanceCommonArea,
  PgMaintenancePriority
} from "@cribliv/shared-types";
import { COMMON_AREA_OPTIONS } from "./maintenance-constants";

const SLA_HOURS_BY_PRIORITY: Record<PgMaintenancePriority, number> = {
  emergency: 4,
  high: 24,
  normal: 72,
  low: 168
};

const PRIORITY_LABEL: Record<PgMaintenancePriority, string> = {
  emergency: "Emergency",
  high: "High",
  normal: "Normal",
  low: "Low"
};

export function formatCommonArea(value: PgMaintenanceCommonArea): string {
  return COMMON_AREA_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function formatMaintenanceSlaHint(category: PgMaintenanceCategory | null): string | null {
  if (!category) return null;
  return `${PRIORITY_LABEL[category.default_priority]} · due in ${
    SLA_HOURS_BY_PRIORITY[category.default_priority]
  }h`;
}
