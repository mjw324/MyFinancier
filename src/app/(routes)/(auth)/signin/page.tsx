import { type Metadata } from "next";
import Link from "next/link";
import SignInForm from "./form";
import { SidePanel } from "../_components/side-panel";

export const metadata: Metadata = {
  title: "Sign In",
};

const fontInter = "var(--font-inter), Inter, sans-serif";
const fontTight = "var(--font-inter-tight), 'Inter Tight', sans-serif";

export default function SignInPage() {
  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        display: "flex",
        background: "white",
        color: "#0a0a0c",
      }}
    >
      <SidePanel flavor="signin" variant="H" />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "32px 48px",
          fontFamily: fontInter,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            fontSize: 14,
            color: "#3a3a40",
          }}
        >
          New here?{" "}
          <Link
            href="/signup"
            style={{
              marginLeft: 6,
              color: "#0a0a0c",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Create an account →
          </Link>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            maxWidth: 400,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#71717a",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 500,
              marginBottom: 12,
            }}
          >
            Sign in
          </div>
          <h1
            style={{
              fontFamily: fontTight,
              fontSize: 44,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: "#0a0a0c",
              margin: 0,
              lineHeight: 1.05,
            }}
          >
            Welcome back.
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "#3a3a40",
              marginTop: 12,
              lineHeight: 1.5,
            }}
          >
            Sign in to see your latest transactions, budgets, and safe-to-spend.
          </p>

          <SignInForm />
        </div>

        <div style={{ fontSize: 12, color: "#9494a0", textAlign: "center" }}>
          © 2026 MyFinancier
        </div>
      </div>
    </div>
  );
}
