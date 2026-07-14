import { Building2, Check, House, KeyRound, User } from "lucide-react";
import type { ReactNode } from "react";

export type RoleAvatarRole = "tenant" | "owner" | "pg_operator" | "admin";

export interface RoleAvatarProps {
  role?: RoleAvatarRole;
  size: "compact" | "menu";
  className?: string;
}

function TenantPortrait() {
  return (
    <svg className="role-avatar__portrait" viewBox="0 0 64 64" focusable="false">
      <circle cx="32" cy="32" r="31" fill="#dceaff" />
      <path d="M15 61c2-15 9-23 17-23s15 8 17 23" fill="#2774ff" />
      <circle cx="32" cy="26" r="11" fill="#f2bc91" />
      <path d="M21 25c1-10 7-15 13-15 6 0 10 4 11 10-7-2-15-1-24 5Z" fill="#263d71" />
      <path d="m21 45 11 8 11-8-4-5H25l-4 5Z" fill="#f7fbff" />
      <path d="M26 45h12" fill="none" stroke="#c2d8ff" strokeWidth="2" />
    </svg>
  );
}

function OwnerPortrait() {
  return (
    <svg className="role-avatar__portrait" viewBox="0 0 64 64" focusable="false">
      <circle cx="32" cy="32" r="31" fill="#f0e1fb" />
      <path d="M14 61c2-15 9-23 18-23s16 8 18 23" fill="#7137a9" />
      <circle cx="32" cy="25" r="11" fill="#eeb98d" />
      <path d="M21 24c1-10 7-14 14-14 7 1 10 5 10 12-8-4-16-4-24 2Z" fill="#493047" />
      <path d="m22 42 10 12 10-12-5-3H27l-5 3Z" fill="#fff" />
      <path d="M32 41v13" fill="none" stroke="#d5b6e8" strokeWidth="2" />
    </svg>
  );
}

function PgOperatorPortrait() {
  return (
    <svg className="role-avatar__portrait" viewBox="0 0 64 64" focusable="false">
      <circle cx="32" cy="32" r="31" fill="#d6f3eb" />
      <path d="M15 60c2-14 9-22 17-22s15 8 17 22" fill="#008a78" />
      <circle cx="32" cy="25" r="11" fill="#efbd92" />
      <path d="M20 23c2-9 7-13 14-13 7 0 11 5 11 12-8-3-16-3-25 1Z" fill="#204b47" />
      <path d="M21 44h22l-4-5H25l-4 5Z" fill="#f8fffd" />
      <path
        d="M24 20c-5 2-6 10-4 16m24-16c5 2 6 10 4 16M47 35h-7"
        fill="none"
        stroke="#12695f"
        strokeLinecap="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}

function AdminPortrait() {
  return (
    <svg className="role-avatar__portrait" viewBox="0 0 64 64" focusable="false">
      <circle cx="32" cy="32" r="31" fill="#e2e6ef" />
      <path d="M14 61c2-15 9-23 18-23s16 8 18 23" fill="#31384d" />
      <circle cx="32" cy="25" r="11" fill="#efbd92" />
      <path d="M20 23c1-9 7-14 14-14 7 1 11 5 11 13-8-3-17-3-25 1Z" fill="#202534" />
      <path d="m22 42 10 13 10-13-5-3H27l-5 3Z" fill="#fff" />
      <path d="m30 43 2-3 2 3-2 11-2-11Z" fill="#246bfd" />
    </svg>
  );
}

const PORTRAITS: Record<RoleAvatarRole, ReactNode> = {
  tenant: <TenantPortrait />,
  owner: <OwnerPortrait />,
  pg_operator: <PgOperatorPortrait />,
  admin: <AdminPortrait />
};

const SEALS: Record<RoleAvatarRole, ReactNode> = {
  tenant: <KeyRound />,
  owner: <House />,
  pg_operator: <Building2 />,
  admin: <Check />
};

export function RoleAvatar({ role, size, className }: RoleAvatarProps) {
  const avatarRole: RoleAvatarRole | "fallback" =
    role && Object.prototype.hasOwnProperty.call(PORTRAITS, role) ? role : "fallback";
  const classes = ["role-avatar", `role-avatar--${size}`, className].filter(Boolean).join(" ");

  return (
    <span
      className={classes}
      data-role-avatar={avatarRole}
      data-testid="role-avatar"
      aria-hidden="true"
    >
      {avatarRole === "fallback" ? (
        <User className="role-avatar__fallback-icon" />
      ) : (
        <>
          {PORTRAITS[avatarRole]}
          <span className="role-avatar__seal">{SEALS[avatarRole]}</span>
        </>
      )}
    </span>
  );
}
