import { z } from "zod";

export const OtpSchema = z.object({
  code: z.string().length(6, { message: "Code must be 6 digits" }),
});

export type OtpValues = z.infer<typeof OtpSchema>;

export const BackupCodeSchema = z.object({
  code: z.string().min(1, { message: "Backup code is required" }),
});

export type BackupCodeValues = z.infer<typeof BackupCodeSchema>;
