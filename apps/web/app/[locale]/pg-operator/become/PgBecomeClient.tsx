"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requestRoleUpgrade } from "@/lib/owner-api";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, Loader2, CheckCircle2, AlertTriangle, LogIn, Sparkles } from "lucide-react";
import Link from "next/link";

type Role = "tenant" | "owner" | "pg_operator" | "admin";
type Phase = "working" | "blocked" | "pending" | "error" | "done" | "needs_signin";

interface Props {
  locale: string;
  currentRole: Role;
  accessToken: string | null;
}

export default function PgBecomeClient({ locale, currentRole, accessToken }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() => {
    if (currentRole === "pg_operator") return "done";
    if (currentRole === "owner") return "blocked";
    if (!accessToken) return "needs_signin";
    return "working";
  });
  const [error, setError] = useState<string | null>(null);

  const doGrant = async () => {
    if (!accessToken) return;
    setPhase("working");
    setError(null);
    try {
      const r = await requestRoleUpgrade(accessToken, "pg_operator");
      if (r.status === "granted" || r.status === "already_granted") {
        router.refresh();
        setPhase("done");
        router.push(`/${locale}/pg-operator/dashboard` as any);
      } else if (r.status === "pending") {
        setPhase("pending");
      } else {
        setError(`Unexpected status: ${(r as any).status}`);
        setPhase("error");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  useEffect(() => {
    if (currentRole === "tenant" && accessToken) void doGrant();
    if (currentRole === "pg_operator") router.push(`/${locale}/pg-operator/dashboard` as any);
  }, [currentRole, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const cardVariants = {
    initial: { opacity: 0, scale: 0.95, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: -20 }
  };

  const renderContent = () => {
    switch (phase) {
      case "needs_signin":
        return (
          <motion.div
            key="needs_signin"
            className="pgo-splash__card pgo-glass"
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="pgo-splash__icon-ring pgo-splash__icon-ring--brand">
              <LogIn size={36} />
            </div>
            <h1 className="pgo-splash__title">Sign in to continue</h1>
            <p className="pgo-splash__desc">You need to be signed in to become a PG operator.</p>
            <Link
              href={`/${locale}/auth/login?from=/${locale}/pg-operator/become`}
              className="pgo-btn pgo-btn--primary pgo-btn--lg"
            >
              Sign In Now
            </Link>
          </motion.div>
        );
      case "blocked":
        return (
          <motion.div
            key="blocked"
            className="pgo-splash__card pgo-glass"
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="pgo-splash__icon-ring pgo-splash__icon-ring--danger">
              <ShieldAlert size={36} />
            </div>
            <h1 className="pgo-splash__title">You already manage properties</h1>
            <p className="pgo-splash__desc">
              Managing both an owner account and a PG operator account in one profile is on the V1.5
              roadmap. Reach out at support@cribliv.com if you need this sooner.
            </p>
            <Link href={`/${locale}/owner/dashboard`} className="pgo-btn pgo-btn--secondary">
              Back to your owner dashboard
            </Link>
          </motion.div>
        );
      case "pending":
        return (
          <motion.div
            key="pending"
            className="pgo-splash__card pgo-glass"
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="pgo-splash__icon-ring pgo-splash__icon-ring--warning">
              <CheckCircle2 size={36} />
            </div>
            <h1 className="pgo-splash__title">Request Under Review</h1>
            <p className="pgo-splash__desc">
              We&apos;ll email you within 1 business day once your account is approved. You&apos;ll
              then be able to list your PG.
            </p>
            <Link href={`/${locale}` as any} className="pgo-btn pgo-btn--secondary">
              Return Home
            </Link>
          </motion.div>
        );
      case "error":
        return (
          <motion.div
            key="error"
            className="pgo-splash__card pgo-glass pgo-animate-shake"
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="pgo-splash__icon-ring pgo-splash__icon-ring--danger">
              <AlertTriangle size={36} />
            </div>
            <h1 className="pgo-splash__title">Setup Issue</h1>
            <p className="pgo-splash__desc" role="alert">
              {error ?? "Something went wrong."}
            </p>
            <button
              type="button"
              onClick={doGrant}
              className="pgo-btn pgo-btn--primary pgo-btn--lg"
            >
              Retry Setup
            </button>
          </motion.div>
        );
      case "working":
      case "done":
      default:
        return (
          <motion.div
            key="working"
            className="pgo-splash__card pgo-glass"
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="pgo-splash__icon-ring pgo-splash__icon-ring--brand pgo-animate-float">
              <Sparkles size={36} />
            </div>
            <h1 className="pgo-splash__title">Setting up your account</h1>
            <p className="pgo-splash__desc">Welcome aboard. Taking you to your dashboard…</p>
            <div className="pgo-loading-dots" style={{ margin: "8px auto 0" }}>
              <span />
              <span />
              <span />
            </div>
          </motion.div>
        );
    }
  };

  return (
    <main className="pgo-splash">
      <AnimatePresence mode="wait">{renderContent()}</AnimatePresence>
    </main>
  );
}
