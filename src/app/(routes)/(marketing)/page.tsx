import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/get-session";
import { BrowserMock } from "./_components/browser-mock";
import { LogoMarquee } from "./_components/marquee";
import { WalletGlyph } from "./_components/wallet-glyph";

export const metadata: Metadata = {
  title: "MyFinancier — Spend less time worrying, more time understanding.",
  description:
    "Link your accounts and see your own tailored financial dashboard, full of insights.",
};

const fontInter = "var(--font-inter), Inter, sans-serif";
const fontTight = "var(--font-inter-tight), 'Inter Tight', sans-serif";

export default async function MarketingPage() {
  const session = await getServerSession();
  if (session?.user) redirect("/dashboard");

  return (
    <div style={{ background: "white", color: "#0a0a0c" }}>
      <Hero />
      <div style={{ background: "white", paddingTop: 200 }} />
      <PlaidStrip />
      <HowItWorks />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "22px 56px",
        position: "relative",
        zIndex: 5,
        fontFamily: fontInter,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            color: "#0a0a0c",
          }}
        >
          MyFinancier
        </span>
      </div>
      <div className="hidden lg:flex" style={{ gap: 32, fontSize: 14, color: "#3a3a40" }}>
        {[
          { label: "Features", href: "#features" },
          { label: "How it works", href: "#how-it-works" },
          { label: "Security", href: "#security" },
          { label: "About", href: "#about" },
        ].map((i) => (
          <a
            key={i.label}
            href={i.href}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            {i.label}
          </a>
        ))}
      </div>
      <div
        style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 14 }}
      >
        <Link
          href="/signin"
          style={{ color: "#3a3a40", textDecoration: "none" }}
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          style={{
            padding: "9px 18px",
            borderRadius: 999,
            background: "#0a0a0c",
            color: "white",
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Get started
        </Link>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <div
      style={{
        background:
          "radial-gradient(ellipse 90% 80% at 75% 25%, #f5dcff 0%, #ffe1ec 35%, #ffe8d4 65%, #fff5e8 85%, #fafafa 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Nav />
      <div
        style={{
          padding: "60px 56px 0",
          maxWidth: 1280,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 16px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.65)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.8)",
            fontSize: 12,
            color: "#3a3a40",
            fontFamily: fontInter,
            marginBottom: 36,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              position: "relative",
              display: "inline-flex",
              width: 8,
              height: 8,
            }}
          >
            <span
              className="mf-ping"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: "#1a9355",
              }}
            />
            <span
              style={{
                position: "relative",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#1a9355",
              }}
            />
          </span>
          Now in private beta
        </div>

        <h1
          style={{
            fontFamily: fontTight,
            fontSize: 92,
            fontWeight: 600,
            letterSpacing: "-0.04em",
            color: "#0a0a0c",
            margin: 0,
            lineHeight: 1.0,
            whiteSpace: "pre-line",
          }}
        >
          {"Spend less time worrying,\nmore time understanding."}
        </h1>

        <p
          style={{
            fontSize: 19,
            color: "#3a3a40",
            maxWidth: 580,
            margin: "32px auto 40px",
            lineHeight: 1.55,
            fontFamily: fontInter,
          }}
        >
          Link your accounts and see your own tailored financial dashboard, full
          of insights.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            fontFamily: fontInter,
          }}
        >
          <Link
            href="/signup"
            style={{
              padding: "15px 32px",
              borderRadius: 999,
              background: "#0a0a0c",
              color: "white",
              fontSize: 15,
              fontWeight: 500,
              boxShadow: "0 8px 20px -8px rgba(10,10,12,0.4)",
              textDecoration: "none",
            }}
          >
            Get started →
          </Link>
        </div>

        <div
          id="features"
          style={{
            marginTop: 80,
            display: "flex",
            justifyContent: "center",
            marginBottom: -160,
            position: "relative",
            zIndex: 2,
          }}
        >
          <BrowserMock scale={1.2} />
        </div>
      </div>
    </div>
  );
}

function PlaidStrip() {
  return (
    <section
      id="security"
      style={{
        borderTop: "1px solid #ececef",
        borderBottom: "1px solid #ececef",
        background: "#fafafa",
        overflow: "hidden",
        fontFamily: fontInter,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: 110,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "24px 48px 24px 56px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            borderRight: "1px solid #ececef",
            maxWidth: 700,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0a0a0c"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <div>
            <div
              style={{
                fontSize: 11,
                color: "#71717a",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Bank-grade security
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#0a0a0c",
                fontWeight: 500,
                marginTop: 3,
                letterSpacing: "-0.005em",
                lineHeight: 1.35,
              }}
            >
              Powered by <span style={{ fontWeight: 700 }}>Plaid</span> — the
              same secure connection used by Venmo &amp; Robinhood.
            </div>
          </div>
        </div>
        <LogoMarquee />
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Connect",
      body: "Securely link your bank, credit, and brokerage accounts in seconds — Plaid handles the encrypted handshake.",
    },
    {
      n: "02",
      title: "Sync",
      body: "We pull and categorize your transactions automatically, including recurring bills and subscriptions.",
    },
    {
      n: "03",
      title: "Understand",
      body: "See net worth, spending patterns, safe-to-spend, and budget progress — all in one aggregated view.",
    },
  ];
  return (
    <section
      id="how-it-works"
      style={{
        padding: "140px 56px",
        background: "white",
        fontFamily: fontInter,
      }}
    >
      <div
        style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}
      >
        <div
          style={{
            fontSize: 12,
            color: "#71717a",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 500,
            marginBottom: 16,
          }}
        >
          How it works
        </div>
        <h2
          style={{
            fontFamily: fontTight,
            fontSize: 56,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            color: "#0a0a0c",
            margin: "0 0 80px",
            lineHeight: 1.05,
          }}
        >
          A bird&apos;s-eye view of your finances,
          <br />
          in three steps.
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 48,
          }}
        >
          {steps.map((s) => (
            <div key={s.n} style={{ textAlign: "left" }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 13,
                  border: "1px solid #e4e4e7",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: fontTight,
                  fontSize: 17,
                  fontWeight: 600,
                  color: "#0a0a0c",
                  marginBottom: 24,
                }}
              >
                {s.n}
              </div>
              <div
                style={{
                  fontFamily: fontTight,
                  fontSize: 24,
                  fontWeight: 600,
                  color: "#0a0a0c",
                  letterSpacing: "-0.02em",
                  marginBottom: 10,
                }}
              >
                {s.title}
              </div>
              <div
                style={{ fontSize: 15, color: "#3a3a40", lineHeight: 1.6 }}
              >
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      id="about"
      style={{
        padding: "80px 56px 40px",
        background: "#0a0a0c",
        color: "#9494a0",
        fontFamily: fontInter,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 60,
          marginBottom: 60,
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "white",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "white",
                color: "#0a0a0c",
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
              }}
            >
              MyFinancier
            </span>
          </div>
          <p style={{ fontSize: 14, marginTop: 16, lineHeight: 1.6 }}>
            A better way to see your money. Connect your accounts, watch the
            patterns emerge.
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 140px)",
            gap: 32,
            fontSize: 13,
          }}
        >
          <div>
            <div style={{ color: "white", fontWeight: 600, marginBottom: 12 }}>
              Product
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <a
                href="#features"
                style={{ color: "inherit", textDecoration: "none" }}
              >
                Features
              </a>
              <a
                href="#security"
                style={{ color: "inherit", textDecoration: "none" }}
              >
                Security
              </a>
              <a style={{ color: "inherit", textDecoration: "none" }}>Pricing</a>
            </div>
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 600, marginBottom: 12 }}>
              Company
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <a style={{ color: "inherit", textDecoration: "none" }}>About</a>
              <a style={{ color: "inherit", textDecoration: "none" }}>Contact</a>
            </div>
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 600, marginBottom: 12 }}>
              Legal
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <a style={{ color: "inherit", textDecoration: "none" }}>Privacy</a>
              <a style={{ color: "inherit", textDecoration: "none" }}>Terms</a>
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          borderTop: "1px solid #1f1f24",
          paddingTop: 24,
          fontSize: 12,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <div>© 2026 MyFinancier</div>
        <div>Bank connections secured by Plaid</div>
      </div>
    </footer>
  );
}
