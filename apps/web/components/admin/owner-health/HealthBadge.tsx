"use client";

import type { OwnerHealthRow } from "../../../lib/admin-api";

interface Props {
  score: number;
  grade: OwnerHealthRow["grade"];
  onClick?: () => void;
}

export function HealthBadge({ score, grade, onClick }: Props) {
  return (
    <button
      type="button"
      className="admin-health"
      data-grade={grade}
      onClick={onClick}
      aria-label={`Owner health: ${score} out of 100, grade ${grade}`}
    >
      <span className="admin-health__score">{score}</span>
      <span className="admin-health__grade">{grade}</span>
    </button>
  );
}
