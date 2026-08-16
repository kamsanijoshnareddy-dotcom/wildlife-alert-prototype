import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, Radio, TriangleAlert, Gauge } from "lucide-react";
import type { Vehicle } from "@shared/schema";

interface StatsStripProps {
  totalEvents: number;
  totalIncidents: number;
  alertsFired: number;
  avgTrustScore: number;
  vehicles: Vehicle[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold leading-tight" data-testid={testId}>
          {value}
        </div>
      </div>
    </Card>
  );
}

export function StatsStrip({
  totalEvents,
  totalIncidents,
  alertsFired,
  avgTrustScore,
  vehicles,
}: StatsStripProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Activity} label="Events submitted" value={String(totalEvents)} testId="text-stat-events" />
        <StatCard icon={Radio} label="Incidents formed" value={String(totalIncidents)} testId="text-stat-incidents" />
        <StatCard icon={TriangleAlert} label="Alerts fired" value={String(alertsFired)} testId="text-stat-alerts" />
        <StatCard
          icon={Gauge}
          label="Avg trust score"
          value={`${(avgTrustScore * 100).toFixed(0)}%`}
          testId="text-stat-avg-trust"
        />
      </div>

      <Card className="p-3">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Vehicle reliability</h3>
        {vehicles.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="text-no-vehicles">
            No vehicles spawned yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-xs">Vehicle</TableHead>
                <TableHead className="h-8 text-xs">Speed</TableHead>
                <TableHead className="h-8 text-right text-xs">Reliability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((v) => (
                <TableRow key={v.id} data-testid={`row-vehicle-${v.id}`}>
                  <TableCell className="py-1.5 text-xs font-medium">{v.label}</TableCell>
                  <TableCell className="py-1.5 text-xs text-muted-foreground">
                    {Math.round(v.speedKph)} km/h
                  </TableCell>
                  <TableCell className="py-1.5 text-right text-xs font-mono" data-testid={`text-reliability-${v.id}`}>
                    {(v.reliabilityScore * 100).toFixed(0)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
