"use client";

import { WalletGlyph } from "./wallet-glyph";

const fontInter = "var(--font-inter), Inter, sans-serif";
const fontTight = "var(--font-inter-tight), 'Inter Tight', sans-serif";

const PHONE_W = 280;
const PHONE_H = 580;

export function PhoneMock() {
  return (
    <div
      style={{
        width: PHONE_W,
        height: PHONE_H,
        borderRadius: 44,
        background: "#0a0a0c",
        padding: 8,
        boxShadow:
          "0 50px 100px -40px rgba(50,30,80,0.35), 0 25px 50px -20px rgba(50,30,80,0.18)",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 36,
          background: "white",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          fontFamily: fontInter,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 90,
            height: 22,
            borderRadius: 999,
            background: "#0a0a0c",
            zIndex: 5,
          }}
        />

        <div
          style={{
            padding: "36px 18px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderBottom: "1px solid #f0f0f3",
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "#0a0a0c",
              color: "white",
              display: "grid",
              placeItems: "center",
            }}
          >
            <WalletGlyph size={13} />
          </div>
          <span
            style={{
              fontFamily: fontTight,
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: "-0.02em",
              color: "#0a0a0c",
            }}
          >
            MyFinancier
          </span>
        </div>

        <div
          style={{
            padding: "16px 16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <StatRow label="Net Worth" value="$48,212.30" tone="#1a9355" delta="+2.4%" />
          <StatRow label="Safe to Spend" value="$1,247.50" tone="#3b6df0" delta="this week" />
        </div>

        <div
          style={{
            margin: "0 16px",
            padding: 14,
            borderRadius: 12,
            border: "1px solid #f0f0f3",
            background: "#fafafa",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#71717a",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Spending · 30d
          </div>
          <MiniChart />
        </div>

        <div style={{ padding: "14px 16px 16px", flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              color: "#71717a",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 500,
              marginBottom: 10,
            }}
          >
            Recent
          </div>
          <TxRow merchant="Whole Foods" cat="Groceries" amount="-$72.40" />
          <TxRow merchant="Spotify" cat="Subscriptions" amount="-$10.99" />
          <TxRow merchant="Payroll" cat="Income" amount="+$3,420.00" income />
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 110,
            height: 4,
            borderRadius: 999,
            background: "#0a0a0c",
            opacity: 0.85,
          }}
        />
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  tone,
  delta,
}: {
  label: string;
  value: string;
  tone: string;
  delta: string;
}) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px solid #f0f0f3",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            color: "#71717a",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: fontTight,
            fontSize: 18,
            fontWeight: 600,
            color: "#0a0a0c",
            letterSpacing: "-0.02em",
            marginTop: 2,
          }}
        >
          {value}
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: tone,
          background: `${tone}15`,
          padding: "4px 8px",
          borderRadius: 999,
        }}
      >
        {delta}
      </div>
    </div>
  );
}

function MiniChart() {
  const points = [10, 22, 16, 28, 20, 34, 26, 38, 30, 44, 36, 42];
  const max = Math.max(...points);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 4,
        height: 56,
      }}
    >
      {points.map((p, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(p / max) * 100}%`,
            background: "linear-gradient(180deg, #5b8af7 0%, #3b6df0 100%)",
            borderRadius: 3,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

function TxRow({
  merchant,
  cat,
  amount,
  income,
}: {
  merchant: string;
  cat: string;
  amount: string;
  income?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid #f4f4f7",
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#0a0a0c" }}>
          {merchant}
        </div>
        <div style={{ fontSize: 11, color: "#71717a", marginTop: 1 }}>{cat}</div>
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          fontFamily: fontTight,
          color: income ? "#1a9355" : "#0a0a0c",
        }}
      >
        {amount}
      </div>
    </div>
  );
}
