import { useState, useEffect } from "react";

// ─── Brand Colors ────────────────────────────────────────────────
const T  = "#00A99D"; // Teal (brand)
const TL = "#E8F8F7"; // Teal light
const TD = "#007A73"; // Teal dark
const AM = "#F59E0B"; // Amber
const GN = "#10B981"; // Green
const RD = "#EF4444"; // Red
const BG = "#F4F6F9"; // App background
const WH = "#FFFFFF";
const GR = "#6B7280"; // Gray
const DK = "#1F2937"; // Dark text
const LG = "#E5E7EB"; // Light gray border

// ─── Helpers ─────────────────────────────────────────────────────
const Chip = ({ label, active, color = T, onPress, closeable, small }) => (
  <div onClick={onPress} style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: small ? "3px 10px" : "5px 14px",
    borderRadius: 20,
    background: active ? color : WH,
    border: `1.5px solid ${active ? color : LG}`,
    color: active ? WH : DK,
    fontSize: small ? 11 : 12, fontWeight: 500,
    cursor: onPress ? "pointer" : "default",
    whiteSpace: "nowrap", userSelect: "none",
  }}>
    {label}
    {closeable && <span style={{ opacity: 0.7, fontSize: 10 }}>✕</span>}
  </div>
);

const Badge = ({ label, color = GN }) => (
  <span style={{
    padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700,
    background: color + "22", color: color, border: `1px solid ${color}44`,
  }}>{label}</span>
);

const Btn = ({ label, full, secondary, small, disabled, onPress, color = T }) => (
  <div onClick={!disabled ? onPress : undefined} style={{
    padding: small ? "8px 18px" : "13px 24px",
    borderRadius: 12,
    background: secondary ? WH : disabled ? "#D1D5DB" : color,
    border: secondary ? `1.5px solid ${LG}` : "none",
    color: secondary ? DK : disabled ? "#9CA3AF" : WH,
    fontWeight: 600, fontSize: small ? 13 : 15,
    textAlign: "center", cursor: disabled ? "not-allowed" : "pointer",
    width: full ? "100%" : "auto",
    userSelect: "none",
    transition: "opacity 0.15s",
  }}>{label}</div>
);

const Divider = ({ m = 8 }) => (
  <div style={{ height: 1, background: LG, margin: `${m}px 0` }} />
);

const Avatar = ({ name = "R", size = 36, color = T }) => (
  <div style={{
    width: size, height: size, borderRadius: size / 2,
    background: color, color: WH,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: size * 0.4,
  }}>{name[0].toUpperCase()}</div>
);

// ─── Status Bar ──────────────────────────────────────────────────
function StatusBar({ light }) {
  const c = light ? WH : DK;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 20px 2px" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: c }}>9:41</span>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          {[0,3,6,9].map((x,i) => <rect key={i} x={x} y={9-(i+1)*2} width="2.5" height={(i+1)*2} rx="0.5" fill={c}/>)}
        </svg>
        <svg width="18" height="11" viewBox="0 0 18 11" fill="none">
          <rect x="0.5" y="0.5" width="14" height="10" rx="2" stroke={c} strokeWidth="1.2"/>
          <rect x="15" y="3.5" width="2.5" height="4" rx="1" fill={c}/>
          <rect x="1.5" y="1.5" width="10" height="8" rx="1.5" fill={c}/>
        </svg>
      </div>
    </div>
  );
}

// ─── Bottom Nav (Tenant) ─────────────────────────────────────────
function BottomNav({ active = 0, onTab }) {
  const tabs = [
    { icon: "🏠", label: "Home" }, { icon: "🔍", label: "Search" },
    { icon: "❤️", label: "Shortlist" }, { icon: "💬", label: "Messages" },
    { icon: "👤", label: "Profile" },
  ];
  return (
    <div style={{ display: "flex", background: WH, borderTop: `1px solid ${LG}`, paddingBottom: 2 }}>
      {tabs.map((t, i) => (
        <div key={i} onClick={() => onTab && onTab(i)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          padding: "8px 0 4px", cursor: "pointer",
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: 9, color: i === active ? T : GR, fontWeight: i === active ? 700 : 400, marginTop: 2 }}>
            {t.label}
          </span>
          {i === active && <div style={{ width: 4, height: 4, borderRadius: 2, background: T, marginTop: 2 }}/>}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-01: Onboarding — Role Selection
// ═══════════════════════════════════════════════════════════════
function WF01_RoleSelection() {
  const [role, setRole] = useState(null);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: WH, overflow: "hidden" }}>
      <StatusBar />
      {/* Logo */}
      <div style={{ padding: "28px 24px 16px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: T, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 18 }}>🏡</span>
          </div>
          <span style={{ fontSize: 22, fontWeight: 800, color: DK }}>Crib<span style={{ color: T }}>liv</span></span>
        </div>
        <p style={{ fontSize: 13, color: GR, margin: 0 }}>Where Your Perfect Home Finds You</p>
      </div>

      <div style={{ padding: "0 20px", flex: 1 }}>
        <p style={{ fontSize: 17, fontWeight: 700, color: DK, textAlign: "center", marginBottom: 6 }}>I am a...</p>
        <p style={{ fontSize: 13, color: GR, textAlign: "center", marginBottom: 20 }}>Select your role to get started</p>

        {/* Owner Card */}
        <div onClick={() => setRole("owner")} style={{
          border: `2.5px solid ${role === "owner" ? T : LG}`,
          borderRadius: 16, padding: 20, marginBottom: 14, cursor: "pointer",
          background: role === "owner" ? TL : WH,
          transition: "all 0.2s",
          boxShadow: role === "owner" ? `0 4px 16px ${T}33` : "0 2px 8px #0001",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: role === "owner" ? T : "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🏘️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: DK, marginBottom: 3 }}>I own a property</div>
              <div style={{ fontSize: 12, color: GR }}>List, verify and manage your properties</div>
            </div>
            <div style={{ width: 22, height: 22, borderRadius: 11, border: `2px solid ${role === "owner" ? T : LG}`, display: "flex", alignItems: "center", justifyContent: "center", background: role === "owner" ? T : WH }}>
              {role === "owner" && <span style={{ color: WH, fontSize: 12 }}>✓</span>}
            </div>
          </div>
        </div>

        {/* Tenant Card */}
        <div onClick={() => setRole("tenant")} style={{
          border: `2.5px solid ${role === "tenant" ? T : LG}`,
          borderRadius: 16, padding: 20, cursor: "pointer",
          background: role === "tenant" ? TL : WH,
          transition: "all 0.2s",
          boxShadow: role === "tenant" ? `0 4px 16px ${T}33` : "0 2px 8px #0001",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: role === "tenant" ? T : "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🔍</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: DK, marginBottom: 3 }}>I'm looking for a home</div>
              <div style={{ fontSize: 12, color: GR }}>Browse, pay rent, manage tenancy</div>
            </div>
            <div style={{ width: 22, height: 22, borderRadius: 11, border: `2px solid ${role === "tenant" ? T : LG}`, display: "flex", alignItems: "center", justifyContent: "center", background: role === "tenant" ? T : WH }}>
              {role === "tenant" && <span style={{ color: WH, fontSize: 12 }}>✓</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 24px 8px" }}>
        <Btn label="Continue →" full disabled={!role} />
        <p style={{ fontSize: 10, color: GR, textAlign: "center", marginTop: 10 }}>
          By continuing, you agree to Cribliv's <span style={{ color: T }}>Terms of Service</span> and <span style={{ color: T }}>Privacy Policy</span>
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-02: Owner Dashboard
// ═══════════════════════════════════════════════════════════════
function WF02_OwnerDashboard() {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);
  const listings = [
    { id: 1, addr: "42 MG Road, Gomti Nagar", bhk: "3 BHK", rent: "₹18,000", status: "Verified", color: GN },
    { id: 2, addr: "7 Civil Lines, Flat 2B", bhk: "2 BHK", rent: "₹12,500", status: "Unverified", color: AM },
  ];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: BG, overflow: "hidden" }}>
      <div style={{ background: T, paddingBottom: 12 }}>
        <StatusBar light />
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px 4px" }}>
          <Avatar name="Ramesh" size={38} color={TD} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "#ffffffaa" }}>Good morning,</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: WH }}>Ramesh Gupta</div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ width: 36, height: 36, borderRadius: 18, background: "#ffffff22", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18 }}>🔔</div>
            <div style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: 7, background: RD, border: "2px solid " + T, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: WH, fontWeight: 700 }}>3</div>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: "#ffffff22", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16 }}>⚙️</div>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 8, padding: "10px 16px 2px" }}>
          {[
            { label: "Listings", val: "2", icon: "🏠" },
            { label: "Inquiries", val: "5", icon: "💬" },
            { label: "Rent Due", val: "₹24K", icon: "💰" },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, background: "#ffffff22", borderRadius: 12, padding: "8px 10px", cursor: "pointer", textAlign: "center" }}>
              <div style={{ fontSize: 16 }}>{s.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: WH }}>{s.val}</div>
              <div style={{ fontSize: 9, color: "#ffffffaa" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {/* Action Banner */}
        {!bannerDismissed && (
          <div style={{ background: AM + "18", border: `1px solid ${AM}44`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div style={{ flex: 1, fontSize: 12, color: DK }}>
              Complete verification for <strong>7 Civil Lines</strong> to get more inquiries →
            </div>
            <div onClick={() => setBannerDismissed(true)} style={{ color: GR, cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</div>
          </div>
        )}

        {/* Listings */}
        <div style={{ fontWeight: 700, fontSize: 14, color: DK, marginBottom: 10 }}>My Listings</div>
        {listings.map(l => (
          <div key={l.id} style={{ background: WH, borderRadius: 14, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px #0001" }}>
            <div style={{ height: 100, background: `linear-gradient(135deg, ${T}44, ${T}22)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🏢</div>
            <div style={{ padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: DK }}>{l.addr}</div>
                  <div style={{ fontSize: 11, color: GR, marginTop: 2 }}>{l.bhk} · {l.rent}/mo</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge label={l.status} color={l.color} />
                  <div onClick={() => setMenuOpen(menuOpen === l.id ? null : l.id)} style={{ cursor: "pointer", fontSize: 18, color: GR }}>⋮</div>
                </div>
              </div>
              {menuOpen === l.id && (
                <div style={{ marginTop: 10, border: `1px solid ${LG}`, borderRadius: 10, overflow: "hidden" }}>
                  {["✏️ Edit Listing", "✅ Mark as Rented", "🚫 Deactivate"].map((item, i) => (
                    <div key={i} onClick={() => setMenuOpen(null)} style={{ padding: "10px 14px", fontSize: 13, color: i === 2 ? RD : DK, cursor: "pointer", borderBottom: i < 2 ? `1px solid ${LG}` : "none" }}>{item}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* FAB */}
      <div style={{ position: "absolute", right: 20, bottom: 42, width: 52, height: 52, borderRadius: 26, background: T, boxShadow: `0 4px 16px ${T}55`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10 }}>
        <span style={{ fontSize: 26, color: WH, lineHeight: 1 }}>+</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-03: Listing Creation — Photo-First Flow
// ═══════════════════════════════════════════════════════════════
function WF03_ListingCreation() {
  const [step, setStep] = useState(1);
  const [photos, setPhotos] = useState(1);
  const [propType, setPropType] = useState(null);
  const [bhk, setBhk] = useState(null);
  const [aiGenerated, setAiGenerated] = useState(false);

  const totalSteps = 5;
  const stepLabels = ["Photos", "Type", "Details", "Description", "Review"];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: BG, overflow: "hidden" }}>
      <div style={{ background: WH, borderBottom: `1px solid ${LG}` }}>
        <StatusBar />
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px 12px" }}>
          {step > 1 && <div onClick={() => setStep(s => s - 1)} style={{ cursor: "pointer", fontSize: 20 }}>←</div>}
          <div style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 15, color: DK }}>List a Property</div>
          <div style={{ fontSize: 12, color: GR }}>{step}/{totalSteps}</div>
        </div>
        {/* Progress dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, paddingBottom: 12 }}>
          {stepLabels.map((l, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: i + 1 <= step ? 20 : 8, height: 6, borderRadius: 3, background: i + 1 <= step ? T : LG, transition: "all 0.3s" }} />
              <span style={{ fontSize: 8, color: i + 1 === step ? T : GR, fontWeight: i + 1 === step ? 700 : 400 }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {/* STEP 1: Photos */}
        {step === 1 && (
          <div>
            <div style={{ background: "#1F293711", borderRadius: 16, height: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", marginBottom: 16, border: `2px dashed ${T}66` }}>
              <div style={{ fontSize: 36, marginBottom: 6 }}>📸</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: DK }}>Add Property Photos</div>
              <div style={{ fontSize: 12, color: GR, marginTop: 2 }}>Minimum 3 required · Tap to add</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Array.from({ length: photos }).map((_, i) => (
                <div key={i} style={{ width: 72, height: 72, borderRadius: 10, background: `hsl(${170 + i * 20},40%,75%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏠</div>
              ))}
              {photos < 6 && (
                <div onClick={() => setPhotos(p => p + 1)} style={{ width: 72, height: 72, borderRadius: 10, border: `2px dashed ${T}88`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 24, color: T }}>+</div>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: photos >= 3 ? GN : AM }}>
              {photos >= 3 ? `✓ ${photos} photos added` : `${photos}/3 minimum photos`}
            </div>
          </div>
        )}

        {/* STEP 2: Property Type */}
        {step === 2 && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: DK, marginBottom: 6 }}>What kind of property?</div>
            <div style={{ fontSize: 13, color: GR, marginBottom: 20 }}>Choose the type that best describes your listing</div>
            {[
              { type: "flat", icon: "🏢", label: "House / Flat", desc: "Apartment, independent house, villa" },
              { type: "pg", icon: "🛏️", label: "PG / Hostel", desc: "Paying guest, hostel, shared living" },
            ].map(p => (
              <div key={p.type} onClick={() => setPropType(p.type)} style={{
                border: `2.5px solid ${propType === p.type ? T : LG}`,
                borderRadius: 14, padding: "18px 20px", marginBottom: 12, cursor: "pointer",
                background: propType === p.type ? TL : WH,
                display: "flex", gap: 14, alignItems: "center",
              }}>
                <span style={{ fontSize: 32 }}>{p.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: DK }}>{p.label}</div>
                  <div style={{ fontSize: 12, color: GR }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* STEP 3: Basic Details */}
        {step === 3 && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DK, marginBottom: 16 }}>Property Details</div>
            {/* Location */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: DK, marginBottom: 6 }}>Location</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: WH, border: `1.5px solid ${LG}`, borderRadius: 10, padding: "10px 14px" }}>
                <span style={{ fontSize: 16 }}>📍</span>
                <input placeholder="Search area / locality" style={{ flex: 1, border: "none", outline: "none", fontSize: 13, color: DK, background: "transparent" }} defaultValue="Gomti Nagar, Lucknow" />
                <span style={{ fontSize: 14 }}>🎯</span>
              </div>
            </div>
            {/* BHK */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: DK, marginBottom: 6 }}>BHK Configuration</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["1", "2", "3", "4+"].map(b => (
                  <div key={b} onClick={() => setBhk(b)} style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, textAlign: "center",
                    background: bhk === b ? T : WH, color: bhk === b ? WH : DK,
                    border: `1.5px solid ${bhk === b ? T : LG}`, cursor: "pointer",
                    fontWeight: 600, fontSize: 14,
                  }}>{b}</div>
                ))}
              </div>
            </div>
            {/* Rent & Deposit */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              {[{ label: "Monthly Rent (₹)", placeholder: "18000" }, { label: "Security Deposit (₹)", placeholder: "36000" }].map((f, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: DK, marginBottom: 5 }}>{f.label}</div>
                  <input defaultValue={f.placeholder} style={{ width: "100%", border: `1.5px solid ${LG}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, color: DK, outline: "none", boxSizing: "border-box", background: WH }} />
                </div>
              ))}
            </div>
            {/* Available From */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: DK, marginBottom: 5 }}>Available From</div>
              <div style={{ background: WH, border: `1.5px solid ${LG}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>📅</span>
                <span style={{ fontSize: 13, color: DK }}>April 1, 2026</span>
                <span style={{ marginLeft: "auto", fontSize: 16, color: GR }}>▾</span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Description */}
        {step === 4 && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DK, marginBottom: 4 }}>Describe your property</div>
            <div style={{ fontSize: 12, color: GR, marginBottom: 14 }}>Help tenants know what makes your place special</div>
            <div onClick={() => setAiGenerated(true)} style={{
              background: `linear-gradient(135deg, ${T}11, ${T}22)`,
              border: `1.5px solid ${T}55`, borderRadius: 12, padding: "12px 16px",
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 12,
            }}>
              <span style={{ fontSize: 22 }}>✨</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: T }}>AI Generate Description</div>
                <div style={{ fontSize: 11, color: GR }}>Let AI craft a great listing description</div>
              </div>
            </div>
            <textarea
              defaultValue={aiGenerated ? "Spacious 3 BHK apartment in the heart of Gomti Nagar, Lucknow. This well-maintained flat features modern interiors, ample natural light, and easy access to major amenities including schools, hospitals, and shopping centres. Ideal for a small family or working professionals. Semi-furnished with modular kitchen, built-in wardrobes, and reserved parking." : ""}
              placeholder="Describe your property — neighbourhood, amenities, nearby places..."
              style={{ width: "100%", height: 140, border: `1.5px solid ${LG}`, borderRadius: 10, padding: 12, fontSize: 12, color: DK, resize: "none", outline: "none", boxSizing: "border-box", background: WH, lineHeight: 1.6 }}
            />
            <div style={{ fontSize: 11, color: GR, marginTop: 4, textAlign: "right" }}>Min. 100 characters required</div>
          </div>
        )}

        {/* STEP 5: Review */}
        {step === 5 && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DK, marginBottom: 14 }}>Review your listing</div>
            <div style={{ background: WH, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 10px #0001", marginBottom: 16 }}>
              <div style={{ height: 130, background: `linear-gradient(135deg, ${T}44, ${T}22)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 50 }}>🏢</div>
              <div style={{ padding: 14 }}>
                {[
                  { icon: "📍", label: "Location", val: "Gomti Nagar, Lucknow" },
                  { icon: "🏠", label: "Type", val: "3 BHK Flat" },
                  { icon: "💰", label: "Rent", val: "₹18,000 / month" },
                  { icon: "🔒", label: "Deposit", val: "₹36,000" },
                  { icon: "📅", label: "Available", val: "April 1, 2026" },
                ].map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 14 }}>{r.icon}</span>
                    <span style={{ fontSize: 12, color: GR, width: 70 }}>{r.label}</span>
                    <span style={{ fontSize: 12, color: DK, fontWeight: 500 }}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "10px 20px 8px", background: WH, borderTop: `1px solid ${LG}` }}>
        {step < 5
          ? <Btn label={`Continue →`} full disabled={step === 1 && photos < 3 || step === 2 && !propType} onPress={() => setStep(s => s + 1)} />
          : <div>
              <Btn label="Submit Listing 🎉" full />
              <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: T, cursor: "pointer" }}>Save as Draft</div>
            </div>
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-04: Verification Flow
// ═══════════════════════════════════════════════════════════════
function WF04_Verification() {
  const [vstep, setVstep] = useState("intro"); // intro | camera | processing | pass | fail | bbps | bbps-result
  const [consumerID, setConsumerID] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (vstep === "processing") {
      let p = 0;
      const t = setInterval(() => {
        p += 10;
        setProgress(p);
        if (p >= 100) { clearInterval(t); setTimeout(() => setVstep("pass"), 400); }
      }, 300);
      return () => clearInterval(t);
    }
  }, [vstep]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: BG, overflow: "hidden" }}>
      <div style={{ background: WH, borderBottom: `1px solid ${LG}` }}>
        <StatusBar />
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px 12px" }}>
          {vstep !== "intro" && <div onClick={() => setVstep("intro")} style={{ cursor: "pointer", fontSize: 20 }}>←</div>}
          <div style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 15, color: DK }}>
            {vstep === "intro" ? "Property Verification" : vstep.includes("bbps") ? "Step 2 of 2 — Address" : "Step 1 of 2 — Identity"}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {/* INTRO */}
        {vstep === "intro" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>🛡️</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: DK, marginBottom: 6 }}>Get Verified</div>
            <div style={{ fontSize: 13, color: GR, marginBottom: 24 }}>2 steps · approx. 60 seconds</div>
            <div style={{ background: WH, borderRadius: 14, padding: "16px 20px", textAlign: "left", marginBottom: 24, boxShadow: "0 2px 8px #0001" }}>
              {[
                { icon: "🤳", label: "Video Selfie", sub: "Prove it's you with a quick liveness check" },
                { icon: "⚡", label: "Electricity Bill", sub: "Confirm your address via BBPS consumer ID" },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 14, marginBottom: i === 0 ? 14 : 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: TL, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: DK }}>{s.label}</div>
                    <div style={{ fontSize: 12, color: GR }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <Btn label="Start Verification →" full onPress={() => setVstep("camera")} />
          </div>
        )}

        {/* CAMERA */}
        {vstep === "camera" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ background: DK, borderRadius: 20, padding: 20, marginBottom: 16, position: "relative" }}>
              <div style={{ width: "100%", paddingBottom: "80%", background: "#2d3748", borderRadius: 12, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 120, height: 160, border: `3px solid ${T}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 50 }}>😊</div>
                </div>
                <div style={{ position: "absolute", top: 10, right: 10, width: 12, height: 12, borderRadius: 6, background: RD, animation: "pulse 1s infinite" }} />
              </div>
            </div>
            <div style={{ background: WH, borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: DK, marginBottom: 4 }}>👁️ Please blink your eyes slowly</div>
              <div style={{ fontSize: 12, color: GR }}>Look at the camera and follow the instructions</div>
            </div>
            <Btn label="Start Recording" full onPress={() => setVstep("processing")} />
          </div>
        )}

        {/* PROCESSING */}
        {vstep === "processing" && (
          <div style={{ textAlign: "center", paddingTop: 40 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🔄</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: DK, marginBottom: 8 }}>Verifying your identity...</div>
            <div style={{ fontSize: 13, color: GR, marginBottom: 28 }}>Analysing liveness signals</div>
            <div style={{ background: LG, borderRadius: 8, height: 8, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ width: `${progress}%`, height: "100%", background: T, borderRadius: 8, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 12, color: GR }}>{progress}% complete</div>
          </div>
        )}

        {/* PASS */}
        {vstep === "pass" && (
          <div style={{ textAlign: "center", paddingTop: 24 }}>
            <div style={{ width: 80, height: 80, borderRadius: 40, background: GN + "22", border: `3px solid ${GN}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, margin: "0 auto 16px" }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: GN, marginBottom: 6 }}>Identity Verified!</div>
            <div style={{ fontSize: 13, color: GR, marginBottom: 28 }}>Liveness check passed successfully</div>
            <div style={{ background: AM + "18", border: `1px solid ${AM}44`, borderRadius: 12, padding: "12px 16px", marginBottom: 24, textAlign: "left" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: DK, marginBottom: 4 }}>Next: Confirm your address</div>
              <div style={{ fontSize: 12, color: GR }}>Provide your electricity consumer ID to verify the property address</div>
            </div>
            <Btn label="Continue to Step 2 →" full onPress={() => setVstep("bbps")} />
          </div>
        )}

        {/* FAIL */}
        {vstep === "fail" && (
          <div style={{ textAlign: "center", paddingTop: 24 }}>
            <div style={{ width: 80, height: 80, borderRadius: 40, background: RD + "22", border: `3px solid ${RD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, margin: "0 auto 16px" }}>✕</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: RD, marginBottom: 6 }}>Verification Failed</div>
            <div style={{ fontSize: 13, color: GR, marginBottom: 16 }}>We couldn't confirm your identity</div>
            <div style={{ background: RD + "11", borderRadius: 10, padding: "10px 14px", marginBottom: 24, fontSize: 12, color: RD, textAlign: "left" }}>⚠️ Reason: Liveness check failed — face not clearly visible</div>
            <Btn label="Try Again" full onPress={() => setVstep("camera")} />
            <div style={{ marginTop: 10, fontSize: 13, color: T, cursor: "pointer", textAlign: "center" }}>Need Help?</div>
          </div>
        )}

        {/* BBPS */}
        {vstep === "bbps" && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DK, marginBottom: 4 }}>Enter Electricity Consumer ID</div>
            <div style={{ fontSize: 12, color: GR, marginBottom: 16 }}>We'll verify your address through the BBPS network</div>
            <div style={{ background: TL, borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 10 }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <div style={{ fontSize: 12, color: TD }}>Find your Consumer ID on the top-right corner of your electricity bill</div>
            </div>
            <div style={{ background: WH, borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: GR, textAlign: "center" }}>
              [Sample bill image — Consumer ID circled]
            </div>
            <input
              value={consumerID}
              onChange={e => setConsumerID(e.target.value)}
              placeholder="e.g. UP-123456789"
              style={{ width: "100%", border: `1.5px solid ${LG}`, borderRadius: 10, padding: "11px 14px", fontSize: 14, color: DK, outline: "none", boxSizing: "border-box", marginBottom: 16, background: WH }}
            />
            <Btn label="Verify Address →" full disabled={consumerID.length < 5} onPress={() => setVstep("bbps-result")} />
          </div>
        )}

        {/* BBPS RESULT */}
        {vstep === "bbps-result" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 80, height: 80, borderRadius: 40, background: GN + "22", border: `3px solid ${GN}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, margin: "0 auto 16px" }}>🏠</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: GN, marginBottom: 6 }}>Address Verified!</div>
            <Badge label="Confidence: 91%" color={GN} />
            <div style={{ background: WH, borderRadius: 14, padding: "16px 18px", marginTop: 20, textAlign: "left", boxShadow: "0 2px 8px #0001" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: DK, marginBottom: 10 }}>Your listing is now LIVE 🎉</div>
              {[
                { icon: "✓", label: "Identity verified", color: GN },
                { icon: "✓", label: "Address confirmed", color: GN },
                { icon: "✓", label: "Listing published", color: T },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 11, background: s.color + "22", color: s.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{s.icon}</div>
                  <span style={{ fontSize: 13, color: DK }}>{s.label}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20 }}>
              <Btn label="View My Listing →" full />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-05: Tenant Home / Discovery
// ═══════════════════════════════════════════════════════════════
function WF05_TenantHome() {
  const [credits, setCredits] = useState(1);
  const [city, setCity] = useState("Lucknow");

  const recs = [
    { addr: "MG Road, Gomti Nagar", bhk: "2 BHK", rent: "₹14,000", verified: true },
    { addr: "Hazratganj, Central LKO", bhk: "3 BHK", rent: "₹18,500", verified: true },
    { addr: "Alambagh", bhk: "1 BHK", rent: "₹8,000", verified: false },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: BG, overflow: "hidden" }}>
      <div style={{ background: T }}>
        <StatusBar light />
        <div style={{ padding: "8px 16px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, background: WH, borderRadius: 12, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", cursor: "text" }}>
              <span style={{ fontSize: 16 }}>🔍</span>
              <span style={{ fontSize: 13, color: "#9CA3AF" }}>Search area, locality...</span>
              <span style={{ marginLeft: "auto", fontSize: 16 }}>🎙️</span>
            </div>
            <div onClick={() => setCity(city === "Lucknow" ? "Delhi" : "Lucknow")} style={{ background: "#ffffff33", borderRadius: 10, padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 12, color: WH, fontWeight: 600 }}>{city}</span>
              <span style={{ fontSize: 10, color: WH }}>▾</span>
            </div>
          </div>
          {/* Saved search chips */}
          <div style={{ display: "flex", gap: 8, overflow: "auto", paddingBottom: 4 }}>
            <Chip label="2BHK Gomti Nagar <15k" active small />
            <Chip label="1BHK Hazratganj" small />
            <Chip label="+ New Search" small />
          </div>
        </div>
      </div>

      {/* Credits Banner */}
      {credits < 2 && (
        <div style={{ background: credits === 0 ? RD + "18" : AM + "18", borderBottom: `1px solid ${credits === 0 ? RD : AM}44`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>{credits === 0 ? "🔴" : "⚠️"}</span>
          <div style={{ flex: 1, fontSize: 12, color: DK }}>
            <strong>{credits} credit{credits !== 1 ? "s" : ""} left.</strong> <span style={{ color: T, cursor: "pointer" }}>Buy more →</span>
          </div>
          <div onClick={() => setCredits(5)} style={{ fontSize: 11, color: T, cursor: "pointer", fontWeight: 600 }}>+5 Free</div>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "14px 16px" }}>
        {/* Recommended */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: DK }}>✅ Verified Near You</div>
          <span style={{ fontSize: 12, color: T }}>See all</span>
        </div>
        <div style={{ display: "flex", gap: 10, overflow: "auto", paddingBottom: 6 }}>
          {recs.map((r, i) => (
            <div key={i} style={{ minWidth: 160, background: WH, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 8px #0001" }}>
              <div style={{ height: 90, background: `hsl(${170 + i * 30},40%,75%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, position: "relative" }}>
                🏠
                <div style={{ position: "absolute", top: 6, right: 6 }}>
                  <span style={{ fontSize: 16, cursor: "pointer" }}>🤍</span>
                </div>
                {r.verified && <div style={{ position: "absolute", bottom: 6, left: 6, background: GN, borderRadius: 6, padding: "2px 6px", fontSize: 9, color: WH, fontWeight: 700 }}>✓ VERIFIED</div>}
              </div>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: DK, marginBottom: 2 }}>{r.addr}</div>
                <div style={{ fontSize: 10, color: GR }}>{r.bhk}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T, marginTop: 4 }}>{r.rent}<span style={{ fontSize: 9, color: GR, fontWeight: 400 }}>/mo</span></div>
              </div>
            </div>
          ))}
        </div>

        {/* Recently Viewed */}
        <div style={{ fontWeight: 700, fontSize: 14, color: DK, marginTop: 18, marginBottom: 10 }}>Recently Viewed</div>
        <div style={{ display: "flex", gap: 10, overflow: "auto", paddingBottom: 6 }}>
          {[{ addr: "Indira Nagar", rent: "₹11K", bhk: "2BHK" }, { addr: "Aliganj", rent: "₹9K", bhk: "1BHK" }, { addr: "Vikas Nagar", rent: "₹16K", bhk: "3BHK" }].map((r, i) => (
            <div key={i} style={{ minWidth: 130, background: WH, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 6px #0001" }}>
              <div style={{ height: 70, background: `hsl(${200 + i * 25},35%,78%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏘️</div>
              <div style={{ padding: "6px 8px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: DK }}>{r.addr}</div>
                <div style={{ fontSize: 10, color: GR }}>{r.bhk}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: T }}>{r.rent}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav active={0} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-06: Search Results & Filters
// ═══════════════════════════════════════════════════════════════
function WF06_SearchResults() {
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState("Relevance");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [activeFilters, setActiveFilters] = useState(["House", "₹10k–20k", "2 BHK"]);

  const listings = [
    { addr: "42 Gomti Nagar", bhk: "2 BHK", rent: "₹14,500", verified: true, response: "Responds in 2h" },
    { addr: "Civil Lines, Near Park", bhk: "2 BHK", rent: "₹16,000", verified: true, response: "Usually responds" },
    { addr: "Aliganj Sector C", bhk: "2 BHK", rent: "₹11,500", verified: false, response: "" },
    { addr: "Indira Nagar, Opp Metro", bhk: "2 BHK", rent: "₹18,000", verified: true, response: "Fast responder" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: BG, overflow: "hidden", position: "relative" }}>
      <div style={{ background: WH, borderBottom: `1px solid ${LG}` }}>
        <StatusBar />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px 8px" }}>
          <div style={{ flex: 1, background: BG, borderRadius: 10, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
            <span style={{ fontSize: 14 }}>🔍</span>
            <span style={{ fontSize: 13, color: DK }}>2 BHK in Lucknow</span>
            <span style={{ marginLeft: "auto", fontSize: 12 }}>✕</span>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: BG, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18 }}>🗺️</div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, padding: "0 14px 10px", overflow: "auto" }}>
          {activeFilters.map((f, i) => (
            <Chip key={i} label={f} active closeable onPress={() => setActiveFilters(prev => prev.filter((_, j) => j !== i))} small />
          ))}
          <Chip label={`Verified ${verifiedOnly ? "✓" : ""}`} active={verifiedOnly} onPress={() => setVerifiedOnly(v => !v)} small />
          <Chip label="More +" onPress={() => setShowFilters(true)} small />
        </div>
      </div>

      {/* Sort row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", background: BG }}>
        <div style={{ fontSize: 12, color: GR }}><strong style={{ color: DK }}>142</strong> properties in Lucknow</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: T, cursor: "pointer" }}>
          <span>⇅</span> {sort}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
        {listings.filter(l => !verifiedOnly || l.verified).map((l, i) => (
          <div key={i} style={{ background: WH, borderRadius: 14, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px #0001" }}>
            <div style={{ height: 130, background: `hsl(${170 + i * 20},40%,78%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, position: "relative" }}>
              🏠
              <div style={{ position: "absolute", top: 8, right: 10, cursor: "pointer", fontSize: 22 }}>🤍</div>
              {l.verified && <div style={{ position: "absolute", bottom: 8, left: 10, background: GN, borderRadius: 8, padding: "3px 8px", fontSize: 10, color: WH, fontWeight: 700 }}>✓ VERIFIED</div>}
            </div>
            <div style={{ padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: DK }}>{l.addr}</div>
                  <div style={{ fontSize: 11, color: GR, marginTop: 2 }}>{l.bhk}</div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T }}>{l.rent}<span style={{ fontSize: 9, color: GR, fontWeight: 400 }}>/mo</span></div>
              </div>
              {l.response && <div style={{ fontSize: 10, color: GN, marginTop: 6 }}>⚡ {l.response}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Filters Bottom Sheet */}
      {showFilters && (
        <>
          <div onClick={() => setShowFilters(false)} style={{ position: "absolute", inset: 0, background: "#00000055", zIndex: 20 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: WH, borderRadius: "20px 20px 0 0", padding: "20px 20px 8px", zIndex: 21, maxHeight: "60%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: DK }}>More Filters</div>
              <div onClick={() => setShowFilters(false)} style={{ cursor: "pointer", fontSize: 20, color: GR }}>✕</div>
            </div>
            {[
              { label: "Furnishing", opts: ["Furnished", "Semi", "Unfurnished"] },
              { label: "Tenant Preference", opts: ["Family", "Bachelor", "Any"] },
              { label: "Maintenance", opts: ["Included", "Excluded"] },
            ].map((f, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: DK, marginBottom: 7 }}>{f.label}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {f.opts.map((o, j) => <Chip key={j} label={o} small active={j === 0} />)}
                </div>
              </div>
            ))}
            <div style={{ paddingTop: 10, paddingBottom: 4 }}>
              <Btn label="Apply Filters" full onPress={() => setShowFilters(false)} />
            </div>
          </div>
        </>
      )}

      <BottomNav active={1} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-07: Tenant Portal — Rent Payment
// ═══════════════════════════════════════════════════════════════
function WF07_RentPayment() {
  const [showPaySheet, setShowPaySheet] = useState(false);
  const [payMethod, setPayMethod] = useState("upi");
  const [subTab, setSubTab] = useState("rent");
  const [paid, setPaid] = useState(false);

  const history = [
    { month: "Feb 2026", amount: "₹16,500", date: "3 Feb", status: "Paid" },
    { month: "Jan 2026", amount: "₹16,500", date: "2 Jan", status: "Paid" },
    { month: "Dec 2025", amount: "₹16,500", date: "5 Dec", status: "Late" },
    { month: "Nov 2025", amount: "₹16,500", date: "1 Nov", status: "Paid" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: BG, overflow: "hidden", position: "relative" }}>
      <div style={{ background: T }}>
        <StatusBar light />
        <div style={{ padding: "8px 16px 14px" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "#ffffff33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🏢</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: WH }}>42 MG Road, Gomti Nagar</div>
              <div style={{ display: "inline-block", background: "#ffffff33", borderRadius: 8, padding: "2px 8px", fontSize: 10, color: WH, marginTop: 3 }}>Mar 2026 – Feb 2027</div>
            </div>
          </div>
        </div>
        {/* Sub tabs */}
        <div style={{ display: "flex", borderTop: "1px solid #ffffff33" }}>
          {["rent", "complaints", "documents"].map(t => (
            <div key={t} onClick={() => setSubTab(t)} style={{ flex: 1, padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: subTab === t ? 700 : 400, color: subTab === t ? WH : "#ffffffaa", borderBottom: subTab === t ? "2px solid " + WH : "2px solid transparent", cursor: "pointer", textTransform: "capitalize" }}>{t}</div>
          ))}
        </div>
      </div>

      {subTab === "rent" && (
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {/* Rent Status Card */}
          <div style={{ background: WH, borderRadius: 16, padding: 18, marginBottom: 14, boxShadow: "0 2px 12px #0001" }}>
            <div style={{ fontSize: 13, color: GR, marginBottom: 4 }}>March 2026</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: DK }}>₹16,500</div>
              {paid ? <Badge label="Paid on 6 Mar" color={GN} /> : <Badge label="Due in 3 days" color={AM} />}
            </div>
            {!paid && (
              <div>
                <div style={{ height: 1, background: LG, marginBottom: 12 }} />
                <Btn label="Pay Now →" full disabled={paid} onPress={() => setShowPaySheet(true)} />
              </div>
            )}
            {paid && <div style={{ fontSize: 12, color: GN, textAlign: "center" }}>✓ Payment successful · March 6, 2026</div>}
          </div>

          {/* Autopay Banner */}
          {!paid && (
            <div style={{ background: TL, border: `1px solid ${T}44`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <div style={{ flex: 1, fontSize: 12, color: TD }}>Never miss rent — <strong>Set up autopay →</strong></div>
            </div>
          )}

          {/* Payment History */}
          <div style={{ fontWeight: 700, fontSize: 14, color: DK, marginBottom: 10 }}>Payment History</div>
          {history.map((h, i) => (
            <div key={i} style={{ background: WH, borderRadius: 12, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: h.status === "Paid" ? GN + "18" : AM + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                {h.status === "Paid" ? "✅" : "⏰"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: DK }}>{h.month}</div>
                <div style={{ fontSize: 11, color: GR }}>{h.date}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: DK }}>{h.amount}</div>
                <Badge label={h.status} color={h.status === "Paid" ? GN : AM} />
              </div>
              <div style={{ cursor: "pointer", fontSize: 18 }}>📄</div>
            </div>
          ))}
        </div>
      )}

      {(subTab === "complaints" || subTab === "documents") && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 40 }}>{subTab === "complaints" ? "🔧" : "📁"}</span>
          <div style={{ fontSize: 14, fontWeight: 600, color: DK }}>No {subTab} yet</div>
          <div style={{ fontSize: 12, color: GR }}>This section is empty</div>
        </div>
      )}

      {/* Pay Sheet */}
      {showPaySheet && (
        <>
          <div onClick={() => setShowPaySheet(false)} style={{ position: "absolute", inset: 0, background: "#00000066", zIndex: 20 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: WH, borderRadius: "20px 20px 0 0", padding: "20px 20px 12px", zIndex: 21 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: DK }}>Pay March Rent</div>
              <div onClick={() => setShowPaySheet(false)} style={{ cursor: "pointer", fontSize: 20, color: GR }}>✕</div>
            </div>
            <div style={{ background: BG, borderRadius: 12, padding: "10px 14px", marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: GR }}>Amount</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: DK }}>₹16,500</div>
            </div>
            {/* Method Tabs */}
            <div style={{ display: "flex", background: BG, borderRadius: 12, padding: 4, marginBottom: 14 }}>
              {["upi", "card", "netbanking"].map(m => (
                <div key={m} onClick={() => setPayMethod(m)} style={{ flex: 1, padding: "7px 0", borderRadius: 9, textAlign: "center", fontSize: 12, fontWeight: payMethod === m ? 700 : 400, background: payMethod === m ? WH : "transparent", color: payMethod === m ? T : GR, cursor: "pointer", boxShadow: payMethod === m ? "0 1px 4px #0002" : "none", transition: "all 0.2s", textTransform: "uppercase" }}>{m}</div>
              ))}
            </div>
            {payMethod === "upi" && (
              <div>
                <input placeholder="Enter UPI ID (e.g. name@upi)" style={{ width: "100%", border: `1.5px solid ${LG}`, borderRadius: 10, padding: "11px 14px", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 10, color: DK }} />
                <div style={{ textAlign: "center", fontSize: 12, color: GR, marginBottom: 12 }}>or</div>
                <div style={{ background: BG, borderRadius: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 28 }}>◼</span><div style={{ fontSize: 12, color: GR }}>Scan QR code to pay</div>
                </div>
              </div>
            )}
            {payMethod === "card" && (
              <div style={{ padding: "0 0 14px" }}>
                <input placeholder="Card number" style={{ width: "100%", border: `1.5px solid ${LG}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 10, color: DK }} />
                <div style={{ display: "flex", gap: 10 }}>
                  <input placeholder="MM/YY" style={{ flex: 1, border: `1.5px solid ${LG}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", color: DK }} />
                  <input placeholder="CVV" style={{ flex: 1, border: `1.5px solid ${LG}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", color: DK }} />
                </div>
              </div>
            )}
            {payMethod === "netbanking" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {["SBI", "HDFC", "ICICI", "Axis", "Others"].map(b => (
                  <div key={b} style={{ border: `1.5px solid ${LG}`, borderRadius: 10, padding: "8px 16px", fontSize: 12, cursor: "pointer", color: DK }}>{b}</div>
                ))}
              </div>
            )}
            <Btn label="Pay ₹16,500" full onPress={() => { setPaid(true); setShowPaySheet(false); }} />
          </div>
        </>
      )}

      <BottomNav active={0} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WF-08: Employee — Verification Queue
// ═══════════════════════════════════════════════════════════════
function WF08_EmployeeQueue() {
  const [activeTab, setActiveTab] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [actionSheet, setActionSheet] = useState(null);
  const [decisions, setDecisions] = useState({});

  const queue = [
    { id: 1, name: "Suresh Kumar", addr: "12 Rajendra Nagar, Lucknow", flag: "Address Mismatch", conf: "72%", time: "12 min ago", type: "Address Mismatch" },
    { id: 2, name: "Priya Singh", addr: "5 Sector B, Alambagh", flag: "Liveness Fail", conf: "—", time: "28 min ago", type: "Liveness Issues" },
    { id: 3, name: "Mohan Das", addr: "32 Civil Lines", flag: "Manual Review", conf: "58%", time: "1h ago", type: "Manual Review" },
  ];

  const tabFilters = ["All", "Liveness Issues", "Address Mismatch", "Manual Review"];

  const filteredQueue = queue.filter(q => activeTab === "All" || q.type === activeTab).filter(q => !decisions[q.id]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: BG, overflow: "hidden", position: "relative" }}>
      <div style={{ background: WH, borderBottom: `1px solid ${LG}` }}>
        <StatusBar />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px 8px" }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 16, color: DK }}>Verification Queue</div>
          <div style={{ background: RD, borderRadius: 10, padding: "2px 8px", fontSize: 12, color: WH, fontWeight: 700 }}>{filteredQueue.length} pending</div>
        </div>
        {/* Stats */}
        <div style={{ display: "flex", gap: 8, padding: "0 16px 10px" }}>
          {[{ label: "Approved", val: 8, color: GN }, { label: "Rejected", val: 3, color: RD }, { label: "Pending", val: filteredQueue.length, color: AM }].map((s, i) => (
            <div key={i} style={{ flex: 1, background: s.color + "11", borderRadius: 10, padding: "6px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 9, color: GR }}>{s.label}</div>
            </div>
          ))}
        </div>
        {/* Filter tabs */}
        <div style={{ display: "flex", overflow: "auto", paddingBottom: 0 }}>
          {tabFilters.map(t => (
            <div key={t} onClick={() => setActiveTab(t)} style={{ padding: "7px 14px", fontSize: 11, fontWeight: activeTab === t ? 700 : 400, color: activeTab === t ? T : GR, borderBottom: `2px solid ${activeTab === t ? T : "transparent"}`, cursor: "pointer", whiteSpace: "nowrap" }}>{t}</div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {filteredQueue.length === 0 && (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <div style={{ fontSize: 52, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DK }}>All clear!</div>
            <div style={{ fontSize: 12, color: GR }}>No pending reviews in this category</div>
          </div>
        )}

        {filteredQueue.map(item => (
          <div key={item.id} style={{ background: WH, borderRadius: 14, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px #0001" }}>
            <div onClick={() => setExpanded(expanded === item.id ? null : item.id)} style={{ padding: "12px 14px", cursor: "pointer" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Avatar name={item.name} size={38} color={item.type === "Liveness Issues" ? RD : item.type === "Address Mismatch" ? AM : GR} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: DK }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: GR, marginTop: 1 }}>{item.addr}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center" }}>
                    <Badge label={item.flag} color={item.type === "Liveness Issues" ? RD : item.type === "Address Mismatch" ? AM : GR} />
                    {item.conf !== "—" && <span style={{ fontSize: 10, color: GR }}>Conf: {item.conf}</span>}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: GR }}>{item.time}</div>
              </div>

              {expanded === item.id && (
                <div style={{ marginTop: 12, padding: "10px 0", borderTop: `1px solid ${LG}` }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, background: BG, borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 10, color: GR, marginBottom: 4 }}>BBPS Address</div>
                      <div style={{ fontSize: 11, color: DK }}>12 Rajendra Nagar, Lucknow 226004</div>
                    </div>
                    <div style={{ flex: 1, background: RD + "11", borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 10, color: RD, marginBottom: 4 }}>Listed Address</div>
                      <div style={{ fontSize: 11, color: DK }}>12 Raj. Nagar, LKO 226010</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <div onClick={e => { e.stopPropagation(); setDecisions(d => ({ ...d, [item.id]: "approved" })); }} style={{ flex: 1, background: GN + "18", border: `1.5px solid ${GN}44`, borderRadius: 10, padding: "7px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: GN, cursor: "pointer" }}>✓ Approve</div>
                <div onClick={e => { e.stopPropagation(); setDecisions(d => ({ ...d, [item.id]: "rejected" })); }} style={{ flex: 1, background: RD + "18", border: `1.5px solid ${RD}44`, borderRadius: 10, padding: "7px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: RD, cursor: "pointer" }}>✕ Reject</div>
                <div onClick={e => { e.stopPropagation(); setActionSheet(item.id); }} style={{ flex: 1, background: AM + "18", border: `1.5px solid ${AM}44`, borderRadius: 10, padding: "7px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: AM, cursor: "pointer" }}>? Info</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action Sheet */}
      {actionSheet && (
        <>
          <div onClick={() => setActionSheet(null)} style={{ position: "absolute", inset: 0, background: "#00000055", zIndex: 20 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: WH, borderRadius: "20px 20px 0 0", padding: "20px 20px 12px", zIndex: 21 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: DK, marginBottom: 12 }}>Request More Information</div>
            {["Unclear address in bill", "Liveness video too dark", "Bill older than 3 months", "Name mismatch on bill"].map((reason, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < 3 ? `1px solid ${LG}` : "none", cursor: "pointer" }}>
                <div style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${T}`, display: "flex", alignItems: "center", justifyContent: "center" }} />
                <span style={{ fontSize: 13, color: DK }}>{reason}</span>
              </div>
            ))}
            <div style={{ marginTop: 14 }}>
              <Btn label="Send Request" full onPress={() => { setDecisions(d => ({ ...d, [actionSheet]: "info_requested" })); setActionSheet(null); }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Phone Frame ──────────────────────────────────────────────────
function PhoneFrame({ children }) {
  return (
    <div style={{
      width: 390, background: "#111", borderRadius: 48,
      padding: 10, boxShadow: "0 30px 80px rgba(0,0,0,0.7), inset 0 0 0 2px #2a2a2a, inset 0 0 0 1px #444",
      position: "relative", flexShrink: 0,
    }}>
      {/* Side buttons */}
      <div style={{ position: "absolute", right: -4, top: 120, width: 4, height: 60, background: "#2a2a2a", borderRadius: "0 4px 4px 0" }} />
      <div style={{ position: "absolute", left: -4, top: 100, width: 4, height: 40, background: "#2a2a2a", borderRadius: "4px 0 0 4px" }} />
      <div style={{ position: "absolute", left: -4, top: 155, width: 4, height: 40, background: "#2a2a2a", borderRadius: "4px 0 0 4px" }} />
      {/* Screen */}
      <div style={{ background: BG, borderRadius: 40, overflow: "hidden", height: 790, display: "flex", flexDirection: "column", position: "relative" }}>
        {/* Camera pill */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, background: "#111" }}>
          <div style={{ width: 110, height: 30, background: "#111", borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#1a1a1a", border: "1.5px solid #333" }} />
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: T, opacity: 0.5 }} />
          </div>
        </div>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: BG }}>
          {children}
        </div>
        {/* Home bar */}
        <div style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: WH }}>
          <div style={{ width: 100, height: 4, background: DK, borderRadius: 2, opacity: 0.18 }} />
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
const SCREENS = [
  { id: "WF01", label: "Role Select", group: "🟣 Onboarding" },
  { id: "WF02", label: "Owner Dashboard", group: "🔵 Owner" },
  { id: "WF03", label: "List Property", group: "🔵 Owner" },
  { id: "WF04", label: "Verification", group: "🔵 Owner" },
  { id: "WF05", label: "Tenant Home", group: "🟢 Tenant" },
  { id: "WF06", label: "Search & Filters", group: "🟢 Tenant" },
  { id: "WF07", label: "Rent Payment", group: "🟢 Tenant" },
  { id: "WF08", label: "Employee Queue", group: "🟠 Employee" },
];

const SCREEN_MAP = {
  WF01: WF01_RoleSelection,
  WF02: WF02_OwnerDashboard,
  WF03: WF03_ListingCreation,
  WF04: WF04_Verification,
  WF05: WF05_TenantHome,
  WF06: WF06_SearchResults,
  WF07: WF07_RentPayment,
  WF08: WF08_EmployeeQueue,
};

export default function App() {
  const [current, setCurrent] = useState("WF01");
  const [key, setKey] = useState(0);
  const Screen = SCREEN_MAP[current];

  const groups = [...new Set(SCREENS.map(s => s.group))];

  function go(id) { setCurrent(id); setKey(k => k + 1); }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px 40px", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: T, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🏡</div>
          <h1 style={{ color: WH, fontSize: 22, fontWeight: 800, margin: 0 }}>Crib<span style={{ color: T }}>liv</span> — Android Mockups</h1>
        </div>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>8 interactive wireframe screens · Click any screen to explore</p>
      </div>

      {/* Screen Selector */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginBottom: 28, maxWidth: 860 }}>
        {groups.map(g => (
          <div key={g} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, paddingLeft: 2 }}>{g}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SCREENS.filter(s => s.group === g).map(s => (
                <button key={s.id} onClick={() => go(s.id)} style={{
                  padding: "7px 14px", borderRadius: 10, border: "none",
                  background: current === s.id ? T : "#1e293b",
                  color: current === s.id ? WH : "#94a3b8",
                  fontSize: 12, fontWeight: current === s.id ? 700 : 400,
                  cursor: "pointer", transition: "all 0.15s",
                  boxShadow: current === s.id ? `0 4px 14px ${T}55` : "none",
                }}>
                  <span style={{ opacity: 0.7, fontSize: 10, marginRight: 4 }}>{s.id}</span>{s.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Screen Description */}
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <span style={{ background: "#1e293b", color: "#94a3b8", fontSize: 12, padding: "4px 12px", borderRadius: 8 }}>
          {current === "WF01" && "Tap a role card to select it, then Continue becomes active"}
          {current === "WF02" && "Tap ⋮ on a listing for actions · Dismiss the amber banner · FAB at bottom-right"}
          {current === "WF03" && "Step through 5 stages of listing creation — add photos to unlock Next"}
          {current === "WF04" && "Walk through the full verification flow · Try pass & retry states"}
          {current === "WF05" && "Credit warning banner · Tap city chip to switch city · Scroll lists"}
          {current === "WF06" && "Remove filter chips · Toggle Verified Only · Open More Filters sheet"}
          {current === "WF07" && "Tap Pay Now → choose payment method → complete payment"}
          {current === "WF08" && "Approve/Reject cards to remove them · Expand for address comparison"}
        </span>
      </div>

      {/* Phone */}
      <PhoneFrame>
        <Screen key={key} />
      </PhoneFrame>

      <div style={{ marginTop: 20, fontSize: 11, color: "#334155", textAlign: "center" }}>
        Cribliv Interactive Mockups · WF-01 through WF-08 · Research Preview
      </div>
    </div>
  );
}
