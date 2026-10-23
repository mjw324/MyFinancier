import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/lib/email/client", () => ({ sesClient: { send } }));

const { sendEmail } = await import("@/lib/email/send");

const EMAIL = {
  to: "dev@finance.localhost",
  subject: "Verify your MyFinancier email",
  html: '<p>Hi Dev</p><a href="http://localhost:3000/api/auth/verify-email?token=abc&amp;callbackURL=%2F">Verify</a>',
};

describe("sendEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    send.mockReset();
  });

  it("prints the email instead of sending it with EMAIL_TRANSPORT=console", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "console");
    vi.stubEnv("NODE_ENV", "development");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendEmail(EMAIL);

    expect(send).not.toHaveBeenCalled();
    const logged = info.mock.calls[0][0] as string;
    expect(logged).toContain("To: dev@finance.localhost");
    expect(logged).toContain("Hi Dev");
    expect(logged).toContain(
      "Link: http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2F",
    );
  });

  it("always sends through SES in production", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "console");
    vi.stubEnv("NODE_ENV", "production");

    await sendEmail(EMAIL);

    expect(send).toHaveBeenCalledOnce();
  });

  it("sends through SES when no transport is set", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");
    vi.stubEnv("NODE_ENV", "development");

    await sendEmail(EMAIL);

    expect(send).toHaveBeenCalledOnce();
  });
});
