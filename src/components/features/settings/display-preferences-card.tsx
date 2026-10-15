import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getDetectedTimeZone, getSavedTimeZone } from "@/lib/utils/user-time";
import { HideTransfersSwitch } from "./hide-transfers-switch";
import { TimeZonePreference } from "./time-zone-preference";

interface DisplayPreferencesCardProps {
  hideTransfersFromList: boolean;
}

/**
 * Server component: reads the detected (cookie) and saved time zones itself,
 * so the settings page only passes the transfer preference.
 */
export async function DisplayPreferencesCard({
  hideTransfersFromList,
}: DisplayPreferencesCardProps) {
  const [detected, saved] = await Promise.all([
    getDetectedTimeZone(),
    getSavedTimeZone(),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Display preferences</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TimeZonePreference detected={detected} saved={saved} />
        <Separator />
        <HideTransfersSwitch initial={hideTransfersFromList} />
      </CardContent>
    </Card>
  );
}
