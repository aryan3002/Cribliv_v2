"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  User,
  Phone,
  Globe,
  Bell,
  Shield,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  LogOut,
  CreditCard
} from "lucide-react";
import { signOut } from "next-auth/react";
import { getApiBaseUrl } from "../lib/api";

interface UserProfile {
  id: string;
  role: string;
  phone_e164: string;
  full_name: string | null;
  preferred_language: string;
  whatsapp_opt_in: boolean;
  wallet_balance: number;
}

export function SettingsClient({ locale }: { locale: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [fullName, setFullName] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState<"en" | "hi">("en");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/login" as any);
    }
  }, [status, router, locale]);

  const fetchProfile = useCallback(async () => {
    if (!session?.accessToken) return;
    try {
      setLoading(true);
      const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      });
      if (!res.ok) throw new Error("Failed to fetch profile");
      const payload = await res.json();
      const data = payload.data as UserProfile;
      setProfile(data);
      setFullName(data.full_name ?? "");
      setPreferredLanguage((data.preferred_language as "en" | "hi") ?? "en");
      setWhatsappOptIn(data.whatsapp_opt_in ?? false);
    } catch {
      setToast({ type: "error", message: "Failed to load profile" });
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchProfile();
    }
  }, [session?.accessToken, fetchProfile]);

  const handleSave = async () => {
    if (!session?.accessToken) return;
    try {
      setSaving(true);
      const res = await fetch(`${getApiBaseUrl()}/users/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({
          full_name: fullName.trim() || null,
          preferred_language: preferredLanguage,
          whatsapp_opt_in: whatsappOptIn
        })
      });

      if (!res.ok) throw new Error("Failed to save");
      setToast({ type: "success", message: "Settings saved successfully" });
      await fetchProfile();
    } catch {
      setToast({ type: "error", message: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const hasChanges =
    profile &&
    (fullName !== (profile.full_name ?? "") ||
      preferredLanguage !== profile.preferred_language ||
      whatsappOptIn !== profile.whatsapp_opt_in);

  if (status === "loading" || loading) {
    return (
      <div
        className="container--narrow"
        style={{
          paddingTop: "var(--space-16)",
          paddingBottom: "var(--space-16)",
          textAlign: "center"
        }}
      >
        <Loader2
          size={32}
          style={{ animation: "spin 1s linear infinite", color: "var(--brand)" }}
        />
        <p className="text-secondary" style={{ marginTop: "var(--space-4)" }}>
          Loading your settings...
        </p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div
      className="container--narrow"
      style={{ paddingTop: "var(--space-10)", paddingBottom: "var(--space-16)" }}
    >
      {toast && (
        <div
          className={`alert ${toast.type === "success" ? "alert--success" : "alert--error"}`}
          style={{
            position: "fixed",
            top: 80,
            right: 24,
            zIndex: 1000,
            maxWidth: 360,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            animation: "slideIn 0.3s ease-out"
          }}
        >
          {toast.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {toast.message}
        </div>
      )}

      <div style={{ marginBottom: "var(--space-8)" }}>
        <Link
          href={
            session?.user?.role === "owner" || session?.user?.role === "pg_operator"
              ? `/${locale}/owner/dashboard`
              : `/${locale}`
          }
          className="body-sm text-secondary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            marginBottom: "var(--space-4)",
            textDecoration: "none"
          }}
        >
          <ArrowLeft size={14} />{" "}
          {session?.user?.role === "owner" || session?.user?.role === "pg_operator"
            ? "Back to Dashboard"
            : "Back to Home"}
        </Link>
        <h1 style={{ marginBottom: "var(--space-2)" }}>Account Settings</h1>
        <p className="text-secondary">Manage your personal details and preferences.</p>
      </div>

      <div className="feature-card" style={{ marginBottom: "var(--space-6)", textAlign: "left" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginBottom: "var(--space-5)"
          }}
        >
          <div className="icon-circle icon-circle--brand">
            <User size={20} />
          </div>
          <h3 style={{ margin: 0 }}>Account Information</h3>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div>
            <label
              className="body-sm text-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-1)"
              }}
            >
              <Phone size={14} /> Phone Number
            </label>
            <div
              style={{
                padding: "var(--space-3) var(--space-4)",
                background: "var(--surface-raised)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                fontSize: 15
              }}
            >
              {profile?.phone_e164 ?? session.user?.phone}
            </div>
            <span
              className="caption text-tertiary"
              style={{ marginTop: "var(--space-1)", display: "block" }}
            >
              Phone number cannot be changed.
            </span>
          </div>

          <div>
            <label
              className="body-sm text-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-1)"
              }}
            >
              <Shield size={14} /> Role
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <div
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--surface-raised)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  fontSize: 15,
                  flex: 1,
                  textTransform: "capitalize"
                }}
              >
                {profile?.role ?? session.user?.role}
              </div>
              {profile?.role === "tenant" && (
                <Link
                  href={`/${locale}/become-owner`}
                  className="btn btn--secondary btn--sm"
                  style={{ whiteSpace: "nowrap" }}
                >
                  Become Owner
                </Link>
              )}
            </div>
          </div>

          <div>
            <label
              className="body-sm text-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-1)"
              }}
            >
              <CreditCard size={14} /> Credits Balance
            </label>
            <div
              style={{
                padding: "var(--space-3) var(--space-4)",
                background: "var(--surface-raised)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                fontSize: 15
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: "var(--amber)",
                  fontFamily: "var(--font-heading)"
                }}
              >
                ✦ {profile?.wallet_balance ?? 0}
              </span>{" "}
              <span className="text-secondary" style={{ marginLeft: "var(--space-1)" }}>
                credits
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="feature-card" style={{ marginBottom: "var(--space-6)", textAlign: "left" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginBottom: "var(--space-5)"
          }}
        >
          <div className="icon-circle icon-circle--trust">
            <Save size={20} />
          </div>
          <h3 style={{ margin: 0 }}>Personal Settings</h3>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div>
            <label
              htmlFor="fullName"
              className="body-sm text-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-1)"
              }}
            >
              <User size={14} /> Full Name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
              className="input"
              style={{
                width: "100%",
                padding: "var(--space-3) var(--space-4)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                fontSize: 15,
                background: "var(--surface)",
                color: "var(--text-primary)",
                outline: "none"
              }}
            />
          </div>

          <div>
            <label
              className="body-sm text-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-2)"
              }}
            >
              <Globe size={14} /> Preferred Language
            </label>
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              {(["en", "hi"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setPreferredLanguage(lang)}
                  className={`btn ${preferredLanguage === lang ? "btn--primary" : "btn--secondary"} btn--sm`}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {lang === "en" ? "🇬🇧 English" : "🇮🇳 हिंदी"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              className="body-sm text-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-2)"
              }}
            >
              <Bell size={14} /> Notifications
            </label>
            <button
              onClick={() => setWhatsappOptIn(!whatsappOptIn)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontSize: 15,
                color: "var(--text-primary)"
              }}
            >
              <span>WhatsApp notifications</span>
              <span
                style={{
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  background: whatsappOptIn ? "var(--trust)" : "var(--border)",
                  position: "relative",
                  transition: "background 0.2s ease",
                  flexShrink: 0
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: whatsappOptIn ? 22 : 2,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left 0.2s ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
                  }}
                />
              </span>
            </button>
            <span
              className="caption text-tertiary"
              style={{ marginTop: "var(--space-1)", display: "block" }}
            >
              Receive owner responses and listing updates via WhatsApp.
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={!hasChanges || saving}
        className="btn btn--primary btn--lg"
        style={{
          width: "100%",
          marginBottom: "var(--space-6)",
          opacity: !hasChanges ? 0.5 : 1,
          cursor: !hasChanges ? "not-allowed" : "pointer",
          justifyContent: "center"
        }}
      >
        {saving ? (
          <>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Saving...
          </>
        ) : (
          <>
            <Save size={18} /> Save Changes
          </>
        )}
      </button>

      <div className="feature-card" style={{ textAlign: "left", borderColor: "var(--accent)" }}>
        <h4 style={{ color: "var(--accent)", marginBottom: "var(--space-3)" }}>Account Actions</h4>
        <button
          onClick={() => void signOut({ callbackUrl: `/${locale}` })}
          className="btn btn--secondary btn--sm"
          style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
        >
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  );
}
