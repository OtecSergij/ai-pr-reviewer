import type { CSSProperties, ReactNode } from "react";
import type { ReviewRow } from "@/lib/db/schema";
import { SEVERITY_STYLES, severityPills } from "@/app/components/review-theme";

const COLOR = {
  ink: "#18181b",
  white: "#ffffff",
  subtle: "#a1a1aa",
  faint: "#8c959f",
};

const SANS = "Instrument Sans";
const MONO = "JetBrains Mono";

function CardFrame({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: COLOR.ink,
        color: COLOR.white,
        fontFamily: SANS,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function LogoMark({
  dimension,
  radius,
  fontSize,
}: {
  dimension: number;
  radius: number;
  fontSize: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: dimension,
        height: dimension,
        borderRadius: radius,
        backgroundColor: COLOR.white,
        color: COLOR.ink,
        fontFamily: MONO,
        fontWeight: 600,
        fontSize,
      }}
    >
      PR
    </div>
  );
}

export function BrandCard() {
  return (
    <CardFrame
      style={{
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
      }}
    >
      <LogoMark dimension={112} radius={26} fontSize={52} />
      <div style={{ display: "flex", fontWeight: 700, fontSize: 60 }}>
        AI PR Reviewer
      </div>
      <div style={{ display: "flex", fontSize: 28, color: COLOR.subtle }}>
        AI code review for GitHub pull requests
      </div>
    </CardFrame>
  );
}

export function SeverityCard({ review }: { review: ReviewRow }) {
  const pills = severityPills(review.issues);

  return (
    <CardFrame
      style={{
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <LogoMark dimension={72} radius={18} fontSize={34} />
        <div style={{ display: "flex", fontWeight: 700, fontSize: 34 }}>
          AI PR Reviewer
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontWeight: 700, fontSize: 64 }}>
          {`${review.owner}/${review.repo}`}
        </div>
        <div style={{ display: "flex", fontSize: 40, color: COLOR.subtle }}>
          {`#${review.prNumber}`}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {pills.length > 0 ? (
            pills.map((p) => (
              <div
                key={p.severity}
                style={{
                  display: "flex",
                  borderRadius: 9999,
                  border: `2px solid ${SEVERITY_STYLES[p.severity].border}`,
                  backgroundColor: SEVERITY_STYLES[p.severity].bg,
                  color: SEVERITY_STYLES[p.severity].color,
                  padding: "10px 24px",
                  fontWeight: 700,
                  fontSize: 28,
                }}
              >
                {p.label}
              </div>
            ))
          ) : (
            <div
              style={{
                display: "flex",
                borderRadius: 9999,
                border: `2px solid ${SEVERITY_STYLES.suggestion.border}`,
                backgroundColor: SEVERITY_STYLES.suggestion.bg,
                color: SEVERITY_STYLES.suggestion.color,
                padding: "10px 24px",
                fontWeight: 700,
                fontSize: 28,
              }}
            >
              No issues found
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", fontSize: 26, color: COLOR.faint }}>
        AI-generated code review
      </div>
    </CardFrame>
  );
}
