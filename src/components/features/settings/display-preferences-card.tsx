"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { updateHideTransfersAction } from "@/app/(routes)/(dashboard)/settings/actions";

interface DisplayPreferencesCardProps {
  hideTransfersFromList: boolean;
}

export function DisplayPreferencesCard({
  hideTransfersFromList,
}: DisplayPreferencesCardProps) {
  const [hide, setHide] = useState(hideTransfersFromList);
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean) => {
    setHide(next);
    startTransition(async () => {
      const res = await updateHideTransfersAction(next);
      if (!res.success) {
        setHide(!next);
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Display preferences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="hide-transfers" className="text-sm font-medium">
              Hide transfers from transactions list
            </Label>
            <p className="text-xs text-muted-foreground">
              Internal transfers between your accounts (e.g. credit card
              payments) are always excluded from income and expense totals.
              Enable this to also hide them from the transactions list.
            </p>
          </div>
          <Switch
            id="hide-transfers"
            checked={hide}
            disabled={pending}
            onCheckedChange={onChange}
          />
        </div>
      </CardContent>
    </Card>
  );
}
