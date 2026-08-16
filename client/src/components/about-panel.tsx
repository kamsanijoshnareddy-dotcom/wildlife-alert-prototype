import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import { ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function AboutPanel() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            data-testid="button-toggle-about"
            className="flex w-full items-center justify-between gap-2 p-3 text-left hover-elevate"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4 text-primary" />
              About this prototype
            </span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              This is a simulation of the verification/corroboration algorithm behind a
              wildlife-vehicle-collision alert concept. Vehicles and sighting reports here are
              generated client-side by you, the demo operator — but the clustering, trust
              scoring, zone decay, and reliability feedback loop all run as real server-side
              logic against a persistent database, not hardcoded or faked values.
            </p>
            <p>
              A production version would replace simulated taps with real phone GPS and
              on-device camera AI detection running in a driver's vehicle.
            </p>
            <p>
              Zone decay is intentionally compressed for demo usability: incidents decay over
              roughly 45-60 seconds here, versus the ~20-30 minute half-life planned for
              production, so you can watch alert zones appear and fade within a normal demo
              session.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
