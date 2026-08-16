import { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import { config as maplibreConfig } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Vehicle, HotspotZone, Incident } from "@shared/schema";
import { trustTier, TIER_HEX, incidentRemainingFraction, parseBreakdown } from "@/lib/trust";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";

// MapLibre GL JS cannot auto-detect its worker script URL under Vite's build
// output (it would otherwise request an unhashed path that 404s and falls
// through to the SPA's index.html, silently breaking all tile loading).
// Explicitly point it at the Vite-bundled worker asset before any Map is created.
// Served verbatim from client/public/vendor/ (copied from node_modules/maplibre-gl/dist/)
// so the worker's internal `import "./maplibre-gl-shared.mjs"` resolves correctly.
// A Vite `?url` import only copies the worker file itself, not its sibling chunk,
// which silently 404s inside the worker and kills it moments after creation.
maplibreConfig.WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ROAD_CENTER: [number, number] = [-96.7847, 33.3255];

interface WildlifeMapProps {
  vehicles: Vehicle[];
  hotspotZones: HotspotZone[];
  incidents: Incident[];
  alertThreshold: number;
  onReportEvent: (params: {
    vehicleId: number;
    sourceType: "ai_detection" | "manual_tap";
    aiConfidence: number | null;
    species: "deer" | "elk" | "moose" | "unknown";
  }) => void;
  onFeedback: (incidentId: number, response: "confirmed" | "denied") => void;
  defaultSpecies: "deer" | "elk" | "moose" | "unknown";
}

function circlePolygon(lat: number, lon: number, radiusM: number, points = 64): GeoJSON.Position[] {
  const coords: GeoJSON.Position[] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = (radiusM * Math.cos(angle)) / (111320 * Math.cos(latRad));
    const dy = (radiusM * Math.sin(angle)) / 111320;
    coords.push([lon + dx, lat + dy]);
  }
  return coords;
}

export function WildlifeMap({
  vehicles,
  hotspotZones,
  incidents,
  alertThreshold,
  onReportEvent,
  onFeedback,
  defaultSpecies,
}: WildlifeMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const { theme } = useTheme();

  // --- Map init ---------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: ROAD_CENTER,
      zoom: 13,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.on("error", (e) => {
      console.error("MAPLIBRE ERROR:", e.error?.message || e.error || e);
    });

    map.on("load", () => {
      // Hotspot zones layer
      map.addSource("hotspot-zones", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "hotspot-zones-fill",
        type: "fill",
        source: "hotspot-zones",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.08,
        },
      });
      map.addLayer({
        id: "hotspot-zones-line",
        type: "line",
        source: "hotspot-zones",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.5,
          "line-dasharray": [2, 2],
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "hotspot-zones-label",
        type: "symbol",
        source: "hotspot-zones",
        layout: {
          "symbol-placement": "point",
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 0],
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": theme === "dark" ? "#0b1220" : "#ffffff",
          "text-halo-width": 1.2,
        },
      });

      // Incidents layer (colored circles sized/colored by trust score)
      map.addSource("incidents", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "incidents-fill",
        type: "fill",
        source: "incidents",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["get", "fillOpacity"],
        },
      });
      map.addLayer({
        id: "incidents-line",
        type: "line",
        source: "incidents",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": ["get", "lineOpacity"],
        },
      });

      // Vehicles layer (directional triangle markers)
      map.addSource("vehicles", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "vehicles-point",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": 7,
          "circle-color": theme === "dark" ? "#38bdf8" : "#0e7490",
          "circle-stroke-width": 2,
          "circle-stroke-color": theme === "dark" ? "#0b1220" : "#ffffff",
        },
      });
      // Small heading tick mark rendered as a rotated label dash keeps the
      // directional cue visible without requiring a custom sprite/image.
      map.addLayer({
        id: "vehicles-heading",
        type: "symbol",
        source: "vehicles",
        layout: {
          "text-field": "\u2191",
          "text-size": 14,
          "text-rotate": ["get", "heading"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": theme === "dark" ? "#38bdf8" : "#0e7490",
          "text-halo-color": theme === "dark" ? "#0b1220" : "#ffffff",
          "text-halo-width": 1,
        },
      });

      setMapReady(true);
    });

    // Click handlers
    map.on("click", "vehicles-point", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const vehicleId = feature.properties?.id;
      openVehiclePopover(map, vehicleId, e.lngLat);
    });
    map.on("click", "incidents-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const incidentId = feature.properties?.id;
      openIncidentPopover(map, incidentId, e.lngLat);
    });
    map.on("mouseenter", "vehicles-point", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "vehicles-point", () => (map.getCanvas().style.cursor = ""));
    map.on("mouseenter", "incidents-fill", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "incidents-fill", () => (map.getCanvas().style.cursor = ""));

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Popovers -----------------------------------------------------------
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;
  const incidentsRef = useRef(incidents);
  incidentsRef.current = incidents;
  const thresholdRef = useRef(alertThreshold);
  thresholdRef.current = alertThreshold;
  const defaultSpeciesRef = useRef(defaultSpecies);
  defaultSpeciesRef.current = defaultSpecies;

  const reportRef = useRef(onReportEvent);
  reportRef.current = onReportEvent;
  const feedbackRef = useRef(onFeedback);
  feedbackRef.current = onFeedback;

  const openVehiclePopover = useCallback((map: maplibregl.Map, vehicleId: number, lngLat: maplibregl.LngLat) => {
    const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
    if (!vehicle) return;
    popupRef.current?.remove();

    const container = document.createElement("div");
    container.setAttribute("data-testid", `popover-vehicle-${vehicleId}`);
    container.className = "min-w-[220px] space-y-2 p-1";
    container.innerHTML = `
      <div class="text-sm font-semibold">${vehicle.label}</div>
      <div class="text-xs text-muted-foreground">Reliability: ${(vehicle.reliabilityScore * 100).toFixed(0)}%</div>
    `;

    const speciesSelect = document.createElement("select");
    speciesSelect.setAttribute("data-testid", `select-species-${vehicleId}`);
    speciesSelect.className =
      "w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 mt-1";
    ["deer", "elk", "moose", "unknown"].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
      if (s === defaultSpeciesRef.current) opt.selected = true;
      speciesSelect.appendChild(opt);
    });
    container.appendChild(speciesSelect);

    const btnRow = document.createElement("div");
    btnRow.className = "flex flex-col gap-1.5 mt-2";

    const aiBtn = document.createElement("button");
    aiBtn.setAttribute("data-testid", `button-report-ai-${vehicleId}`);
    aiBtn.className =
      "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium h-8 px-3 hover-elevate active-elevate-2";
    aiBtn.textContent = "Report Animal (AI Detection)";
    aiBtn.onclick = () => {
      const confidence = 0.4 + Math.random() * 0.55;
      reportRef.current({
        vehicleId,
        sourceType: "ai_detection",
        aiConfidence: Math.round(confidence * 100) / 100,
        species: speciesSelect.value as any,
      });
      popupRef.current?.remove();
    };

    const manualBtn = document.createElement("button");
    manualBtn.setAttribute("data-testid", `button-report-manual-${vehicleId}`);
    manualBtn.className =
      "inline-flex items-center justify-center gap-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium h-8 px-3 hover-elevate active-elevate-2";
    manualBtn.textContent = "Report Animal (Manual Tap)";
    manualBtn.onclick = () => {
      reportRef.current({
        vehicleId,
        sourceType: "manual_tap",
        aiConfidence: null,
        species: speciesSelect.value as any,
      });
      popupRef.current?.remove();
    };

    btnRow.appendChild(aiBtn);
    btnRow.appendChild(manualBtn);
    container.appendChild(btnRow);

    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
      .setLngLat(lngLat)
      .setDOMContent(container)
      .addTo(map);
  }, []);

  const openIncidentPopover = useCallback((map: maplibregl.Map, incidentId: number, lngLat: maplibregl.LngLat) => {
    const incident = incidentsRef.current.find((i) => i.id === incidentId);
    if (!incident) return;
    popupRef.current?.remove();

    const tier = trustTier(incident.trustScore, thresholdRef.current);
    const breakdown = parseBreakdown(incident);

    const container = document.createElement("div");
    container.setAttribute("data-testid", `popover-incident-${incidentId}`);
    container.className = "min-w-[240px] space-y-2 p-1";

    const rows: [string, number][] = [
      ["AI confidence", breakdown.aiConfidenceTerm],
      ["Corroboration", breakdown.corroborationTerm],
      ["Agreement", breakdown.agreementTerm],
      ["Vehicle reliability", breakdown.reliabilityTerm],
      ["Hotspot prior", breakdown.hotspotTerm],
      ["Weather", breakdown.weatherTerm],
      ["Time of day", breakdown.timeOfDayTerm],
    ];

    container.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">Incident #${incidentId}</div>
        <span class="text-xs font-bold" style="color:${TIER_HEX[tier]}">${(incident.trustScore * 100).toFixed(0)}%</span>
      </div>
      <div class="text-xs text-muted-foreground">${breakdown.distinctVehicleCount} vehicle(s) corroborating</div>
      <div class="space-y-0.5 mt-1">
        ${rows
          .map(
            ([label, val]) =>
              `<div class="flex justify-between text-[11px]"><span class="text-muted-foreground">${label}</span><span class="font-mono">+${val.toFixed(3)}</span></div>`
          )
          .join("")}
      </div>
    `;

    const btnRow = document.createElement("div");
    btnRow.className = "flex gap-1.5 mt-2";

    const confirmBtn = document.createElement("button");
    confirmBtn.setAttribute("data-testid", `button-confirm-${incidentId}`);
    confirmBtn.className =
      "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-status-low text-status-low-foreground text-xs font-medium h-8 px-3 hover-elevate active-elevate-2";
    confirmBtn.textContent = "Confirm";
    confirmBtn.onclick = () => {
      feedbackRef.current(incidentId, "confirmed");
      popupRef.current?.remove();
    };

    const denyBtn = document.createElement("button");
    denyBtn.setAttribute("data-testid", `button-deny-${incidentId}`);
    denyBtn.className =
      "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-status-high text-status-high-foreground text-xs font-medium h-8 px-3 hover-elevate active-elevate-2";
    denyBtn.textContent = "Deny";
    denyBtn.onclick = () => {
      feedbackRef.current(incidentId, "denied");
      popupRef.current?.remove();
    };

    btnRow.appendChild(confirmBtn);
    btnRow.appendChild(denyBtn);
    container.appendChild(btnRow);

    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
      .setLngLat(lngLat)
      .setDOMContent(container)
      .addTo(map);
  }, []);

  // --- Data sync: hotspot zones (static, drawn once available) ----------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const source = map.getSource("hotspot-zones") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = hotspotZones.map((z) => {
      const risk = z.historicalRiskScore;
      const color = risk >= 0.6 ? "#f97316" : risk <= 0.25 ? "#38bdf8" : "#94a3b8";
      return {
        type: "Feature",
        properties: { name: `${z.name} (${(risk * 100).toFixed(0)}% risk)`, color },
        geometry: { type: "Polygon", coordinates: [circlePolygon(z.lat, z.lon, z.radiusM)] },
      };
    });
    source.setData({ type: "FeatureCollection", features });
  }, [mapReady, hotspotZones]);

  // --- Data sync: vehicles ------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const source = map.getSource("vehicles") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = vehicles.map((v) => ({
      type: "Feature",
      properties: { id: v.id, label: v.label, heading: v.heading },
      geometry: { type: "Point", coordinates: [v.lon, v.lat] },
    }));
    source.setData({ type: "FeatureCollection", features });
  }, [mapReady, vehicles]);

  // --- Data sync: incidents (active only, colored/sized by trust) -------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const source = map.getSource("incidents") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const now = Date.now();
    const active = incidents.filter((i) => i.status !== "expired");
    const features: GeoJSON.Feature[] = active.map((i) => {
      const tier = trustTier(i.trustScore, alertThreshold);
      const remaining = incidentRemainingFraction(i, now);
      const radiusM = 150 + i.trustScore * 250;
      return {
        type: "Feature",
        properties: {
          id: i.id,
          color: TIER_HEX[tier],
          fillOpacity: 0.12 + 0.18 * remaining,
          lineOpacity: 0.35 + 0.55 * remaining,
        },
        geometry: {
          type: "Polygon",
          coordinates: [circlePolygon(i.centroidLat, i.centroidLon, radiusM)],
        },
      };
    });
    source.setData({ type: "FeatureCollection", features });
  }, [mapReady, incidents, alertThreshold]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-card-border">
      <div ref={mapContainerRef} data-testid="map-container" className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
        <Badge
          variant="outline"
          className="pointer-events-auto gap-1.5 bg-background/90 backdrop-blur-sm"
          data-testid="badge-map-legend-hotspot"
        >
          <span className="h-2 w-2 rounded-full bg-[#f97316]" /> Hotspot zone
        </Badge>
        <Badge
          variant="outline"
          className="pointer-events-auto gap-1.5 bg-background/90 backdrop-blur-sm"
          data-testid="badge-map-legend-cold"
        >
          <span className="h-2 w-2 rounded-full bg-[#38bdf8]" /> Cold zone
        </Badge>
      </div>
    </div>
  );
}
