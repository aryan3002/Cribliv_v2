import { Activity, FileText, ShieldCheck, UserRound } from "lucide-react";
import type { AdminHomeActivityKind, AdminHomeDetail } from "@cribliv/shared-types";
import { formatDate, formatTime } from "../../../lib/admin/format";
import { EmptyState } from "../primitives/EmptyState";

export function HomeActivityTab({ detail }: { detail: AdminHomeDetail }) {
  const activity = [...detail.activity]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 100);

  if (activity.length === 0) {
    return (
      <EmptyState
        title="No activity recorded"
        hint="Listing, verification, admin, and lead events will appear here when available."
        icon={<Activity size={18} aria-hidden="true" />}
      />
    );
  }

  return (
    <ol className="admin-home-workspace__timeline">
      {activity.map((item) => (
        <li key={item.id} className="admin-home-workspace__timeline-item">
          <span className="admin-home-workspace__timeline-icon">{iconFor(item.kind)}</span>
          <div>
            <div className="admin-home-workspace__timeline-topline">
              <strong>{item.label}</strong>
              <time dateTime={item.at}>
                {formatDate(item.at)} · {formatTime(item.at)}
              </time>
            </div>
            {item.detail && <p>{item.detail}</p>}
            {item.actor_id && <code>Actor {item.actor_id}</code>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function iconFor(kind: AdminHomeActivityKind) {
  if (kind === "verification") return <ShieldCheck size={16} aria-hidden="true" />;
  if (kind === "lead") return <UserRound size={16} aria-hidden="true" />;
  if (kind === "admin") return <Activity size={16} aria-hidden="true" />;
  return <FileText size={16} aria-hidden="true" />;
}
