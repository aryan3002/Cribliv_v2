"use client";
import { useFlag } from "@/lib/rent-agreement/flags/flags-provider";

export function ProviderModeBadge() {
  const mock = useFlag("rent_agreement_use_mock_providers");
  if (!mock) return null;
  return (
    <div className="bg-yellow-100 border-b border-yellow-300 text-yellow-900 text-xs px-3 py-1">
      DEV — Mock payment + e-stamp + e-sign. No real money.
    </div>
  );
}
