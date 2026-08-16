import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Header } from "@/components/header";
import { WildlifeMap } from "@/components/wildlife-map";
import { ControlPanel } from "@/components/control-panel";
import { StatsStrip } from "@/components/stats-strip";
import { AboutPanel } from "@/components/about-panel";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import type { Vehicle, HotspotZone, Incident, Settings } from "@shared/schema";

interface StatsResponse {
  totalEvents: number;
  totalIncidents: number;
  alertsFired: number;
  avgTrustScore: number;
  activeZones: number;
  vehicles: Vehicle[];
}

export default function Home() {
  const { toast } = useToast();

  const vehiclesQuery = useQuery<Vehicle[]>({ queryKey: ["/api/vehicles"] });
  const hotspotZonesQuery = useQuery<HotspotZone[]>({ queryKey: ["/api/hotspot-zones"] });
  const incidentsQuery = useQuery<Incident[]>({
    queryKey: ["/api/incidents"],
    refetchInterval: 2500, // poll for decay sweep — zones should visibly expire
  });
  const settingsQuery = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const statsQuery = useQuery<StatsResponse>({
    queryKey: ["/api/stats"],
    refetchInterval: 2500,
  });

  const spawnVehicle = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vehicles", {});
      return res.json();
    },
    onSuccess: (vehicle: Vehicle) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Vehicle spawned", description: `${vehicle.label} is now on the road.` });
    },
  });

  const reportEvent = useMutation({
    mutationFn: async (params: {
      vehicleId: number;
      sourceType: "ai_detection" | "manual_tap";
      aiConfidence: number | null;
      species: "deer" | "elk" | "moose" | "unknown";
    }) => {
      const vehicle = vehiclesQuery.data?.find((v) => v.id === params.vehicleId);
      const weather = settingsQuery.data?.globalWeather ?? "clear";
      const res = await apiRequest("POST", "/api/events", {
        vehicleId: params.vehicleId,
        sourceType: params.sourceType,
        aiConfidence: params.aiConfidence,
        species: params.species,
        lat: vehicle?.lat ?? 33.3255,
        lon: vehicle?.lon ?? -96.7847,
        heading: vehicle?.heading ?? 0,
        speedKph: vehicle?.speedKph ?? 100,
        weather,
      });
      return res.json();
    },
    onSuccess: (data: { incident: Incident }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      const tier =
        data.incident.status === "alert_fired"
          ? "Alert fired"
          : `Trust score ${(data.incident.trustScore * 100).toFixed(0)}%`;
      toast({ title: "Sighting reported", description: tier });
    },
  });

  const submitFeedback = useMutation({
    mutationFn: async ({
      incidentId,
      response,
    }: {
      incidentId: number;
      response: "confirmed" | "denied";
    }) => {
      // Attribute feedback to the first vehicle that contributed to this incident.
      const incident = incidentsQuery.data?.find((i) => i.id === incidentId);
      const eventIds: number[] = incident ? JSON.parse(incident.eventIds) : [];
      const vehicleId = vehiclesQuery.data?.[0]?.id ?? 1;
      const res = await apiRequest("POST", "/api/feedback", {
        incidentId,
        vehicleId,
        response,
      });
      void eventIds;
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: variables.response === "confirmed" ? "Feedback: confirmed" : "Feedback: denied",
        description: "Vehicle reliability scores updated.",
      });
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const res = await apiRequest("PUT", "/api/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  // Seed with two vehicles on first load for a livelier cold-open demo.
  useEffect(() => {
    if (vehiclesQuery.isSuccess && vehiclesQuery.data && vehiclesQuery.data.length === 0) {
      spawnVehicle.mutate();
      setTimeout(() => spawnVehicle.mutate(), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclesQuery.isSuccess]);

  const settings = settingsQuery.data;
  const activeZones = incidentsQuery.data?.filter((i) => i.status !== "expired").length ?? 0;

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading simulation…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header activeZones={activeZones} />

      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 lg:flex-row lg:overflow-hidden">
        <div className="flex flex-1 flex-col gap-4 lg:min-h-0">
          <div className="h-[420px] shrink-0 lg:h-auto lg:flex-1 lg:min-h-0">
            <WildlifeMap
              vehicles={vehiclesQuery.data ?? []}
              hotspotZones={hotspotZonesQuery.data ?? []}
              incidents={incidentsQuery.data ?? []}
              alertThreshold={settings.alertThreshold}
              onReportEvent={(p) => reportEvent.mutate(p)}
              onFeedback={(incidentId, response) =>
                submitFeedback.mutate({ incidentId, response })
              }
              defaultSpecies="deer"
            />
          </div>
          <StatsStrip
            totalEvents={statsQuery.data?.totalEvents ?? 0}
            totalIncidents={statsQuery.data?.totalIncidents ?? 0}
            alertsFired={statsQuery.data?.alertsFired ?? 0}
            avgTrustScore={statsQuery.data?.avgTrustScore ?? 0}
            vehicles={statsQuery.data?.vehicles ?? vehiclesQuery.data ?? []}
          />
          <AboutPanel />
        </div>

        <div className="w-full shrink-0 lg:h-full lg:w-[320px]">
          <ControlPanel
            settings={settings}
            onSpawnVehicle={() => spawnVehicle.mutate()}
            onUpdateSettings={(patch) => updateSettings.mutate(patch)}
            spawning={spawnVehicle.isPending}
          />
        </div>
      </main>
    </div>
  );
}
