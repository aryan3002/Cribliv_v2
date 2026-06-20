import { Badge, color, space, typography } from "@cribliv/ui";

const row = {
  display: "flex",
  gap: space.s2,
  alignItems: "center",
  flexWrap: "wrap" as const
};

const card = {
  width: 360,
  padding: space.s5,
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: 16,
  boxSizing: "border-box" as const
};

const eyebrow = {
  fontFamily: typography.fontBody,
  fontSize: typography.scale.caption,
  fontWeight: typography.weight.semibold,
  color: color.textTertiary,
  textTransform: "uppercase" as const,
  letterSpacing: 0.5,
  marginBottom: space.s3
};

/**
 * Every tone with the icon treatment trust pills use across the product —
 * verified (green), pending (amber), the brand "Assured" star, neutral facts,
 * and danger for money owed back.
 */
export function Tones() {
  return (
    <div style={row}>
      <Badge tone="verified">✓ Verified</Badge>
      <Badge tone="pending">Pending</Badge>
      <Badge tone="brand">★ Cribliv Assured</Badge>
      <Badge tone="neutral">Furnished</Badge>
      <Badge tone="danger">Refund due</Badge>
    </div>
  );
}

/**
 * The trust story on a listing card — a verified owner, the Assured program, and
 * the refund guarantee that anchors the Cribliv brand. This is the headline use.
 */
export function TrustSignals() {
  return (
    <div style={card}>
      <div
        style={{
          fontFamily: typography.fontHeading,
          fontSize: typography.scale.h4,
          fontWeight: typography.weight.bold,
          color: color.textPrimary,
          marginBottom: space.s1
        }}
      >
        2 BHK · Sector 50, Gurugram
      </div>
      <div
        style={{
          fontFamily: typography.fontBody,
          fontSize: typography.scale.small,
          color: color.textSecondary,
          marginBottom: space.s3
        }}
      >
        ₹28,000/mo · Furnished · Available now
      </div>
      <div style={row}>
        <Badge tone="verified">✓ Verified owner</Badge>
        <Badge tone="brand">★ Cribliv Assured</Badge>
        <Badge tone="neutral">12-hr refund</Badge>
      </div>
    </div>
  );
}

/**
 * Neutral chips carry listing facts — configuration, amenities, and tenant rules
 * — reading as a calm metadata row beneath the trust signals.
 */
export function ListingFeatures() {
  return (
    <div style={card}>
      <div style={eyebrow}>What this place offers</div>
      <div style={row}>
        <Badge tone="neutral">2 BHK</Badge>
        <Badge tone="neutral">Furnished</Badge>
        <Badge tone="neutral">Pet friendly</Badge>
        <Badge tone="neutral">Bachelors OK</Badge>
        <Badge tone="neutral">Metro · 5 min</Badge>
        <Badge tone="neutral">No brokerage</Badge>
      </div>
    </div>
  );
}

/**
 * The verification lifecycle as a status list — every owner and document moves
 * from pending to verified, and an outstanding deposit surfaces in danger.
 */
export function VerificationStatus() {
  const item = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: `${space.s3}px 0`,
    fontFamily: typography.fontBody,
    fontSize: typography.scale.small,
    color: color.textPrimary
  };
  return (
    <div style={card}>
      <div style={eyebrow}>Owner verification</div>
      <div style={{ ...item, borderBottom: `1px solid ${color.border}`, paddingTop: 0 }}>
        <span>Identity</span>
        <Badge tone="verified">✓ Verified</Badge>
      </div>
      <div style={{ ...item, borderBottom: `1px solid ${color.border}` }}>
        <span>Rental agreement</span>
        <Badge tone="pending">Pending</Badge>
      </div>
      <div style={{ ...item, paddingBottom: 0 }}>
        <span>Security deposit</span>
        <Badge tone="danger">Refund due</Badge>
      </div>
    </div>
  );
}
