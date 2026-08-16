import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import type { Settings } from "@shared/schema";

interface ControlPanelProps {
  settings: Settings;
  onSpawnVehicle: () => void;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  spawning: boolean;
}

const WEIGHT_FIELDS: { key: keyof Settings; label: string }[] = [
  { key: "wAiConfidence", label: "AI confidence (w1)" },
  { key: "wCorroboration", label: "Corroboration count (w2)" },
  { key: "wAgreement", label: "Agreement (w3)" },
  { key: "wReliability", label: "Vehicle reliability (w4)" },
  { key: "wHotspotPrior", label: "Hotspot prior (w5)" },
  { key: "wWeather", label: "Weather (w6)" },
  { key: "wTimeOfDay", label: "Time of day (w7)" },
];

export function ControlPanel({
  settings,
  onSpawnVehicle,
  onUpdateSettings,
  spawning,
}: ControlPanelProps) {
  const weightSum = WEIGHT_FIELDS.reduce((s, f) => s + (settings[f.key] as number), 0);

  return (
    <Card className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div>
        <h2 className="text-lg font-semibold">Simulation controls</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Spawn vehicles, tune the algorithm live, and adjust global conditions.
        </p>
      </div>

      <Button
        onClick={onSpawnVehicle}
        disabled={spawning}
        data-testid="button-spawn-vehicle"
        className="gap-2"
      >
        <Plus className="h-4 w-4" />
        Spawn Vehicle
      </Button>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="select-time-of-day" className="text-xs">
            Time of day
          </Label>
          <Select
            value={settings.timeOfDay}
            onValueChange={(v) => onUpdateSettings({ timeOfDay: v as Settings["timeOfDay"] })}
          >
            <SelectTrigger id="select-time-of-day" data-testid="select-time-of-day">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dawn">Dawn</SelectItem>
              <SelectItem value="midday">Midday</SelectItem>
              <SelectItem value="dusk">Dusk</SelectItem>
              <SelectItem value="night">Night</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="select-weather" className="text-xs">
            Weather
          </Label>
          <Select
            value={settings.globalWeather}
            onValueChange={(v) => onUpdateSettings({ globalWeather: v as Settings["globalWeather"] })}
          >
            <SelectTrigger id="select-weather" data-testid="select-weather">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="clear">Clear</SelectItem>
              <SelectItem value="rain">Rain</SelectItem>
              <SelectItem value="fog">Fog</SelectItem>
              <SelectItem value="night">Night</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Alert threshold</Label>
          <span
            className="font-mono text-xs font-semibold text-accent"
            data-testid="text-alert-threshold-value"
          >
            {settings.alertThreshold.toFixed(2)}
          </span>
        </div>
        <Slider
          data-testid="slider-alert-threshold"
          min={0.1}
          max={0.95}
          step={0.01}
          value={[settings.alertThreshold]}
          onValueChange={([v]) => onUpdateSettings({ alertThreshold: v })}
        />
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Algorithm weights</h3>
          <span
            className={`font-mono text-[11px] ${Math.abs(weightSum - 1) > 0.01 ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="text-weight-sum"
          >
            &Sigma; {weightSum.toFixed(2)}
          </span>
        </div>
        {WEIGHT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <span className="font-mono text-[11px]" data-testid={`text-weight-${f.key}`}>
                {(settings[f.key] as number).toFixed(2)}
              </span>
            </div>
            <Slider
              data-testid={`slider-weight-${f.key}`}
              min={0}
              max={0.5}
              step={0.01}
              value={[settings[f.key] as number]}
              onValueChange={([v]) => onUpdateSettings({ [f.key]: v } as Partial<Settings>)}
            />
          </div>
        ))}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Weights should sum to ~1.0 to keep trust scores calibrated between 0 and 1.
        </p>
      </div>
    </Card>
  );
}
