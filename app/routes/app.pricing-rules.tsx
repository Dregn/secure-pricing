import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { Badge, Banner, BlockStack, Box, Button, Card, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  createPricingRule,
  getPricingRuleById,
  listPricingRules,
  updatePricingRule,
  validatePricingRuleInput,
  type PricingRuleInput,
} from "../lib/pricing-rules-admin.server";
import {
  getThemePricingProfileBySectionKey,
  getThemePricingProfiles,
} from "../lib/theme-pricing-settings.server";

type RuleFormValues = PricingRuleInput & { sectionKey?: string };

type ActionData = {
  ok: boolean;
  formError?: string;
  infoMessage?: string;
  errors?: string[];
  values?: RuleFormValues;
};

function emptyRuleValues(): RuleFormValues {
  return {
    ruleName: "",
    source: "",
    maxPieceAreaSqFt: 900,
    overflowMarkup: 1.17,
    slabMetric: "total_area_sqft",
    slabPricingMode: "rate",
    overflowMode: "last_slab_rate",
    overflowUnitRate: null,
    slabs: [],
    options: {},
    shippingSurcharge: 0,
    active: true,
    productIds: [],
    sectionKey: "",
  };
}

function parseRuleInput(formData: FormData): { input: RuleFormValues; parseErrors: string[]; sectionKey: string } {
  const parseErrors: string[] = [];
  const slabsJsonRaw = String(formData.get("slabsJson") || "[]");
  const optionsJsonRaw = String(formData.get("optionsJson") || "{}");
  let slabs: PricingRuleInput["slabs"] = [];
  let options: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(slabsJsonRaw);
    slabs = Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(parsed)) parseErrors.push("Slabs JSON must be an array.");
  } catch {
    parseErrors.push("Slabs JSON is not valid JSON.");
  }

  try {
    const parsed = JSON.parse(optionsJsonRaw);
    options = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
      parseErrors.push("Options JSON must be an object.");
    }
  } catch {
    parseErrors.push("Options JSON is not valid JSON.");
  }

  const sectionKey = String(formData.get("sectionKey") || "").trim();
  const input: RuleFormValues = {
    id: String(formData.get("id") || ""),
    ruleName: String(formData.get("ruleName") || "").trim(),
    source: String(formData.get("source") || "").trim(),
    maxPieceAreaSqFt: Number(formData.get("maxPieceAreaSqFt")),
    overflowMarkup: Number(formData.get("overflowMarkup")),
    slabMetric: formData.get("slabMetric") === "width_ft" ? "width_ft" : "total_area_sqft",
    slabPricingMode: formData.get("slabPricingMode") === "flat_per_piece" ? "flat_per_piece" : "rate",
    overflowMode: formData.get("overflowMode") === "width_unit_rate" ? "width_unit_rate" : "last_slab_rate",
    overflowUnitRate:
      String(formData.get("overflowUnitRate") || "").trim() === ""
        ? null
        : Number(formData.get("overflowUnitRate")),
    slabs,
    options,
    shippingSurcharge: Number(formData.get("shippingSurcharge")),
    active: String(formData.get("active") || "false") === "true",
    productIds: formData
      .getAll("productIds")
      .map((value) => String(value))
      .filter((value) => value.startsWith("gid://shopify/Product/")),
    sectionKey,
  };

  return { input, parseErrors, sectionKey };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const editId = url.searchParams.get("edit");
  const saved = url.searchParams.get("saved");
  const synced = url.searchParams.get("synced");
  const { rules, products } = await listPricingRules(admin as any);
  const editingRule = editId ? await getPricingRuleById(admin as any, editId) : null;
  let themeProfiles: Awaited<ReturnType<typeof getThemePricingProfiles>> = [];
  let themeError = "";
  try {
    themeProfiles = await getThemePricingProfiles(admin as any);
  } catch (error: any) {
    themeError = String(error?.message || error || "Failed to load theme settings.");
  }
  return { rules, products, editingRule, saved, synced, themeProfiles, themeError };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const autoSync = true;
  const { input, parseErrors, sectionKey } = parseRuleInput(formData);

  if (intent === "sync_from_theme") {
    if (!sectionKey) {
      return {
        ok: false,
        formError: "Section Key is required to sync from theme config (data.json/settings_data.json).",
        values: input,
      } as ActionData;
    }
    const exactProfile = sectionKey ? await getThemePricingProfileBySectionKey(admin as any, sectionKey) : null;
    if (!exactProfile) {
      return {
        ok: false,
        formError: `Section "${sectionKey}" not found in active theme config (data.json/settings_data.json).`,
        values: input,
      } as ActionData;
    }
    const profile = exactProfile;

    const nextValues: RuleFormValues = {
      ...input,
      sectionKey: profile.sectionKey,
      source: profile.sourceHint || input.source,
      maxPieceAreaSqFt: profile.maxPieceAreaSqFt,
      overflowMarkup: profile.overflowMarkup,
      slabMetric: "total_area_sqft",
      slabPricingMode: "rate",
      overflowMode: "last_slab_rate",
      overflowUnitRate: null,
      slabs: profile.slabs,
      options: profile.options as Record<string, unknown>,
      shippingSurcharge: Number(input.shippingSurcharge || 0),
    };

    return {
      ok: true,
      infoMessage: `Synced from section "${profile.sectionKey}". You can edit values before saving.`,
      values: nextValues,
    } as ActionData;
  }

  const errors = [...parseErrors, ...validatePricingRuleInput(input)];

  if (errors.length > 0) {
    return {
      ok: false,
      formError: "Please fix the validation errors and try again.",
      errors,
      values: input,
    } as ActionData;
  }

  if (intent === "create") {
    const result = await createPricingRule(admin as any, input, { autoSync });
    return redirect(`/app/pricing-rules?edit=${encodeURIComponent(result.id)}&saved=created&synced=${result.synced}`);
  }

  if (intent === "update") {
    const id = String(formData.get("id") || "");
    if (!id.startsWith("gid://shopify/Metaobject/")) {
      return { ok: false, formError: "Invalid rule ID.", values: input } as ActionData;
    }
    const result = await updatePricingRule(admin as any, id, input, { autoSync });
    return redirect(`/app/pricing-rules?edit=${encodeURIComponent(id)}&saved=updated&synced=${result.synced}`);
  }

  return { ok: false, formError: "Unsupported action.", values: input } as ActionData;
};

export default function PricingRulesPage() {
  const { rules, products, editingRule, saved, synced, themeProfiles, themeError } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const baseValues = useMemo(() => actionData?.values || editingRule || emptyRuleValues(), [actionData?.values, editingRule]);

  return (
    <Page title="Pricing Rules">
      <Layout>
        {saved ? (
          <Layout.Section>
            <Banner tone="success" title={`Rule ${saved}`}>
              <p>
                Save complete. {Number(synced || 0) > 0 ? `Auto-sync complete for ${synced} products.` : "Auto-sync was skipped."}
              </p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          {themeError ? (
            <Banner tone="critical" title="Theme config json not available">
              <p>{themeError}</p>
            </Banner>
          ) : (
            <Banner tone="info" title="Theme sync available">
              <p>
                Enter `Rule Name` and `Section Key`, then click `Sync from theme config` to auto-fill pricing fields.
                Users can still edit fields before save. Profiles found: {themeProfiles.length}.
              </p>
              {themeProfiles.length > 0 ? (
                <ul style={{ margin: "8px 0 0 18px" }}>
                  {themeProfiles.slice(0, 8).map((profile) => (
                    <li key={profile.sectionKey}>
                      {profile.sectionKey} ({profile.sectionType}) {"->"} {profile.sourceHint || "unknown source"}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Banner>
          )}
        </Layout.Section>

        {actionData?.formError ? (
          <Layout.Section>
            <Banner tone="critical" title={actionData.formError}>
              <ul style={{ margin: "8px 0 0 18px" }}>
                {(actionData.errors || []).map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </Banner>
          </Layout.Section>
        ) : null}
        {actionData?.infoMessage ? (
          <Layout.Section>
            <Banner tone="success" title={actionData.infoMessage} />
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Rules List
              </Text>
              {rules.length === 0 ? (
                <Text as="p" tone="subdued">
                  No pricing rules found.
                </Text>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Rule Name</th>
                        <th style={thStyle}>Source</th>
                        <th style={thStyle}>Linked Products</th>
                        <th style={thStyle}>Updated At</th>
                        <th style={thStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule) => (
                        <tr key={rule.id}>
                          <td style={tdStyle}>{rule.ruleName || "-"}</td>
                          <td style={tdStyle}>{rule.source || "-"}</td>
                          <td style={tdStyle}>
                            <Badge>{String(rule.linkedProducts.length)}</Badge>
                          </td>
                          <td style={tdStyle}>{new Date(rule.updatedAt).toLocaleString()}</td>
                          <td style={tdStyle}>
                            <Button url={`/app/pricing-rules?edit=${encodeURIComponent(rule.id)}`} variant="plain">
                              Edit
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <RuleForm
                heading="Create Rule"
                intent="create"
                values={baseValues}
                products={products}
                submitting={submitting}
                isUpdate={false}
              />
            </Card>
            <Card>
              {editingRule ? (
                <RuleForm
                  heading="Update Rule"
                  intent="update"
                  values={baseValues}
                  products={products}
                  submitting={submitting}
                  isUpdate
                />
              ) : (
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Update Rule
                  </Text>
                  <Text as="p" tone="subdued">
                    Select a rule from the list above to edit.
                  </Text>
                </BlockStack>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function RuleForm({
  heading,
  intent,
  values,
  products,
  submitting,
  isUpdate,
}: {
  heading: string;
  intent: "create" | "update";
  values: RuleFormValues;
  products: Array<{ id: string; title: string }>;
  submitting: boolean;
  isUpdate: boolean;
}) {
  const formRenderKey = JSON.stringify({
    id: values.id || "",
    sectionKey: values.sectionKey || "",
    source: values.source || "",
    maxPieceAreaSqFt: values.maxPieceAreaSqFt,
    overflowMarkup: values.overflowMarkup,
    slabMetric: values.slabMetric,
    slabPricingMode: values.slabPricingMode,
    overflowMode: values.overflowMode,
    overflowUnitRate: values.overflowUnitRate,
    slabs: values.slabs,
    options: values.options,
    shippingSurcharge: values.shippingSurcharge,
    active: values.active,
    productIds: values.productIds,
  });

  return (
    <Form method="post" key={formRenderKey}>
      {isUpdate ? <input type="hidden" name="id" value={values.id || ""} /> : null}
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {heading}
        </Text>
        <Field label="Rule Name (required)">
          <input name="ruleName" defaultValue={values.ruleName} required readOnly={isUpdate} style={inputStyle} />
        </Field>
        <Field label="Section Key (for sync)">
          <input
            name="sectionKey"
            defaultValue={values.sectionKey || ""}
            placeholder="e.g. product-polyester-fabric"
            style={inputStyle}
          />
        </Field>
        <button type="submit" name="intent" value="sync_from_theme" disabled={submitting} style={secondaryButtonStyle}>
          {submitting ? "Syncing..." : "Sync from theme config"}
        </button>
        <Field label="Source (required)">
          <input name="source" defaultValue={values.source} required style={inputStyle} />
        </Field>
        <InlineStack gap="300">
          <Box width="50%">
            <Field label="Max Piece Area SqFt">
              <input
                name="maxPieceAreaSqFt"
                type="number"
                step="0.0001"
                defaultValue={values.maxPieceAreaSqFt}
                required
                style={inputStyle}
              />
            </Field>
          </Box>
          <Box width="50%">
            <Field label="Overflow Markup">
              <input
                name="overflowMarkup"
                type="number"
                step="0.0001"
                defaultValue={values.overflowMarkup}
                required
                style={inputStyle}
              />
            </Field>
          </Box>
        </InlineStack>
        <InlineStack gap="300">
          <Box width="50%">
            <Field label="Slab Metric">
              <select name="slabMetric" defaultValue={values.slabMetric} style={inputStyle}>
                <option value="total_area_sqft">total_area_sqft</option>
                <option value="width_ft">width_ft</option>
              </select>
            </Field>
          </Box>
          <Box width="50%">
            <Field label="Slab Pricing Mode">
              <select name="slabPricingMode" defaultValue={values.slabPricingMode} style={inputStyle}>
                <option value="rate">rate</option>
                <option value="flat_per_piece">flat_per_piece</option>
              </select>
            </Field>
          </Box>
        </InlineStack>
        <InlineStack gap="300">
          <Box width="50%">
            <Field label="Overflow Mode">
              <select name="overflowMode" defaultValue={values.overflowMode} style={inputStyle}>
                <option value="last_slab_rate">last_slab_rate</option>
              </select>
            </Field>
          </Box>
          <Box width="50%">
            <Field label="Active">
              <select name="active" defaultValue={String(values.active)} style={inputStyle}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </Field>
          </Box>
        </InlineStack>
        <Field label="Slabs JSON (required)">
          <textarea
            name="slabsJson"
            rows={14}
            defaultValue={JSON.stringify(values.slabs, null, 2)}
            required
            spellCheck={false}
            autoCorrect="off"
            autoComplete="off"
            style={textareaStyle}
          />
        </Field>
        <Field label="Options JSON">
          <textarea
            name="optionsJson"
            rows={12}
            defaultValue={JSON.stringify(values.options, null, 2)}
            spellCheck={false}
            autoCorrect="off"
            autoComplete="off"
            style={textareaStyle}
          />
        </Field>
        <Field label="Linked Products">
          <select name="productIds" multiple size={8} defaultValue={values.productIds} style={textareaStyle}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Text as="p" tone="subdued">
          Saving a rule will automatically sync linked product <code>pricing_rule_json</code> so cart transform uses the
          latest values.
        </Text>
        <button type="submit" name="intent" value={intent} disabled={submitting} style={primaryButtonStyle}>
          {submitting ? "Saving..." : isUpdate ? "Save Rule" : "Create Rule"}
        </button>
      </BlockStack>
    </Form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodyMd" fontWeight="medium">
        {label}
      </Text>
      {children}
    </BlockStack>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #8a8a8a",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 96,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e1e3e5",
  padding: "10px 8px",
  fontSize: 13,
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #f1f2f3",
  padding: "10px 8px",
  fontSize: 14,
};

const primaryButtonStyle: CSSProperties = {
  background: "#111827",
  color: "#fff",
  borderRadius: 8,
  border: "none",
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  background: "#ffffff",
  color: "#111827",
  borderRadius: 8,
  border: "1px solid #6b7280",
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};
