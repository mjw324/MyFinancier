import { emailLayout } from "./layout";

export interface DigestEmailParams {
  items: Array<{ title: string; body: string }>;
  dashboardUrl: string;
  settingsUrl: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Digest text is model-phrased, so everything is escaped; no model text becomes markup. */
export function digestEmailTemplate({ items, dashboardUrl, settingsUrl }: DigestEmailParams): string {
  const rows = items
    .map(
      (item) => `
    <div style="margin:0 0 20px;padding:16px;border:1px solid #e4e4e7;border-radius:8px;">
      <p style="margin:0 0 6px;color:#0a0a0a;font-size:16px;font-weight:600;">${escapeHtml(item.title)}</p>
      <p style="margin:0;color:#3f3f46;font-size:14px;line-height:1.5;">${escapeHtml(item.body)}</p>
    </div>`,
    )
    .join("");
  return emailLayout(`
    <h2 style="margin:0 0 16px;color:#0a0a0a;font-size:22px;font-weight:600;">Your week in money</h2>
    ${rows}
    <p style="margin:24px 0 0;">
      <a href="${escapeHtml(dashboardUrl)}" style="color:#0a0a0a;font-weight:600;">Open your dashboard</a>
    </p>
    <p style="margin:24px 0 0;color:#71717a;font-size:12px;line-height:1.5;">
      Figures are computed by MyFinancier from your synced transactions; the wording is written by AI.
      You get this because AI insights are on. <a href="${escapeHtml(settingsUrl)}" style="color:#71717a;">Turn them off in Settings</a>.
    </p>
  `);
}
