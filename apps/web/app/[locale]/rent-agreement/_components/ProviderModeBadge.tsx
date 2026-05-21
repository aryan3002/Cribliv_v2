"use client";
import { useEffect, useState } from "react";
import { useFlag } from "@/lib/rent-agreement/flags/flags-provider";

export function ProviderModeBadge() {
  const mock = useFlag("rent_agreement_use_mock_providers");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !mock) return null;
  return <div className="ra-dev-banner">DEV — Mock payment + e-stamp + e-sign. No real money.</div>;
}
