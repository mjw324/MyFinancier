import { WalletGlyph } from "./wallet-glyph";

const fontInter = "var(--font-inter), Inter, sans-serif";

type Tone = "blue" | "green" | "red" | "orange";

const GRADS: Record<Tone, string> = {
  blue: "linear-gradient(135deg, #3b6df0 0%, #5b8af7 100%)",
  green: "linear-gradient(135deg, #1a9355 0%, #2bb070 100%)",
  red: "linear-gradient(135deg, #dc3a4f 0%, #ee5a6f 100%)",
  orange: "linear-gradient(135deg, #e87515 0%, #f59538 100%)",
};

function StatCardMini({
  label,
  value,
  sub,
  tone,
  scale,
}: {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  scale: number;
}) {
  return (
    <div
      style={{
        padding: 16 * scale,
        borderRadius: 14 * scale,
        background: GRADS[tone],
        color: "white",
        fontFamily: fontInter,
        boxShadow: "0 12px 32px -16px rgba(20,20,40,0.25)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 12 * scale, opacity: 0.95, fontWeight: 500 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22 * scale,
          fontWeight: 700,
          marginTop: 14 * scale,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10 * scale, opacity: 0.85, marginTop: 4 * scale }}>
        {sub}
      </div>
    </div>
  );
}

function SpendingOverTime({ scale }: { scale: number }) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 12 * scale,
        padding: 16 * scale,
        border: "1px solid #f0f0f3",
        fontFamily: fontInter,
      }}
    >
      <div
        style={{
          fontSize: 13 * scale,
          fontWeight: 700,
          color: "#0a0a0c",
          letterSpacing: "-0.01em",
        }}
      >
        Spending Over Time
      </div>
      <svg
        viewBox="0 0 280 100"
        style={{ width: "100%", height: 100 * scale, marginTop: 8 * scale }}
      >
        <defs>
          <linearGradient id="orgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 40, 60, 80].map((y) => (
          <line
            key={y}
            x1="20"
            y1={y}
            x2="280"
            y2={y}
            stroke="#f4f4f7"
            strokeWidth="0.5"
          />
        ))}
        {[
          { y: 20, v: "$800" },
          { y: 40, v: "$400" },
          { y: 60, v: "$200" },
          { y: 80, v: "$0" },
        ].map((t) => (
          <text
            key={t.v}
            x="0"
            y={t.y + 3}
            fontSize="6"
            fill="#9494a0"
            fontFamily={fontInter}
          >
            {t.v}
          </text>
        ))}
        <path
          d="M22,18 C40,18 50,82 70,82 C90,82 100,72 120,72 C140,72 150,82 170,82 C190,82 200,55 220,55 C240,55 250,82 268,82"
          stroke="#f97316"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M22,18 C40,18 50,82 70,82 C90,82 100,72 120,72 C140,72 150,82 170,82 C190,82 200,55 220,55 C240,55 250,82 268,82 L268,90 L22,90 Z"
          fill="url(#orgFill)"
        />
        {["Apr 27", "Apr 29", "May 1"].map((l, i) => (
          <text
            key={l}
            x={30 + i * 110}
            y="98"
            fontSize="6"
            fill="#9494a0"
            fontFamily={fontInter}
          >
            {l}
          </text>
        ))}
      </svg>
    </div>
  );
}

function SpendingByCategory({ scale }: { scale: number }) {
  const cats = [
    { name: "Food & Drink", amt: "$812", color: "#3b6df0", pct: 32 },
    { name: "Transit", amt: "$410", color: "#1a9355", pct: 22 },
    { name: "Bills", amt: "$342", color: "#e87515", pct: 18 },
    { name: "Shopping", amt: "$268", color: "#dc3a4f", pct: 14 },
    { name: "Other", amt: "$180", color: "#9494a0", pct: 14 },
  ];
  let offset = 0;
  return (
    <div
      style={{
        background: "white",
        borderRadius: 12 * scale,
        padding: 16 * scale,
        border: "1px solid #f0f0f3",
        fontFamily: fontInter,
      }}
    >
      <div
        style={{
          fontSize: 13 * scale,
          fontWeight: 700,
          color: "#0a0a0c",
          letterSpacing: "-0.01em",
        }}
      >
        Spending by Category
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14 * scale,
          marginTop: 10 * scale,
        }}
      >
        <svg width={88 * scale} height={88 * scale} viewBox="0 0 36 36">
          {cats.map((c, i) => {
            const dash = c.pct * 0.88;
            const seg = (
              <circle
                key={i}
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke={c.color}
                strokeWidth="6"
                strokeDasharray={`${dash} 88`}
                strokeDashoffset={-offset}
                transform="rotate(-90 18 18)"
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return seg;
          })}
        </svg>
        <div
          style={{
            fontSize: 10 * scale,
            lineHeight: 1.6,
            color: "#3a3a40",
            flex: 1,
          }}
        >
          {cats.slice(0, 4).map((c) => (
            <div
              key={c.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 2,
              }}
            >
              <div>
                <span
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    background: c.color,
                    marginRight: 6,
                  }}
                />
                {c.name}
              </div>
              <span style={{ fontWeight: 600, color: "#0a0a0c" }}>{c.amt}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SafeToSpend({ scale }: { scale: number }) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 12 * scale,
        padding: 16 * scale,
        border: "1px solid #f0f0f3",
        fontFamily: fontInter,
      }}
    >
      <div
        style={{
          fontSize: 13 * scale,
          fontWeight: 700,
          color: "#0a0a0c",
          letterSpacing: "-0.01em",
        }}
      >
        Safe to spend
      </div>
      <div
        style={{
          display: "inline-block",
          marginTop: 8 * scale,
          fontSize: 9 * scale,
          color: "#3a3a40",
          border: "1px solid #e4e4e7",
          borderRadius: 6 * scale,
          padding: "3px 8px",
        }}
      >
        Next paycheck ▾
      </div>
      <div
        style={{
          fontSize: 24 * scale,
          fontWeight: 700,
          color: "#1a9355",
          marginTop: 10 * scale,
          letterSpacing: "-0.02em",
        }}
      >
        $1,247.50
      </div>
      <div style={{ fontSize: 9 * scale, color: "#71717a", marginTop: 2 * scale }}>
        after $2,477.97 in upcoming bills
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6 * scale,
          marginTop: 10 * scale,
        }}
      >
        {[
          { label: "Balance", val: "$2,823", color: "#0a0a0c" },
          { label: "Inflows", val: "+$5,131", color: "#1a9355" },
          { label: "Outflows", val: "-$2,477", color: "#dc3a4f" },
        ].map((c) => (
          <div
            key={c.label}
            style={{
              border: "1px solid #f0f0f3",
              borderRadius: 6 * scale,
              padding: `${6 * scale}px ${8 * scale}px`,
            }}
          >
            <div style={{ fontSize: 8 * scale, color: "#71717a" }}>{c.label}</div>
            <div
              style={{ fontSize: 10 * scale, fontWeight: 600, color: c.color }}
            >
              {c.val}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BrowserMock({ scale = 1 }: { scale?: number }) {
  const W = 920 * scale;
  return (
    <div
      style={{
        width: W,
        borderRadius: 14 * scale,
        overflow: "hidden",
        background: "white",
        boxShadow:
          "0 50px 100px -40px rgba(50,30,80,0.35), 0 25px 50px -20px rgba(50,30,80,0.18)",
      }}
    >
      <div
        style={{
          height: 36 * scale,
          background: "#f4f4f7",
          display: "flex",
          alignItems: "center",
          padding: `0 ${14 * scale}px`,
          gap: 6 * scale,
          borderBottom: "1px solid #e4e4e7",
        }}
      >
        <div
          style={{
            width: 11 * scale,
            height: 11 * scale,
            borderRadius: "50%",
            background: "#ff5f56",
          }}
        />
        <div
          style={{
            width: 11 * scale,
            height: 11 * scale,
            borderRadius: "50%",
            background: "#ffbd2e",
          }}
        />
        <div
          style={{
            width: 11 * scale,
            height: 11 * scale,
            borderRadius: "50%",
            background: "#27c93f",
          }}
        />
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              fontSize: 10 * scale,
              color: "#9494a0",
              fontFamily: fontInter,
              padding: "4px 12px",
              background: "white",
              borderRadius: 6 * scale,
              border: "1px solid #e4e4e7",
            }}
          >
            my-financier.com/dashboard
          </div>
        </div>
      </div>
      <div style={{ display: "flex" }}>
        <div
          style={{
            width: 160 * scale,
            padding: `${18 * scale}px ${14 * scale}px`,
            background: "#fafafa",
            borderRight: "1px solid #f0f0f3",
            fontFamily: fontInter,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6 * scale,
              marginBottom: 24 * scale,
            }}
          >
            <div
              style={{
                width: 22 * scale,
                height: 22 * scale,
                borderRadius: 5 * scale,
                background: "#0a0a0c",
                color: "white",
                display: "grid",
                placeItems: "center",
              }}
            >
              <WalletGlyph size={12 * scale} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 11 * scale,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                }}
              >
                MyFinancier
              </div>
              <div style={{ fontSize: 8 * scale, color: "#9494a0" }}>
                Personal Finance
              </div>
            </div>
          </div>
          {[
            { t: "Overview", active: true },
            { t: "Accounts" },
            { t: "Transactions" },
            { t: "Budgets" },
            { t: "Settings" },
          ].map((it) => (
            <div
              key={it.t}
              style={{
                fontSize: 10 * scale,
                padding: `${7 * scale}px ${10 * scale}px`,
                borderRadius: 6 * scale,
                background: it.active ? "#f0f0f3" : "transparent",
                color: it.active ? "#0a0a0c" : "#71717a",
                fontWeight: it.active ? 600 : 400,
                marginBottom: 2 * scale,
              }}
            >
              {it.t}
            </div>
          ))}
        </div>
        <div
          style={{ flex: 1, padding: 20 * scale, fontFamily: fontInter }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14 * scale,
            }}
          >
            <div
              style={{
                fontSize: 16 * scale,
                fontWeight: 700,
                color: "#0a0a0c",
                letterSpacing: "-0.02em",
              }}
            >
              Overview
            </div>
            <div
              style={{
                fontSize: 9 * scale,
                padding: "5px 10px",
                border: "1px solid #e4e4e7",
                borderRadius: 6 * scale,
                color: "#3a3a40",
              }}
            >
              Past Month ▾
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10 * scale,
            }}
          >
            <StatCardMini
              label="Net Worth"
              value="$2,322"
              sub="+$540 past month"
              tone="blue"
              scale={scale * 0.8}
            />
            <StatCardMini
              label="Income"
              value="$10,203"
              sub="55% vs prev period"
              tone="green"
              scale={scale * 0.8}
            />
            <StatCardMini
              label="Expenses"
              value="$9,662"
              sub="95% of income"
              tone="red"
              scale={scale * 0.8}
            />
            <StatCardMini
              label="Savings"
              value="5%"
              sub="$540.5 saved"
              tone="orange"
              scale={scale * 0.8}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr",
              gap: 10 * scale,
              marginTop: 10 * scale,
            }}
          >
            <SpendingOverTime scale={scale} />
            <SpendingByCategory scale={scale} />
          </div>
          <div style={{ marginTop: 10 * scale }}>
            <SafeToSpend scale={scale} />
          </div>
        </div>
      </div>
    </div>
  );
}
