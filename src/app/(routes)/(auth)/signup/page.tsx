import { type Metadata } from "next";
import Link from "next/link";
import SignUpForm from "./form";
import { SidePanel } from "../_components/side-panel";

export const metadata: Metadata = {
  title: "Sign Up",
};

const fontInter = "var(--font-inter), Inter, sans-serif";
const fontTight = "var(--font-inter-tight), 'Inter Tight', sans-serif";

export default function SignUpPage() {
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
      <SidePanel flavor="signup" variant="B" />
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
          Already have an account?{" "}
          <Link
            href="/signin"
            style={{
              marginLeft: 6,
              color: "#0a0a0c",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Sign in →
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
            paddingTop: 16,
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
            Create your account
          </div>
          <h1
            style={{
              fontFamily: fontTight,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: "#0a0a0c",
              margin: 0,
              lineHeight: 1.05,
            }}
          >
            Start understanding
            <br />
            your money.
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#3a3a40",
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            Free during private beta. Connect your accounts after sign-up.
          </p>

          <SignUpForm />
        </div>
      </div>
    </div>
  );
}
