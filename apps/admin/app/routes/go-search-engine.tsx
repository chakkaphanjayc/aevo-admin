import { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Check,
  Clock3,
  Coffee,
  Compass,
  CornerDownRight,
  Cpu,
  Filter,
  Flame,
  Footprints,
  Info,
  Layers,
  MapPin,
  Navigation,
  Percent,
  Play,
  RefreshCw,
  Route,
  Search,
  Sliders,
  Sparkles,
  Tag,
  Timer,
  TrendingUp,
  UserCheck,
  Utensils,
  Wine,
  Zap,
} from "lucide-react";
import { Card, StatusBadge, Button, Input } from "@aevocado/design-system";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAdminAccess } from "../lib/auth.server";
import type { AdminLoaderData } from "../lib/auth.shared";

export interface SearchRankingWeights {
  semantic: number;
  distance: number;
  partner: number;
  rating: number;
  time: number;
}

export interface TimeSlotConfig {
  slot_id: string;
  label: string;
  time_range: string;
  preset_trace_tags: string[];
  recommended_prompts: string[];
  icon?: string;
}

export interface CuratedTraceTemplate {
  template_id: string;
  title: string;
  description: string;
  area: string;
  recommended_time: string;
  tags: string[];
  waypoints: Array<{
    place_id: string;
    name: string;
    role: string;
  }>;
}

export interface AdminSearchConfig {
  weights: SearchRankingWeights;
  max_search_radius_meters: number;
  dynamic_rerank_enabled: boolean;
  time_slots: TimeSlotConfig[];
  curated_traces?: CuratedTraceTemplate[];
  updated_at?: string;
  updated_by?: string;
}

export interface ZeroResultQueryItem {
  query: string;
  frequency: number;
  suggested_area: string;
  last_searched: string;
  target_category: string;
}

export interface NodeSwapStatItem {
  place_name: string;
  category: string;
  swap_out_rate: number;
  total_included: number;
  primary_reason: string;
}

export interface SearchTelemetryData {
  zero_result_queries: ZeroResultQueryItem[];
  node_swap_stats: NodeSwapStatItem[];
  perk_conversion: {
    total_searches_with_perks: number;
    perk_clicked_ratio: number;
    non_perk_clicked_ratio: number;
    fast_pass_conversions: number;
  };
  latency_percentiles: {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
}

export interface SearchSimulationCandidate {
  place_id: string;
  name: string;
  category: string;
  distance_meters: number;
  semantic_similarity: number;
  partner_status: boolean;
  rating: number;
  is_open: boolean;
  composite_score: number;
  culled: boolean;
  cull_reason?: "out_of_radius" | "closed" | "loop_redundancy";
}

export interface SimulationWaypoint {
  step: number;
  place_id: string;
  name: string;
  category: string;
  vibe_matches: string[];
  walk_to_next: {
    distance_meters: number;
    mins: number;
  } | null;
  aevo_perk?: {
    type: "discount" | "fast_pass" | "freebie" | "vip_seat";
    label: string;
  } | null;
  coordinate?: {
    lat: number;
    lng: number;
  };
}

export interface SearchSimulationResponse {
  query: string;
  parsed_intent: {
    mood_vector: string[];
    spatio_temporal: string;
    sequence_flow: string[];
    partner_priority: boolean;
  };
  candidates_evaluated: number;
  candidates_culled: number;
  processing_latency_ms: number;
  assembled_trace: {
    trace_id: string;
    title: string;
    summary: string;
    total_distance_meters: number;
    estimated_walking_mins: number;
    waypoints: SimulationWaypoint[];
    scoring_breakdown: {
      semantic_score: number;
      distance_score: number;
      partner_score: number;
      rating_score: number;
      time_score: number;
      total_composite_score: number;
    };
  };
  ranked_candidates: SearchSimulationCandidate[];
}

export const DEFAULT_SEARCH_RANKING_WEIGHTS: SearchRankingWeights = {
  semantic: 0.35,
  distance: 0.30,
  partner: 0.20,
  rating: 0.15,
  time: 0.10,
};

export const SEARCH_WEIGHT_PRESETS: Record<string, { label: string; description: string; weights: SearchRankingWeights }> = {
  boost_partners: {
    label: "Boost Partners Mode",
    description: "เน้นร้านคู่ค้า Aevo Play ที่มีสิทธิ์และส่วนลดพิเศษ",
    weights: {
      semantic: 0.25,
      distance: 0.20,
      partner: 0.40,
      rating: 0.10,
      time: 0.05,
    },
  },
  walking_priority: {
    label: "Walking Distance Priority Mode",
    description: "เน้นระยะเดินใกล้ที่สุด เหมาะสำหรับชั่วโมงเร่งด่วนหรือสภาพอากาศร้อน",
    weights: {
      semantic: 0.20,
      distance: 0.50,
      partner: 0.10,
      rating: 0.10,
      time: 0.10,
    },
  },
  nightlife_vibe: {
    label: "Nightlife Vibe Mode",
    description: "เน้นความตรงกับมู้ดร้านและบรรยากาศยามค่ำคืน (Jazz, Bar, Speakeasy)",
    weights: {
      semantic: 0.45,
      distance: 0.15,
      partner: 0.15,
      rating: 0.15,
      time: 0.10,
    },
  },
  balanced: {
    label: "Balanced Default",
    description: "สมดุลระหว่างความหมาย ระยะทาง และความคุ้มค่า",
    weights: DEFAULT_SEARCH_RANKING_WEIGHTS,
  },
};

export const DEFAULT_TIME_SLOTS: TimeSlotConfig[] = [
  {
    slot_id: "morning_rush",
    label: "เช้า / Slow Bar & Quick Breakfast",
    time_range: "07:00-11:00",
    preset_trace_tags: ["cafe", "takeaway", "breakfast", "specialty-coffee"],
    recommended_prompts: [
      "Slow Bar กาแฟดี นั่งทำงานเช้า",
      "อาหารเช้าด่วน ใกล้ BTS เดินไม่เกิน 5 นาที",
      "เบเกอรี่อบใหม่และกาแฟ Takeaway",
    ],
    icon: "Coffee",
  },
  {
    slot_id: "lunch_break",
    label: "กลางวัน / Quick Lunch & Dessert",
    time_range: "11:00-14:00",
    preset_trace_tags: ["lunch", "comfort-food", "dessert", "ac-cold"],
    recommended_prompts: [
      "มื้อเที่ยงด่วน ไม่ต้องรอคิว แล้วต่อกาแฟ",
      "ร้านแอร์เย็น นั่งคุยงานสบายๆ",
      "ก๋วยเตี๋ยวรสเด็ด ต่อด้วยไอศกรีมโฮมเมด",
    ],
    icon: "Utensils",
  },
  {
    slot_id: "afternoon_focus",
    label: "บ่าย / Work & Chill Out",
    time_range: "14:00-17:30",
    preset_trace_tags: ["quiet", "plugs", "matcha", "workspace"],
    recommended_prompts: [
      "คาเฟ่มีปลั๊กไฟ แอร์เย็น นั่งอ่านหนังสือ",
      "Matcha specialty เงียบสงบ",
      "Work-from-cafe โต๊ะกว้าง ไวไฟเร็ว",
    ],
    icon: "Laptop",
  },
  {
    slot_id: "evening_nightlife",
    label: "ค่ำ / Dining, Jazz & Craft Beer",
    time_range: "17:30-23:30",
    preset_trace_tags: ["bar", "craft-beer", "dinner", "jazz", "speakeasy"],
    recommended_prompts: [
      "Craft Beer Hop บาร์ลับใกล้กัน 3 จุด",
      "ดินเนอร์บรรยากาศโรแมนติก ต่อแจ๊สบาร์",
      "อิซากายะกินดื่มหลังเลิกงาน",
    ],
    icon: "Wine",
  },
];

interface SearchEngineLoaderData {
  session: AdminLoaderData;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<SearchEngineLoaderData> {
  const session = await requireAdminAccess(request);
  return { session };
}

const mockLocations = [
  { id: "ari", label: "BTS อารีย์ (Ari)", lat: 13.7797, lng: 100.5447 },
  { id: "thonglor", label: "ทองหล่อ (Thonglor)", lat: 13.7314, lng: 100.5815 },
  { id: "charoenkrung", label: "เจริญกรุง / ตลาดน้อย (Talat Noi)", lat: 13.7337, lng: 100.5102 },
  { id: "nimman", label: "นิมมานฯ เชียงใหม่ (Nimman)", lat: 18.7984, lng: 98.9686 },
  { id: "siam", label: "สยามสแควร์ (Siam)", lat: 13.7456, lng: 100.5342 },
] as const;

const initialTelemetry: SearchTelemetryData = {
  zero_result_queries: [
    { query: "pet friendly คาเฟ่แมวนั่งทำงาน", frequency: 142, suggested_area: "Ari / Phahonyothin", last_searched: "10 นาทีที่แล้ว", target_category: "Cafe" },
    { query: "ร้านไวน์ธรรมชาติเปิดดึกหลังเที่ยงคืน", frequency: 98, suggested_area: "Thonglor / Ekkamai", last_searched: "25 นาทีที่แล้ว", target_category: "Bar" },
    { query: "ข้าวต้มกุ๊ยติดแอร์ ใกล้สถานีรถไฟฟ้า", frequency: 76, suggested_area: "Charoenkrung / Silom", last_searched: "1 ชั่วโมงที่แล้ว", target_category: "Dining" },
    { query: "บอร์ดเกมคาเฟ่เปิด 24 ชม.", frequency: 54, suggested_area: "Siam / Samyan", last_searched: "3 ชั่วโมงที่แล้ว", target_category: "Activities" },
  ],
  node_swap_stats: [
    { place_name: "Artisan Roastery", category: "Cafe", swap_out_rate: 0.28, total_included: 240, primary_reason: "คนแน่น ไม่มีที่นั่งทำงาน" },
    { place_name: "Hidden Vinyl Bar", category: "Bar", swap_out_rate: 0.22, total_included: 180, primary_reason: "ต้องจองล่วงหน้า walk-in ไม่ได้" },
    { place_name: "Pasta & Co.", category: "Dining", swap_out_rate: 0.15, total_included: 310, primary_reason: "ระยะเดินจากจุดแรกไกลเกินไป (> 800m)" },
    { place_name: "Sunset Matcha Lab", category: "Cafe", swap_out_rate: 0.08, total_included: 195, primary_reason: "เปลี่ยนเป็นเมนูของคาวแทน" },
  ],
  perk_conversion: {
    total_searches_with_perks: 3840,
    perk_clicked_ratio: 0.64,
    non_perk_clicked_ratio: 0.36,
    fast_pass_conversions: 892,
  },
  latency_percentiles: {
    p50_ms: 18,
    p95_ms: 38,
    p99_ms: 64,
  },
};

export default function GoSearchEnginePage() {
  const [activeTab, setActiveTab] = useState<"simulator" | "weights" | "slots" | "telemetry">("simulator");
  const [weights, setWeights] = useState<SearchRankingWeights>(DEFAULT_SEARCH_RANKING_WEIGHTS);
  const [activePreset, setActivePreset] = useState<string>("balanced");
  const [timeSlots] = useState<TimeSlotConfig[]>(DEFAULT_TIME_SLOTS);
  const [searchQuery, setSearchQuery] = useState("หาร้านกาแฟเงียบๆ ไว้นั่งทำงาน แล้วต่อด้วยมื้อเที่ยงแถวอารีย์");
  const [selectedLocation, setSelectedLocation] = useState<(typeof mockLocations)[number]>(mockLocations[0]);
  const [maxRadius, setMaxRadius] = useState(1500);
  const [preferPartners, setPreferPartners] = useState(true);
  const [saveToast, setSaveToast] = useState("");

  const handleApplyPreset = (presetKey: string) => {
    const preset = SEARCH_WEIGHT_PRESETS[presetKey];
    if (preset) {
      setWeights({ ...preset.weights });
      setActivePreset(presetKey);
      setSaveToast(`ปรับใช้พรีเซ็ต "${preset.label}" เรียบร้อยแล้ว`);
      setTimeout(() => setSaveToast(""), 3000);
    }
  };

  // Real-time simulated query result
  const simulationResult = useMemo((): SearchSimulationResponse => {
    const isCoffeeLunch = searchQuery.includes("กาแฟ") || searchQuery.includes("เที่ยง") || searchQuery.includes("ทำงาน");
    const isNightlife = searchQuery.includes("บาร์") || searchQuery.includes("เบียร์") || searchQuery.includes("แจ๊ส") || searchQuery.includes("ไวน์");

    const parsedIntent = {
      mood_vector: isNightlife
        ? ["speakeasy", "dim-lights", "craft-drinks", "vinyl"]
        : ["quiet", "workspace", "plugs", "ac-cold", "specialty-coffee"],
      spatio_temporal: `รัศมี ${maxRadius}m จาก ${selectedLocation.label} · เวลาปัจจุบัน`,
      sequence_flow: isNightlife
        ? ["Pre-drink / Craft Beer", "Dinner & Bites", "Late Night Jazz Bar"]
        : ["Step 1: Specialty Coffee / Focus", "Step 2: Quick Artisan Lunch"],
      partner_priority: preferPartners,
    };

    const candidates: SearchSimulationCandidate[] = [
      {
        place_id: "p_01",
        name: isNightlife ? "Lofi Hop Bar" : "North Star Specialty Coffee",
        category: isNightlife ? "bar" : "cafe",
        distance_meters: 320,
        semantic_similarity: 0.94,
        partner_status: true,
        rating: 4.8,
        is_open: true,
        composite_score: 0,
        culled: false,
      },
      {
        place_id: "p_02",
        name: isNightlife ? "The Jazz Chamber" : "Sora Japanese Comfort Table",
        category: isNightlife ? "bar" : "lunch_dining",
        distance_meters: 680,
        semantic_similarity: 0.88,
        partner_status: true,
        rating: 4.9,
        is_open: true,
        composite_score: 0,
        culled: false,
      },
      {
        place_id: "p_03",
        name: isNightlife ? "Vintage Vinyl Lounge" : "Paper & Bean Coworking Space",
        category: isNightlife ? "bar" : "workspace",
        distance_meters: 890,
        semantic_similarity: 0.82,
        partner_status: false,
        rating: 4.6,
        is_open: true,
        composite_score: 0,
        culled: false,
      },
      {
        place_id: "p_04",
        name: "Old Town Corner Roastery",
        category: "cafe",
        distance_meters: 1850,
        semantic_similarity: 0.79,
        partner_status: true,
        rating: 4.7,
        is_open: true,
        composite_score: 0,
        culled: true,
        cull_reason: "out_of_radius",
      },
      {
        place_id: "p_05",
        name: "Morning Slow Bar Ari",
        category: "cafe",
        distance_meters: 410,
        semantic_similarity: 0.91,
        partner_status: false,
        rating: 4.5,
        is_open: false,
        composite_score: 0,
        culled: true,
        cull_reason: "closed",
      },
    ];

    // Compute composite scores
    candidates.forEach((cand) => {
      if (cand.culled) {
        cand.composite_score = 0;
        return;
      }
      const distNorm = Math.max(0, 1 - cand.distance_meters / maxRadius);
      const partnerNorm = cand.partner_status ? 1.0 : 0.0;
      const ratingNorm = cand.rating / 5.0;
      const timeNorm = cand.is_open ? 1.0 : 0.0;

      cand.composite_score = Number(
        (
          weights.semantic * cand.semantic_similarity +
          weights.distance * distNorm +
          weights.partner * partnerNorm +
          weights.rating * ratingNorm +
          weights.time * timeNorm
        ).toFixed(4)
      );
    });

    const activeRanked = candidates
      .filter((c) => !c.culled)
      .sort((a, b) => b.composite_score - a.composite_score);

    const assembledTrace = {
      trace_id: `tr_${selectedLocation.id}_${isNightlife ? "nightlife" : "coffee_lunch"}_auto`,
      title: isNightlife ? "Thonglor Craft & Jazz Hop" : "Quiet Workspace & Artisan Lunch Trace",
      summary: isNightlife
        ? "เริ่มต้นด้วยคราฟต์เบียร์ชิลล์ๆ แล้วเดินต่อไปร้านแจ๊สบาร์บรรยากาศดี"
        : "เริ่มต้นกาแฟ Slow bar เงียบสงบสำหรับนั่งทำงาน แล้วเดินต่อไปร้านอาหารจานด่วนพรีเมียม",
      total_distance_meters: 1000,
      estimated_walking_mins: 14,
      waypoints: activeRanked.slice(0, 2).map((cand, idx): SimulationWaypoint => ({
        step: idx + 1,
        place_id: cand.place_id,
        name: cand.name,
        category: cand.category,
        vibe_matches: cand.category === "bar" ? ["jazz", "craft-beer"] : ["quiet", "plugs", "ac-cold"],
        walk_to_next: idx === 0 ? { distance_meters: 360, mins: 5 } : null,
        aevo_perk: cand.partner_status
          ? idx === 0
            ? { type: "discount", label: "ส่วนลด 15% Aevo Play" }
            : { type: "fast_pass", label: "Fast Pass ลัดคิวทันที" }
          : null,
        coordinate: {
          lat: selectedLocation.lat + (idx + 1) * 0.002,
          lng: selectedLocation.lng + (idx + 1) * 0.002,
        },
      })),
      scoring_breakdown: {
        semantic_score: 0.91,
        distance_score: 0.85,
        partner_score: 0.95,
        rating_score: 0.96,
        time_score: 1.0,
        total_composite_score: 0.92,
      },
    };

    return {
      query: searchQuery,
      parsed_intent: parsedIntent,
      candidates_evaluated: candidates.length,
      candidates_culled: candidates.filter((c) => c.culled).length,
      processing_latency_ms: 22,
      assembled_trace: assembledTrace,
      ranked_candidates: candidates,
    };
  }, [searchQuery, selectedLocation, maxRadius, preferPartners, weights]);

  return (
    <div className="admin-page admin-search-engine-page">
      {/* Toast message */}
      {saveToast && (
        <div className="admin-toast-notice" role="status">
          <span>{saveToast}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="admin-page__header">
        <div>
          <span className="admin-eyebrow">AEVO GO / SPATIAL SEARCH ENGINE</span>
          <h1 className="admin-title">Smart Search Engine & Trace Control Plane</h1>
          <p className="admin-muted">
            วิจัยและบริหารจัดการระบบค้นหาอัจฉริยะ (Omni-Search Bar), ปรับค่าน้ำหนัก Ranking Heuristic, จัดการ Contextual Prompts ตามช่วงเวลา, และจำลองผลลัพธ์ผ่าน Real-time Simulator
          </p>
        </div>
        <div className="admin-actions">
          <StatusBadge tone="warning">Prototype · ไม่เชื่อม Core API</StatusBadge>
        </div>
      </div>
      <Card className="admin-panel">
        <p className="admin-muted">
          หน้านี้เป็น simulator สำหรับทดสอบแนวคิดเท่านั้น ผลลัพธ์, telemetry และ time slots มาจากข้อมูลจำลอง
          และยังไม่มี Core API สำหรับอ่านหรือบันทึก Search Config จึงไม่ถือเป็น production control plane
        </p>
      </Card>

      {/* System Telemetry Badges */}
      <div className="admin-kpi-grid">
        <Card className="admin-kpi">
          <span>AI Embedding Model</span>
          <strong>text-embedding-3-small</strong>
          <small>1536 Dimensions · Semantic Vector</small>
        </Card>
        <Card className="admin-kpi">
          <span>Spatial Isochrone</span>
          <strong>PostGIS Walking Ring</strong>
          <small>Radius &lt; 2,500m · Loop Avoidance</small>
        </Card>
        <Card className="admin-kpi">
          <span>Engine Latency (p95)</span>
          <strong>{initialTelemetry.latency_percentiles.p95_ms} ms</strong>
          <small>Edge Orchestrator Real-time</small>
        </Card>
        <Card className="admin-kpi">
          <span>Aevo Perk Click Ratio</span>
          <strong>{Math.round(initialTelemetry.perk_conversion.perk_clicked_ratio * 100)}%</strong>
          <small>+28% higher than standard venues</small>
        </Card>
      </div>

      {/* Tab Navigation */}
      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "simulator"}
          className={`admin-tab${activeTab === "simulator" ? " is-active" : ""}`}
          onClick={() => setActiveTab("simulator")}
        >
          <Compass size={16} aria-hidden="true" />
          <span>Search Simulator & Inspector</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "weights"}
          className={`admin-tab${activeTab === "weights" ? " is-active" : ""}`}
          onClick={() => setActiveTab("weights")}
        >
          <Sliders size={16} aria-hidden="true" />
          <span>Heuristic Weight Tuning</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "slots"}
          className={`admin-tab${activeTab === "slots" ? " is-active" : ""}`}
          onClick={() => setActiveTab("slots")}
        >
          <Clock3 size={16} aria-hidden="true" />
          <span>Time Slots & Prompts</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "telemetry"}
          className={`admin-tab${activeTab === "telemetry" ? " is-active" : ""}`}
          onClick={() => setActiveTab("telemetry")}
        >
          <BarChart3 size={16} aria-hidden="true" />
          <span>Telemetry & Demand Analytics</span>
        </button>
      </div>

      {/* TAB 1: Search Simulator & Inspector */}
      {activeTab === "simulator" && (
        <div className="admin-section-grid">
          <Card className="admin-panel admin-panel--form">
            <div className="admin-panel__heading">
              <Sparkles size={18} className="text-brand" aria-hidden="true" />
              <h3>Search Simulator (จำลองการค้นหา)</h3>
            </div>

            <div className="admin-form-group">
              <label htmlFor="search-input">ข้อความค้นหา (Natural Language Query)</label>
              <div className="admin-input-with-action">
                <Search size={16} className="text-muted" aria-hidden="true" />
                <input
                  id="search-input"
                  className="admin-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="พิมพ์ความต้องการ เช่น กาแฟเช้า แล้วต่อมื้อเที่ยงแถวอารีย์..."
                />
              </div>
              <div className="admin-chip-row">
                <span className="text-muted text-xs">ตัวอย่างคำค้น:</span>
                <button
                  type="button"
                  className="admin-mini-chip"
                  onClick={() => setSearchQuery("หาร้านกาแฟเงียบๆ ไว้นั่งทำงาน แล้วต่อด้วยมื้อเที่ยงแถวอารีย์")}
                >
                  กาแฟทำงาน &rarr; มื้อเที่ยง
                </button>
                <button
                  type="button"
                  className="admin-mini-chip"
                  onClick={() => setSearchQuery("บาร์ลับ คราฟต์เบียร์ ดนตรีสด ทองหล่อ")}
                >
                  คราฟต์เบียร์ & แจ๊ส ทองหล่อ
                </button>
                <button
                  type="button"
                  className="admin-mini-chip"
                  onClick={() => setSearchQuery("ร้านแอร์เย็น มื้อเที่ยงด่วน ไม่เกิน 15 นาที")}
                >
                  มื้อเที่ยงด่วน ไม่เกิน 15 นาที
                </button>
              </div>
            </div>

            <div className="admin-form-row">
              <div className="admin-form-group">
                <label htmlFor="gps-select">จุดปักหมุดจำลอง (Mock GPS Pin)</label>
                <select
                  id="gps-select"
                  className="admin-select"
                  value={selectedLocation.id}
                  onChange={(e) => {
                    const loc = mockLocations.find((l) => l.id === e.target.value);
                    if (loc) setSelectedLocation(loc);
                  }}
                >
                  {mockLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.label} ({loc.lat.toFixed(4)}, {loc.lng.toFixed(4)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-form-group">
                <label htmlFor="radius-slider">
                  รัศมีเดินสูงสุด: <strong>{maxRadius} เมตร</strong>
                </label>
                <input
                  id="radius-slider"
                  type="range"
                  min="500"
                  max="3000"
                  step="100"
                  value={maxRadius}
                  onChange={(e) => setMaxRadius(Number(e.target.value))}
                  className="admin-slider"
                />
              </div>
            </div>

            <div className="admin-form-toggle">
              <input
                id="partner-toggle"
                type="checkbox"
                checked={preferPartners}
                onChange={(e) => setPreferPartners(e.target.checked)}
              />
              <label htmlFor="partner-toggle">
                <strong>Boost Aevo Play Partners</strong>
                <small className="admin-muted">ให้สิทธิ์ร้านค้าที่มี Privilege / Fast Pass ขึ้นนำในผลการจัดอันดับ</small>
              </label>
            </div>
          </Card>

          {/* Real-time Inspector Output */}
          <div className="admin-inspector-stack">
            <Card className="admin-panel admin-inspector-card">
              <div className="admin-panel__heading">
                <Cpu size={18} className="text-brand" aria-hidden="true" />
                <h3>Natural Language & Spatial Intent Inspection</h3>
                <StatusBadge tone="success">
                  {`ประมวลผลใน ${simulationResult.processing_latency_ms} ms`}
                </StatusBadge>
              </div>

              <div className="admin-intent-breakdown">
                <div className="admin-intent-col">
                  <span className="text-muted text-xs">Mood & Atmosphere Vector:</span>
                  <div className="admin-tag-cloud">
                    {simulationResult.parsed_intent.mood_vector.map((vibe: string) => (
                      <span key={vibe} className="admin-vibe-tag">
                        #{vibe}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="admin-intent-col">
                  <span className="text-muted text-xs">Sequence & Transit Flow:</span>
                  <div className="admin-flow-steps">
                    {simulationResult.parsed_intent.sequence_flow.map((step: string, idx: number) => (
                      <span key={step} className="admin-flow-pill">
                        <strong>[{idx + 1}]</strong> {step}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="admin-intent-col">
                  <span className="text-muted text-xs">Spatio-Temporal Constraint:</span>
                  <p className="text-sm font-medium">{simulationResult.parsed_intent.spatio_temporal}</p>
                </div>
              </div>

              {/* Generated Trace Route Preview */}
              <div className="admin-trace-preview">
                <div className="admin-trace-preview__header">
                  <div>
                    <span className="admin-eyebrow">SYNTHESIZED TRACE ROUTE</span>
                    <h4>{simulationResult.assembled_trace.title}</h4>
                    <p className="admin-muted text-xs">{simulationResult.assembled_trace.summary}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold">{simulationResult.assembled_trace.total_distance_meters} ม.</span>
                    <small className="block text-muted text-xs">เดินประมาณ {simulationResult.assembled_trace.estimated_walking_mins} นาที</small>
                  </div>
                </div>

                {/* Waypoints Timeline */}
                <div className="admin-timeline">
                  {simulationResult.assembled_trace.waypoints.map((wp: SimulationWaypoint) => (
                    <div key={wp.place_id} className="admin-timeline__node">
                      <div className="admin-timeline__marker">{wp.step}</div>
                      <div className="admin-timeline__content">
                        <div className="flex items-center justify-between">
                          <strong>{wp.name}</strong>
                          {wp.aevo_perk && (
                            <span className="admin-perk-badge">
                              <Zap size={12} aria-hidden="true" />
                              {wp.aevo_perk.label}
                            </span>
                          )}
                        </div>
                        <span className="text-muted text-xs">
                          หมวดหมู่: {wp.category} · Vibes: {wp.vibe_matches.join(", ")}
                        </span>
                        {wp.walk_to_next && (
                          <div className="admin-timeline__hop">
                            <CornerDownRight size={14} aria-hidden="true" />
                            <span>เดิน {wp.walk_to_next.distance_meters} ม. ({wp.walk_to_next.mins} นาที)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Candidate Scoring Breakdown */}
              <div className="admin-candidates-table-wrap">
                <span className="admin-eyebrow">CANDIDATES & SCORING BREAKDOWN</span>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ชื่อร้านค้า</th>
                      <th>ระยะทาง</th>
                      <th>Semantic</th>
                      <th>Partner</th>
                      <th>คะแนนรวม (Composite)</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulationResult.ranked_candidates.map((cand: SearchSimulationCandidate) => (
                      <tr key={cand.place_id} className={cand.culled ? "is-culled" : ""}>
                        <td>
                          <strong>{cand.name}</strong>
                          <small className="block text-muted">{cand.category}</small>
                        </td>
                        <td>{cand.distance_meters} ม.</td>
                        <td>{(cand.semantic_similarity * 100).toFixed(0)}%</td>
                        <td>{cand.partner_status ? <Check size={14} className="text-success" /> : "—"}</td>
                        <td>
                          <strong className={cand.culled ? "text-muted" : "text-brand"}>
                            {cand.culled ? "0.00" : cand.composite_score.toFixed(4)}
                          </strong>
                        </td>
                        <td>
                          {cand.culled ? (
                            <span className="admin-cull-badge">
                              {cand.cull_reason === "out_of_radius" ? "เกินรัศมี" : "ร้านปิด"}
                            </span>
                          ) : (
                            <StatusBadge tone="success">ผ่านเกณฑ์</StatusBadge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: Heuristic Weight Tuning */}
      {activeTab === "weights" && (
        <div className="admin-section-grid">
          <Card className="admin-panel">
            <div className="admin-panel__heading">
              <Sliders size={18} className="text-brand" aria-hidden="true" />
              <h3>Ranking Formula & Weight Sliders</h3>
            </div>
            <p className="admin-muted text-sm mb-4">
              สูตรคำนวณคะแนนร้านค้าใน Trace:
              <br />
              <code className="admin-math-code">
                Score = (W_sem × S_sem) + (W_dist × S_dist) + (W_part × S_part) + (W_rate × S_rate) + (W_time × S_time)
              </code>
            </p>

            {/* Presets */}
            <div className="admin-presets-row">
              <span className="text-muted text-xs block mb-2 font-bold">โหมดพรีเซ็ตสำเร็จรูป (Quick Presets):</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
                {Object.entries(SEARCH_WEIGHT_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    className={`admin-preset-btn${activePreset === key ? " is-active" : ""}`}
                    onClick={() => handleApplyPreset(key)}
                  >
                    <strong>{preset.label}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders */}
            <div className="admin-sliders-stack">
              <div className="admin-slider-item">
                <div className="flex justify-between text-sm">
                  <span>W_semantic (ความตรงกับมู้ด/ความหมาย):</span>
                  <strong>{weights.semantic.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.semantic}
                  onChange={(e) => setWeights({ ...weights, semantic: Number(e.target.value) })}
                  className="admin-slider"
                />
              </div>

              <div className="admin-slider-item">
                <div className="flex justify-between text-sm">
                  <span>W_distance (ระยะทางเดินใกล้เคียง):</span>
                  <strong>{weights.distance.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.distance}
                  onChange={(e) => setWeights({ ...weights, distance: Number(e.target.value) })}
                  className="admin-slider"
                />
              </div>

              <div className="admin-slider-item">
                <div className="flex justify-between text-sm">
                  <span>W_partner (ร้านพาร์ทเนอร์ Aevo Play & ส่วนลด):</span>
                  <strong>{weights.partner.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.partner}
                  onChange={(e) => setWeights({ ...weights, partner: Number(e.target.value) })}
                  className="admin-slider"
                />
              </div>

              <div className="admin-slider-item">
                <div className="flex justify-between text-sm">
                  <span>W_rating (คะแนนรีวิวและความนิยม):</span>
                  <strong>{weights.rating.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.rating}
                  onChange={(e) => setWeights({ ...weights, rating: Number(e.target.value) })}
                  className="admin-slider"
                />
              </div>

              <div className="admin-slider-item">
                <div className="flex justify-between text-sm">
                  <span>W_time (เวลาเปิดทำการและ Dwell time):</span>
                  <strong>{weights.time.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.time}
                  onChange={(e) => setWeights({ ...weights, time: Number(e.target.value) })}
                  className="admin-slider"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="secondary" disabled aria-label="Dynamic reranker persistence is not available">
                <Check size={16} aria-hidden="true" />
                ยังไม่มี endpoint สำหรับบันทึก
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: Time-Slots & Contextual Prompts */}
      {activeTab === "slots" && (
        <div className="admin-section-grid">
          <Card className="admin-panel">
            <div className="admin-panel__heading">
              <Clock3 size={18} className="text-brand" aria-hidden="true" />
              <h3>Contextual Prompts by Time-of-Day Slots</h3>
            </div>
            <p className="admin-muted text-sm mb-4">
              กำหนดว่าในแต่ละช่วงเวลาของวัน เมื่อผู้ใช้เปิดช่อง Smart Omni-Search Bar จะแสดงชิปคำค้นแนะนำ (Contextual Nudges) ใดเป็นอันดับแรก
            </p>

            <div className="admin-slots-grid">
              {timeSlots.map((slot: TimeSlotConfig) => (
                <div key={slot.slot_id} className="admin-slot-card">
                  <div className="flex justify-between items-center mb-2">
                    <strong>{slot.label}</strong>
                    <StatusBadge tone="info">{slot.time_range}</StatusBadge>
                  </div>
                  <div className="admin-tag-cloud mb-3">
                    {slot.preset_trace_tags.map((tag: string) => (
                      <span key={tag} className="admin-tag-chip">
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <span className="text-muted text-xs block mb-1 font-bold">Suggested Prompts บน Client:</span>
                  <ul className="admin-prompt-list">
                    {slot.recommended_prompts.map((prompt: string, idx: number) => (
                      <li key={idx} className="text-sm py-1 border-b border-border-subtle last:border-0">
                        • {prompt}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 4: Telemetry & Demand Analytics */}
      {activeTab === "telemetry" && (
        <div className="admin-section-grid">
          <Card className="admin-panel">
            <div className="admin-panel__heading">
              <AlertTriangle size={18} className="text-warning" aria-hidden="true" />
              <h3>Zero-Result Queries (Lost Demand Detection)</h3>
            </div>
            <p className="admin-muted text-sm mb-4">
              คำค้นหาที่ผู้ใช้พิมพ์บ่อยแต่ระบบไม่พบร้านค้าที่ตรงเงื่อนไข เพื่อให้ทีม Business Development ไปติดต่อดึงร้านเข้าร่วมระบบ
            </p>

            <table className="admin-table">
              <thead>
                <tr>
                  <th>คำค้นหาที่ไม่พบผลลัพธ์</th>
                  <th>จำนวนครั้งที่ค้น (Frequency)</th>
                  <th>พื้นที่ที่น่าจะต้องการ</th>
                  <th>ค้นพบล่าสุด</th>
                  <th>หมวดหมู่เป้าหมาย</th>
                </tr>
              </thead>
              <tbody>
                {initialTelemetry.zero_result_queries.map((item: ZeroResultQueryItem, idx: number) => (
                  <tr key={idx}>
                    <td>
                      <strong>"{item.query}"</strong>
                    </td>
                    <td>
                      <span className="font-bold text-danger">{item.frequency} ครั้ง</span>
                    </td>
                    <td>{item.suggested_area}</td>
                    <td>{item.last_searched}</td>
                    <td>
                      <StatusBadge tone="neutral">{item.target_category}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="admin-panel">
            <div className="admin-panel__heading">
              <Footprints size={18} className="text-brand" aria-hidden="true" />
              <h3>Node Swap & Drop-off Analysis</h3>
            </div>
            <p className="admin-muted text-sm mb-4">
              สถิติจุดแวะใน Trace ที่ผู้ใช้กดยกเลิกหรือสลับเปลี่ยนบ่อยที่สุด (Node Swap Rate) เพื่อปรับปรุง Trace Route Assembly
            </p>

            <table className="admin-table">
              <thead>
                <tr>
                  <th>จุดแวะที่ถูกสลับออกบ่อย</th>
                  <th>หมวดหมู่</th>
                  <th>Swap Rate (%)</th>
                  <th>จำนวนที่ถูกแนะนำ</th>
                  <th>สาเหตุหลักที่ผู้ใช้ระบุ</th>
                </tr>
              </thead>
              <tbody>
                {initialTelemetry.node_swap_stats.map((stat: NodeSwapStatItem, idx: number) => (
                  <tr key={idx}>
                    <td>
                      <strong>{stat.place_name}</strong>
                    </td>
                    <td>{stat.category}</td>
                    <td>
                      <strong className={stat.swap_out_rate > 0.2 ? "text-danger" : "text-muted"}>
                        {(stat.swap_out_rate * 100).toFixed(0)}%
                      </strong>
                    </td>
                    <td>{stat.total_included} ครั้ง</td>
                    <td className="text-muted text-sm">{stat.primary_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
