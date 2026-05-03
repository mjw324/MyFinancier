import Link from "next/link";
import { Lock } from "lucide-react";
import { WalletGlyph } from "../../(marketing)/_components/wallet-glyph";

const fontInter = "var(--font-inter), Inter, sans-serif";
const fontTight = "var(--font-inter-tight), 'Inter Tight', sans-serif";

const HERO_GRADIENT =
  "radial-gradient(ellipse 90% 80% at 30% 30%, #f5dcff 0%, #ffe1ec 35%, #ffe8d4 65%, #fff5e8 85%, #fafafa 100%)";

function Logo() {
  return (
    <Link
      href="/"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#0a0a0c",
        textDecoration: "none",
        position: "relative",
        zIndex: 2,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: "#0a0a0c",
          color: "white",
          display: "grid",
          placeItems: "center",
        }}
      >
        <WalletGlyph size={16} />
      </div>
      <span
        style={{
          fontFamily: fontTight,
          fontWeight: 600,
          fontSize: 17,
          letterSpacing: "-0.02em",
        }}
      >
        MyFinancier
      </span>
    </Link>
  );
}

// Variant H — tilted dashboard preview window
function VariantH() {
  return (
    <div
      style={{
        position: "absolute",
        top: 110,
        right: -120,
        transform: "rotate(-3deg)",
        width: 460,
        borderRadius: 12,
        overflow: "hidden",
        background: "white",
        boxShadow: "0 40px 80px -30px rgba(50,30,80,0.4)",
        fontFamily: fontInter,
      }}
    >
      <div
        style={{
          height: 22,
          background: "#f4f4f7",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          gap: 4,
          borderBottom: "1px solid #e4e4e7",
        }}
      >
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff5f56" }} />
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ffbd2e" }} />
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#27c93f" }} />
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10 }}>
          Overview · May 2026
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 6,
          }}
        >
          {[
            { l: "Net Worth", v: "$48,392", c: "#3b6df0" },
            { l: "Income", v: "$10,203", c: "#1a9355" },
            { l: "Expenses", v: "$8,191", c: "#dc3a4f" },
            { l: "Savings", v: "20%", c: "#e87515" },
          ].map((s) => (
            <div
              key={s.l}
              style={{
                padding: 10,
                borderRadius: 8,
                background: s.c,
                color: "white",
              }}
            >
              <div style={{ fontSize: 9, opacity: 0.95 }}>{s.l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                {s.v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Variant B — bill calendar peek + safe-to-spend pill
function VariantB() {
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 120,
          right: -10,
          transform: "rotate(3deg)",
          width: 280,
          padding: 16,
          borderRadius: 14,
          background: "white",
          boxShadow: "0 30px 60px -25px rgba(50,30,80,0.25)",
          fontFamily: fontInter,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700 }}>May 2026</div>
          <div style={{ fontSize: 10, color: "#71717a" }}>4 bills upcoming</div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 4,
            fontSize: 9,
            color: "#9494a0",
            textAlign: "center",
          }}
        >
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={`${d}-${i}`}>{d}</div>
          ))}
          {Array.from({ length: 35 }).map((_, i) => {
            const day = i - 4;
            const isBill = [9, 11, 17, 28].includes(day);
            const isPaid = [8, 22].includes(day);
            const inMonth = day >= 1 && day <= 31;
            return (
              <div
                key={i}
                style={{
                  padding: "6px 0",
                  borderRadius: 4,
                  color: inMonth ? "#3a3a40" : "transparent",
                  background: isBill
                    ? "#fee2e2"
                    : isPaid
                      ? "#dcfce7"
                      : "transparent",
                  fontWeight: isBill || isPaid ? 600 : 400,
                  fontSize: 9.5,
                }}
              >
                {inMonth ? day : "·"}
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 220,
          left: -10,
          transform: "rotate(-4deg)",
          padding: "14px 20px",
          borderRadius: 999,
          background: "#0a0a0c",
          color: "white",
          boxShadow: "0 25px 50px -20px rgba(10,10,12,0.4)",
          fontFamily: fontInter,
        }}
      >
        <div
          style={{
            fontSize: 10,
            opacity: 0.7,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Safe to spend
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            marginTop: 2,
            letterSpacing: "-0.02em",
            color: "#7dd3a3",
          }}
        >
          $1,247.50
        </div>
      </div>
    </>
  );
}

const VARIANTS = {
  B: VariantB,
  H: VariantH,
} as const;

export type SidePanelVariant = keyof typeof VARIANTS;

export function SidePanel({
  flavor,
  variant,
}: {
  flavor: "signin" | "signup";
  variant: SidePanelVariant;
}) {
  const Render = VARIANTS[variant];
  return (
    <div
      className="hidden lg:flex"
      style={{
        flex: "0 0 46%",
        background: HERO_GRADIENT,
        position: "relative",
        overflow: "hidden",
        padding: 48,
        flexDirection: "column",
        fontFamily: fontInter,
      }}
    >
      <Logo />
      <Render />
      <div
        style={{
          marginTop: "auto",
          maxWidth: 420,
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            fontFamily: fontTight,
            fontSize: 32,
            fontWeight: 500,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            color: "#0a0a0c",
          }}
        >
          {flavor === "signup"
            ? "A better way to see your money — every account, in one aggregate view."
            : "Time to get the money up, not the funny up."}
        </div>
        <div
          style={{
            marginTop: 24,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "#3a3a40",
            fontSize: 13,
          }}
        >
          <Lock size={14} /> Bank connections secured by Plaid
        </div>
      </div>
    </div>
  );
}
