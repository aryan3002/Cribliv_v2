export function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/(?:^|\s|-)\S/g, (match) => match.toUpperCase());
}

export const VERIFICATION_LABELS: Record<string, string> = {
  unverified: "Unverified",
  pending: "Verification Pending",
  verified: "Verified",
  failed: "Verification Failed"
};
