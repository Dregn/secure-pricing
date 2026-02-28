type AdminClient = {
  graphql: (query: string, init?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ThemeSection = {
  type?: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, { type?: string; settings?: Record<string, unknown> }>;
  block_order?: string[];
};

export type ThemePricingProfile = {
  sectionKey: string;
  sectionType: string;
  sourceHint: string;
  maxPieceAreaSqFt: number;
  overflowMarkup: number;
  slabs: Array<{
    min: number;
    max: number;
    amount: number;
    shipping?: number;
    is_default_price?: boolean;
  }>;
  options: Record<string, unknown>;
};

function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    const n = input[i + 1];
    if (inLineComment) {
      if (c === "\n" || c === "\r") {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && n === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === "\"") {
        inString = false;
      }
      continue;
    }
    if (c === "\"") {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && n === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

function stripTrailingCommas(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inString) {
      out += c;
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === "\"") {
        inString = false;
      }
      continue;
    }

    if (c === "\"") {
      inString = true;
      out += c;
      continue;
    }

    if (c === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j += 1;
      const next = input[j];
      if (next === "}" || next === "]") {
        continue;
      }
    }

    out += c;
  }

  return out;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parsePercent(value: unknown): number {
  const match = String(value || "").match(/([-+]?\d+(?:\.\d+)?)\s*%/);
  if (!match) return Number.NaN;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : Number.NaN;
}

function inferSourceFromSectionType(sectionType: string): string {
  const normalized = sectionType.toLowerCase();
  if (normalized.includes("biodegradable")) return "biodegradable_fabric_banner_section";
  if (
    normalized.includes("polyester") ||
    normalized.includes("airmesh") ||
    normalized.includes("dye-sub") ||
    normalized.includes("ultra-sheer") ||
    normalized.includes("blockout")
  ) {
    return "polyester_fabric_section";
  }
  return "";
}

function buildSlabs(section: ThemeSection) {
  const blocks = section.blocks || {};
  const orderedIds = Array.isArray(section.block_order) ? section.block_order : Object.keys(blocks);
  const slabs: ThemePricingProfile["slabs"] = [];
  for (const blockId of orderedIds) {
    const block = blocks[blockId];
    if (!block || block.type !== "width_range") continue;
    const s = block.settings || {};
    slabs.push({
      min: toNumber(s.min_width, 0),
      max: toNumber(s.max_width, 0),
      amount: toNumber(s.amount, 0),
      shipping: toNumber(s.shipping, 0),
      is_default_price: Boolean(s.is_default_price),
    });
  }
  return slabs.filter((slab) => slab.max >= slab.min);
}

function buildOptions(section: ThemeSection): Record<string, unknown> {
  const blocks = section.blocks || {};
  const orderedIds = Array.isArray(section.block_order) ? section.block_order : Object.keys(blocks);
  const sectionSettings = section.settings || {};
  const options: Record<string, unknown> = {};

  for (let i = 1; i <= 6; i += 1) {
    const blockType = `options_${i}`;
    const groupLabel = String(sectionSettings[blockType] || blockType).trim();
    const groupKey = groupLabel || blockType;
    const groupValues: Record<string, number> = {};
    for (const blockId of orderedIds) {
      const block = blocks[blockId];
      if (!block || block.type !== blockType) continue;
      const settings = block.settings || {};
      const optionName = String(settings.optionname || "").trim();
      if (!optionName) continue;
      groupValues[optionName] = toNumber(settings.amount, 0);
    }
    if (Object.keys(groupValues).length > 0) options[groupKey] = groupValues;
  }

  const shippingRules: Record<string, { mode: "fixed"; amount: number } | { mode: "percent"; percent: number }> = {};
  for (const blockId of orderedIds) {
    const block = blocks[blockId];
    if (!block || block.type !== "options_7") continue;
    const settings = block.settings || {};
    const optionName = String(settings.optionname || "").trim();
    if (!optionName) continue;
    const amountRaw = String(settings.amount || "").trim();
    const pct = parsePercent(amountRaw);
    if (Number.isFinite(pct)) {
      shippingRules[optionName] = { mode: "percent", percent: pct };
    } else {
      shippingRules[optionName] = { mode: "fixed", amount: toNumber(amountRaw, 0) };
    }
  }
  if (Object.keys(shippingRules).length > 0) options.shipping = shippingRules;
  return options;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = stable((value as Record<string, unknown>)[key]);
          return acc;
        },
        {} as Record<string, unknown>,
      );
    return sorted;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

async function getActiveThemeId(admin: AdminClient): Promise<string> {
  const response = await admin.graphql(
    `#graphql
    query ActiveTheme {
      themes(first: 20) {
        nodes {
          id
          role
        }
      }
    }`,
  );
  const payload = await response.json();
  const themes = payload?.data?.themes?.nodes || [];
  const main = themes.find((theme: any) => theme.role === "MAIN");
  if (!main?.id) throw new Error("No active MAIN theme found.");
  return String(main.id);
}

async function fetchThemeSettingsData(admin: AdminClient): Promise<any> {
  const themeId = await getActiveThemeId(admin);
  const response = await admin.graphql(
    `#graphql
    query ThemeSettingsData($themeId: ID!) {
      theme(id: $themeId) {
        id
        name
        files(filenames: ["config/data.json", "config/settings_data.json"]) {
          nodes {
            filename
            body {
              __typename
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }`,
    { variables: { themeId } },
  );
  const payload = await response.json();
  const nodes = payload?.data?.theme?.files?.nodes || [];
  const byName = new Map<string, any>(nodes.map((node: any) => [String(node?.filename || ""), node]));
  const preferred = byName.get("config/data.json") || byName.get("config/settings_data.json");
  const content = preferred?.body?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("Unable to read config/data.json or config/settings_data.json from active theme.");
  }
  const normalized = stripTrailingCommas(stripJsonComments(content));
  return JSON.parse(normalized);
}

export async function getThemePricingProfiles(admin: AdminClient): Promise<ThemePricingProfile[]> {
  const settingsData = await fetchThemeSettingsData(admin);
  const sections = settingsData?.current?.sections || settingsData?.sections || {};
  const profiles: ThemePricingProfile[] = [];
  for (const [sectionKey, sectionValue] of Object.entries(sections)) {
    const section = sectionValue as ThemeSection;
    const slabs = buildSlabs(section);
    if (slabs.length === 0) continue;
    const sectionType = String(section.type || "");
    const sourceHint = inferSourceFromSectionType(sectionType);
    const maxPieceAreaSqFt = toNumber(section?.settings?.max_width, 900);
    const overflowMarkup = toNumber(section?.settings?.overflow_markup, 1.17);
    profiles.push({
      sectionKey,
      sectionType,
      sourceHint,
      maxPieceAreaSqFt,
      overflowMarkup,
      slabs,
      options: buildOptions(section),
    });
  }
  return profiles;
}

export async function getThemePricingProfileBySectionKey(
  admin: AdminClient,
  sectionKey: string,
): Promise<ThemePricingProfile | null> {
  const profiles = await getThemePricingProfiles(admin);
  const target = String(sectionKey || "").trim();
  if (!target) return null;
  return profiles.find((profile) => profile.sectionKey === target) || null;
}

export function verifyRuleMatchesAnyThemeProfile(
  rule: {
    source: string;
    maxPieceAreaSqFt: number;
    overflowMarkup: number;
    slabs: Array<{ min: number; max: number; amount: number; shipping?: number; is_default_price?: boolean }>;
    options: Record<string, unknown>;
  },
  profiles: ThemePricingProfile[],
): { ok: true; profile: ThemePricingProfile } | { ok: false; reason: string } {
  if (profiles.length === 0) {
    return { ok: false, reason: "No pricing-aware sections found in active theme config json." };
  }

  const candidates = profiles.filter((profile) => {
    if (!profile.sourceHint) return false;
    return profile.sourceHint === rule.source;
  });

  if (candidates.length === 0) {
    return { ok: false, reason: `No theme section maps to source "${rule.source}".` };
  }

  const matched = candidates.find((profile) => {
    if (Number(profile.maxPieceAreaSqFt) !== Number(rule.maxPieceAreaSqFt)) return false;
    if (Number(profile.overflowMarkup) !== Number(rule.overflowMarkup)) return false;
    if (!deepEqual(profile.slabs, rule.slabs)) return false;
    if (!deepEqual(profile.options, rule.options || {})) return false;
    return true;
  });

  if (!matched) {
    return {
      ok: false,
      reason:
        "Rule values do not match theme config json for this source. Align slabs/options/max_width/overflow_markup first.",
    };
  }

  return { ok: true, profile: matched };
}
