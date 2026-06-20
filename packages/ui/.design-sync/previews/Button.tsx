import { Button, color, space, typography } from "@cribliv/ui";

const row = {
  display: "flex",
  gap: space.s3,
  alignItems: "center",
  flexWrap: "wrap" as const
};

/**
 * The three button variants. Primary (coral accent) is reserved for the single
 * most important action on a screen; secondary (brand-blue outline) and tertiary
 * (text-only) carry supporting actions.
 */
export function Variants() {
  return (
    <div style={row}>
      <Button variant="primary">Book a visit</Button>
      <Button variant="secondary">Save listing</Button>
      <Button variant="tertiary">Share</Button>
    </div>
  );
}

/**
 * The hero call-to-action: a full-width primary anchored to a listing card or a
 * mobile action bar — the one coral action per screen.
 */
export function PrimaryCallToAction() {
  return (
    <div
      style={{
        width: 360,
        padding: space.s5,
        background: color.surface,
        borderRadius: 16,
        border: `1px solid ${color.border}`,
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          fontFamily: typography.fontBody,
          fontSize: typography.scale.small,
          color: color.textSecondary,
          marginBottom: space.s3
        }}
      >
        ₹28,000/mo · 2 BHK in Sector 50, Gurugram
      </div>
      <Button variant="primary" style={{ width: "100%" }}>
        Request to book
      </Button>
    </div>
  );
}

/**
 * Supporting actions paired without a primary — secondary for a reversible
 * action, tertiary for low-emphasis navigation.
 */
export function InlineActions() {
  return (
    <div style={row}>
      <Button variant="secondary">Message owner</Button>
      <Button variant="tertiary">View on map</Button>
    </div>
  );
}
