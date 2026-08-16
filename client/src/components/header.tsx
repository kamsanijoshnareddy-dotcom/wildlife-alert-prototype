import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";
import { Moon, Sun } from "lucide-react";

interface HeaderProps {
  activeZones: number;
}

export function Header({ activeZones }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
      <div className="flex items-center gap-2.5">
        <Logo className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-sm font-semibold leading-tight sm:text-base">
            Verified Wildlife Alert
          </h1>
          <p className="text-[11px] leading-tight text-muted-foreground">
            Corroboration engine prototype
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="gap-1.5 bg-secondary"
          data-testid="badge-active-zones"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-status-medium" />
          Active alert zones: <span className="font-mono">{activeZones}</span>
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
