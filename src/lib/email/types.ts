export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface VerificationEmailParams {
  name: string;
  verificationUrl: string;
}

export interface OtpEmailParams {
  name: string;
  otp: string;
}
