"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BackupCodesDisplay } from "./backup-codes-display";

export function TwoFactorCard({
  twoFactorEnabled,
}: {
  twoFactorEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(twoFactorEnabled);
  const [dialog, setDialog] = useState<
    "idle" | "enable" | "disable" | "regenerate" | "show-codes"
  >("idle");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function resetDialog() {
    setDialog("idle");
    setPassword("");
  }

  function handleEnable() {
    startTransition(async () => {
      const { data, error } = await authClient.twoFactor.enable({ password });

      if (error) {
        toast.error(error.message ?? "Failed to enable 2FA");
        return;
      }

      if (data?.backupCodes) {
        setBackupCodes(data.backupCodes);
      }
      setEnabled(true);
      setDialog("show-codes");
      setPassword("");
      router.refresh();
    });
  }

  function handleDisable() {
    startTransition(async () => {
      const { error } = await authClient.twoFactor.disable({ password });

      if (error) {
        toast.error(error.message ?? "Failed to disable 2FA");
        return;
      }

      setEnabled(false);
      resetDialog();
      toast.success("Two-factor authentication has been disabled");
      router.refresh();
    });
  }

  function handleRegenerate() {
    startTransition(async () => {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({
        password,
      });

      if (error) {
        toast.error(error.message ?? "Failed to regenerate backup codes");
        return;
      }

      if (data?.backupCodes) {
        setBackupCodes(data.backupCodes);
      }
      setDialog("show-codes");
      setPassword("");
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Two-Factor Authentication
            </CardTitle>
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add an extra layer of security by requiring a verification code sent
            to your email when signing in.
          </p>
          {enabled ? (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDialog("disable")}
              >
                Disable 2FA
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog("regenerate")}
              >
                Regenerate Backup Codes
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setDialog("enable")}>
              Enable 2FA
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Enable 2FA Dialog */}
      <Dialog
        open={dialog === "enable"}
        onOpenChange={(open) => !open && resetDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password to enable 2FA. You will receive a verification
              code via email each time you sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleEnable}
                disabled={isPending || !password}
              >
                {isPending ? "Enabling..." : "Enable"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disable 2FA Dialog */}
      <Dialog
        open={dialog === "disable"}
        onOpenChange={(open) => !open && resetDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password to disable 2FA. Your account will only be
              protected by your password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetDialog}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisable}
                disabled={isPending || !password}
              >
                {isPending ? "Disabling..." : "Disable"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Regenerate Backup Codes Dialog */}
      <Dialog
        open={dialog === "regenerate"}
        onOpenChange={(open) => !open && resetDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Backup Codes</DialogTitle>
            <DialogDescription>
              This will invalidate all existing backup codes and generate new
              ones. Enter your password to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleRegenerate}
                disabled={isPending || !password}
              >
                {isPending ? "Regenerating..." : "Regenerate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Show Backup Codes Dialog */}
      <Dialog
        open={dialog === "show-codes"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog("idle");
            setBackupCodes([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your Backup Codes</DialogTitle>
            <DialogDescription>
              Save these backup codes in a secure location. You can use them to
              sign in if you lose access to your email.
            </DialogDescription>
          </DialogHeader>
          <BackupCodesDisplay codes={backupCodes} />
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setDialog("idle");
                setBackupCodes([]);
              }}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
