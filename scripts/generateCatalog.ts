import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ProductCategory = "tv" | "smartphone" | "laptop" | "appliance" | "audio" | "wearable";

type ProductFaq = { question: string; answer: string };

type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  brand: string;
  price: number;
  currency: "EUR";
  description: string;
  specs: Record<string, string>;
  faqs?: ProductFaq[];
};

type Catalog = { products: Product[] };

function parseArgs(argv: string[]) {
  const out: { count: number; outFile: string; seed: number } = {
    count: 5000,
    outFile: "data/catalog.generated.5000.json",
    seed: 1337,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === "--count" && argv[i + 1]) {
      out.count = Math.max(1, Number.parseInt(argv[i + 1]!, 10));
      i++;
      continue;
    }
    if (a === "--out" && argv[i + 1]) {
      out.outFile = argv[i + 1]!;
      i++;
      continue;
    }
    if (a === "--seed" && argv[i + 1]) {
      out.seed = Number.parseInt(argv[i + 1]!, 10);
      i++;
      continue;
    }
    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage: tsx scripts/generateCatalog.ts [--count N] [--out path] [--seed N]",
          "",
          "Defaults:",
          "  --count 5000",
          "  --out data/catalog.generated.5000.json",
          "  --seed 1337",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.count) || out.count <= 0) out.count = 5000;
  if (!Number.isFinite(out.seed)) out.seed = 1337;
  return out;
}

/**
 * Tiny deterministic PRNG (xorshift32).
 * Good enough for mock data generation; not crypto.
 */
function makeRng(seed: number) {
  let x = (seed | 0) || 1;
  return {
    nextU32(): number {
      // xorshift32
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x >>> 0;
    },
    float(): number {
      return this.nextU32() / 0xffffffff;
    },
    int(minIncl: number, maxIncl: number): number {
      const span = maxIncl - minIncl + 1;
      return minIncl + (this.nextU32() % span);
    },
    pick<T>(arr: readonly T[]): T {
      return arr[this.int(0, arr.length - 1)]!;
    },
    chance(p: number): boolean {
      return this.float() < p;
    },
  };
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function euros(n: number): number {
  // keep "shop-like" integer prices
  return Math.max(49, Math.round(n));
}

const categories: readonly ProductCategory[] = [
  "tv",
  "smartphone",
  "laptop",
  "appliance",
  "audio",
  "wearable",
];

const brandsByCat: Record<ProductCategory, readonly string[]> = {
  tv: ["Aurora", "Nimbus", "Vega", "Orion", "Solstice", "Luma", "Helios", "Atlas"],
  smartphone: ["Nova", "Apex", "Nimbus", "Aurora", "Vertex", "Pulse", "Orion", "Zenith"],
  laptop: ["Atlas", "Vertex", "Nimbus", "Apex", "Orion", "Luma", "Helios", "Terra"],
  appliance: ["Terra", "Solstice", "Luma", "Helios", "Atlas", "Nimbus", "Orion", "Aqua"],
  audio: ["Pulse", "Zenith", "Orion", "Nimbus", "Aurora", "Echo", "Luma", "Vega"],
  wearable: ["Zenith", "Nova", "Pulse", "Aurora", "Orion", "Vertex", "Helios", "Luma"],
};

const modelWords = [
  "Edge",
  "Vision",
  "Pro",
  "Air",
  "Max",
  "Ultra",
  "Lite",
  "Prime",
  "Core",
  "Plus",
  "One",
  "X",
];

function generateTv(rng: ReturnType<typeof makeRng>, brand: string, idx: number): Omit<Product, "id" | "category"> {
  const size = rng.pick([32, 40, 42, 43, 50, 55, 58, 60, 65, 70, 75, 77, 83] as const);
  const panel = rng.pick(["LED", "QLED", "OLED", "Mini‑LED"] as const);
  const res = size >= 50 ? rng.pick(["4K", "4K", "4K", "8K"] as const) : rng.pick(["FHD", "4K"] as const);
  const refresh = size >= 55 ? rng.pick(["60Hz", "120Hz", "144Hz"] as const) : rng.pick(["60Hz", "60Hz", "120Hz"] as const);
  const hdmi21 = refresh !== "60Hz" && rng.chance(0.7);
  const audio = rng.pick(["Stereo 16W", "2.0 20W", "2.1 40W Dolby Atmos", "2.1 50W Dolby Atmos"] as const);
  const smart = `${brand} OS ${rng.int(10, 18)}`;
  const name = `${rng.pick(modelWords)} ${size}" ${res} ${panel}`;
  const description = [
    `Smart TV ${panel} ${size}" ${res} con ${refresh} e app di streaming.`,
    hdmi21 ? "Ottima per gaming grazie a HDMI 2.1 e bassa latenza." : "Ideale per film e sport con upscaling avanzato.",
  ].join(" ");
  const base = euros((size * size) / 6 + (panel === "OLED" ? 450 : panel === "Mini‑LED" ? 350 : panel === "QLED" ? 220 : 120));
  const price = euros(base + rng.int(-60, 120));
  const faqs: ProductFaq[] = [];
  if (rng.chance(0.35)) {
    faqs.push({
      question: "Supporta il montaggio a parete?",
      answer: `Sì, supporto VESA ${rng.pick(["200x200", "300x300", "400x200", "400x400"] as const)}; staffa venduta separatamente.`,
    });
  }
  if (rng.chance(0.25)) {
    faqs.push({
      question: "È compatibile con Dolby Vision?",
      answer: rng.chance(0.6) ? "Sì, supporta Dolby Vision e HDR10+." : "Supporta HDR10+; Dolby Vision non è disponibile su questo modello.",
    });
  }
  const specs: Record<string, string> = {
    panel: `${panel} ${size}" ${res}`,
    refresh,
    hdmi: hdmi21 ? "4x HDMI (2x HDMI 2.1)" : "3-4x HDMI",
    hdr: rng.pick(["HDR10", "HDR10+", "HDR10+, Dolby Vision"] as const),
    smart,
    audio,
  };
  return {
    name,
    brand,
    price,
    currency: "EUR",
    description,
    specs,
    ...(faqs.length ? { faqs } : {}),
  };
}

function generateSmartphone(rng: ReturnType<typeof makeRng>, brand: string): Omit<Product, "id" | "category"> {
  const series = rng.pick(["S", "N", "A", "X", "Z"] as const);
  const gen = rng.int(2, 12);
  const model = `${series}${gen}${rng.chance(0.25) ? " Pro" : rng.chance(0.25) ? " Lite" : ""}`.trim();
  const storage = rng.pick([128, 256, 256, 512, 1024] as const);
  const ram = rng.pick([6, 8, 8, 12, 16] as const);
  const display = rng.pick(["6.1\" OLED", "6.5\" OLED", "6.7\" AMOLED", "6.8\" AMOLED"] as const);
  const camera = rng.pick(["50MP + 12MP", "50MP + 50MP", "108MP + 12MP", "200MP + 12MP"] as const);
  const battery = rng.pick([4300, 4500, 4800, 5000, 5200] as const);
  const fastCharge = rng.pick(["33W", "45W", "67W", "80W"] as const);
  const name = `${brand} ${model} ${storage}GB`;
  const description = `Smartphone ${display} con ${ram}GB RAM, fotocamera ${camera} e batteria ${battery}mAh (ricarica ${fastCharge}).`;
  const priceBase = 249 + storage * 0.9 + ram * 18 + (camera.startsWith("200") ? 180 : camera.startsWith("108") ? 120 : 0);
  const price = euros(priceBase + rng.int(-50, 140));
  const faqs: ProductFaq[] = [];
  if (rng.chance(0.3)) {
    faqs.push({
      question: "Ha eSIM?",
      answer: rng.chance(0.65) ? "Sì, supporta eSIM + SIM fisica (dual SIM)." : "No, supporta solo SIM fisiche (dual SIM).",
    });
  }
  const specs: Record<string, string> = {
    display,
    storage: `${storage}GB`,
    ram: `${ram}GB`,
    camera,
    battery: `${battery}mAh`,
    charging: fastCharge,
    connectivity: rng.pick(["5G", "5G + Wi‑Fi 7", "5G + Wi‑Fi 6E"] as const),
  };
  return {
    name,
    brand,
    price,
    currency: "EUR",
    description,
    specs,
    ...(faqs.length ? { faqs } : {}),
  };
}

function generateLaptop(rng: ReturnType<typeof makeRng>, brand: string): Omit<Product, "id" | "category"> {
  const size = rng.pick([13, 14, 15, 16, 17] as const);
  const cpu = rng.pick(["i5", "i7", "Ryzen 5", "Ryzen 7", "M‑Series"] as const);
  const ram = rng.pick([8, 16, 16, 32, 64] as const);
  const storage = rng.pick([256, 512, 1024, 2048] as const);
  const gpu = rng.pick(["integrata", "RTX 4050", "RTX 4060", "RTX 4070"] as const);
  const display = `${size}\" ${rng.pick(["FHD", "QHD", "4K"] as const)} ${rng.pick(["IPS", "OLED"] as const)}`;
  const weight = (rng.int(12, 28) / 10).toFixed(1);
  const name = `${brand} ${rng.pick(modelWords)}Book ${size} (${cpu}/${ram}GB/${storage}GB)`;
  const description = `Notebook ${display} con CPU ${cpu}, ${ram}GB RAM e SSD ${storage}GB. Peso ~${weight}kg.`;
  const priceBase =
    499 +
    (cpu === "M‑Series" ? 350 : cpu.includes("i7") || cpu.includes("Ryzen 7") ? 220 : 120) +
    ram * 15 +
    storage * 0.6 +
    (gpu === "integrata" ? 0 : gpu === "RTX 4050" ? 250 : gpu === "RTX 4060" ? 380 : 520);
  const price = euros(priceBase + rng.int(-80, 220));
  const specs: Record<string, string> = {
    display,
    cpu,
    ram: `${ram}GB`,
    storage: `${storage}GB SSD`,
    gpu,
    weight: `${weight}kg`,
    battery: rng.pick(["50Wh", "60Wh", "70Wh", "80Wh"] as const),
  };
  return {
    name,
    brand,
    price,
    currency: "EUR",
    description,
    specs,
  };
}

function generateAppliance(rng: ReturnType<typeof makeRng>, brand: string): Omit<Product, "id" | "category"> {
  const kind = rng.pick(["Fridge", "Washer", "Dryer", "Dishwasher", "Microwave", "Vacuum"] as const);
  const name = `${brand} ${kind} ${rng.pick(modelWords)} ${pad2(rng.int(10, 99))}`;
  const energy = rng.pick(["A", "A+", "A++", "B"] as const);
  const noise = `${rng.int(38, 62)}dB`;
  const description = `Elettrodomestico ${kind.toLowerCase()} efficiente (classe ${energy}) con rumorosità ${noise}.`;
  const priceBase =
    kind === "Fridge"
      ? 599
      : kind === "Washer"
        ? 449
        : kind === "Dryer"
          ? 499
          : kind === "Dishwasher"
            ? 399
            : kind === "Microwave"
              ? 149
              : 229;
  const price = euros(priceBase + rng.int(-40, 280));
  const specs: Record<string, string> = {
    type: kind,
    energyClass: energy,
    noise,
    capacity:
      kind === "Fridge"
        ? `${rng.int(250, 520)}L`
        : kind === "Vacuum"
          ? `${rng.int(350, 900)}W`
          : `${rng.int(6, 12)}kg`,
    warranty: rng.pick(["2 anni", "3 anni"] as const),
  };
  return { name, brand, price, currency: "EUR", description, specs };
}

function generateAudio(rng: ReturnType<typeof makeRng>, brand: string): Omit<Product, "id" | "category"> {
  const kind = rng.pick(["Soundbar", "Headphones", "Speaker", "Earbuds"] as const);
  const name = `${brand} ${kind} ${rng.pick(modelWords)} ${pad2(rng.int(10, 99))}`;
  const description =
    kind === "Soundbar"
      ? "Soundbar con subwoofer wireless e supporto Dolby Atmos."
      : kind === "Headphones"
        ? "Cuffie over-ear con cancellazione attiva del rumore e autonomia elevata."
        : kind === "Earbuds"
          ? "Auricolari true wireless con ANC e ricarica rapida."
          : "Speaker Bluetooth portatile resistente all'acqua.";
  const priceBase =
    kind === "Soundbar" ? 199 : kind === "Headphones" ? 129 : kind === "Earbuds" ? 89 : 69;
  const price = euros(priceBase + rng.int(-20, 220));
  const specs: Record<string, string> = {
    type: kind,
    connectivity: rng.pick(["Bluetooth 5.3", "Bluetooth 5.3 + AUX", "Wi‑Fi + Bluetooth"] as const),
    codecs: rng.pick(["SBC/AAC", "SBC/AAC/LDAC"] as const),
    battery: kind === "Soundbar" ? "AC" : `${rng.int(6, 40)}h`,
    mic: rng.chance(0.7) ? "Sì" : "No",
  };
  return { name, brand, price, currency: "EUR", description, specs };
}

function generateWearable(rng: ReturnType<typeof makeRng>, brand: string): Omit<Product, "id" | "category"> {
  const kind = rng.pick(["Smartwatch", "Fitness Band"] as const);
  const name = `${brand} ${kind} ${rng.pick(modelWords)} ${pad2(rng.int(10, 99))}`;
  const description =
    kind === "Smartwatch"
      ? "Smartwatch con GPS, monitoraggio salute e notifiche."
      : "Fitness band leggera con monitoraggio attività e sonno.";
  const priceBase = kind === "Smartwatch" ? 149 : 59;
  const price = euros(priceBase + rng.int(-10, 160));
  const specs: Record<string, string> = {
    type: kind,
    display: rng.pick(["1.4\" OLED", "1.6\" AMOLED", "1.1\" OLED"] as const),
    sensors: rng.pick(["HR, SpO2", "HR, SpO2, ECG", "HR"] as const),
    gps: kind === "Smartwatch" ? (rng.chance(0.75) ? "Sì" : "No") : "No",
    battery: `${rng.int(5, 18)} giorni`,
  };
  return { name, brand, price, currency: "EUR", description, specs };
}

function buildProduct(
  rng: ReturnType<typeof makeRng>,
  category: ProductCategory,
  ordinal: number,
): Product {
  const brand = rng.pick(brandsByCat[category]);
  const baseId = `${category}-${slug(brand)}-${ordinal.toString().padStart(5, "0")}`;
  const common = (() => {
    switch (category) {
      case "tv":
        return generateTv(rng, brand, ordinal);
      case "smartphone":
        return generateSmartphone(rng, brand);
      case "laptop":
        return generateLaptop(rng, brand);
      case "appliance":
        return generateAppliance(rng, brand);
      case "audio":
        return generateAudio(rng, brand);
      case "wearable":
        return generateWearable(rng, brand);
    }
  })();

  return {
    id: baseId,
    category,
    ...common,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const rng = makeRng(args.seed);

  const products: Product[] = [];
  for (let i = 0; i < args.count; i++) {
    const category = categories[i % categories.length]!;
    const p = buildProduct(rng, category, i + 1);
    products.push(p);
  }

  // Stable order for diffability / deterministic outputs.
  products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const catalog: Catalog = { products };
  const absOut = resolve(process.cwd(), args.outFile);
  mkdirSync(dirname(absOut), { recursive: true });
  writeFileSync(absOut, JSON.stringify(catalog, null, 2) + "\n", "utf-8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${products.length} products to ${args.outFile}`);
}

main();

