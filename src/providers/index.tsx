import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NextTopLoader from "nextjs-toploader";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <NextTopLoader easing="ease" showSpinner={false} color="var(--primary)" />
      {children}
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}
