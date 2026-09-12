import { createHash } from "node:crypto";

export type DynamicFieldType = "text" | "email" | "number" | "imei" | "serial" | "username" | "quantity" | "select" | "textarea";
export type DynamicField = {
  key: string;
  label: string;
  type: DynamicFieldType;
  required: boolean;
  placeholder: string;
  validation: { minLength?: number; maxLength?: number; pattern?: string } | null;
  providerFieldName: string;
  position: number;
  sensitive: boolean;
  customerVisible: boolean;
};

type RawField = { name: string; type?: string | null; required?: boolean | null; base?: boolean | null };
type CatalogContract = {
  providerCode?: string;
  label?: string | null;
  providerCostCents?: number | null;
  metadata?: unknown;
};

const plainRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function normalizeProviderField(name: string, rawType?: string | null, position = 0): DynamicField {
  const normalized = plain(name);
  const remote = /ultra\s*viewer|team\s*viewer|any\s*desk|remote\s*(id|session)/.test(normalized);
  const key = remote ? "remote_session_id"
    : /^(quantity|qty|quantidade)$/.test(normalized) ? "quantity"
    : /^(user\s*name|username|user|login)$/.test(normalized) ? "username"
    : /e\s*mail|email/.test(normalized) ? "email"
    : /imei/.test(normalized) ? "imei"
    : /serial|^sn$|serial number/.test(normalized) ? "serial"
    : /licen[cs]e|licenca/.test(normalized) ? "license"
    : normalized.replace(/\s+/g, "_") || `field_${position + 1}`;
  const sourceType = plain(rawType ?? "");
  const type: DynamicFieldType = key === "quantity" ? "quantity"
    : key === "email" ? "email"
    : key === "imei" ? "imei"
    : key === "serial" ? "serial"
    : key === "username" ? "username"
    : /select|option|dropdown/.test(sourceType) ? "select"
    : /textarea|long\s*text/.test(sourceType) ? "textarea"
    : /number|integer/.test(sourceType) ? "number" : "text";
  const placeholder = remote ? "Informe o ID da sessão remota" : `Informe ${name}`;
  const validation = type === "imei" ? { minLength: 14, maxLength: 16, pattern: "^[0-9]+$" }
    : type === "serial" ? { minLength: 3, maxLength: 100 }
    : type === "email" ? { maxLength: 254 }
    : type === "quantity" ? { minLength: 1, maxLength: 1, pattern: "^1$" }
    : { minLength: 1, maxLength: 500 };
  return {
    key,
    label: name.trim(),
    type,
    required: true,
    placeholder,
    validation,
    providerFieldName: name.trim(),
    position,
    sensitive: /password|pass|token|license|licenca|key|chave/.test(normalized),
    customerVisible: key !== "quantity",
  };
}

export function dynamicFieldSchema(metadata: unknown): DynamicField[] {
  const raw = plainRecord(metadata)?.requiredFields;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, position) => {
    const field = plainRecord(entry);
    if (!field || typeof field.name !== "string" || !field.name.trim()) return [];
    return [{ ...normalizeProviderField(field.name, typeof field.type === "string" ? field.type : null, position), required: field.required !== false }];
  });
}

export type ProductAutomation = {
  automationClass: "AUTO_CREDENTIAL" | "AUTO_GENERIC_REPLAY" | "AUTO_FIELD_BASED" | "REMOTE_SESSION" | "MANUAL_REVIEW" | "UNSUPPORTED";
  technicalEligibility: "READY" | "REVIEW" | "UNSUPPORTED";
  expectedDeliveryType: "CREDENTIALS" | "LICENSE" | "CODE" | "TEXT" | "MULTI_FIELD";
  fieldSchema: DynamicField[];
  contractSignature: string;
};

export function classifyProviderProduct(input: CatalogContract): ProductAutomation {
  const metadata = plainRecord(input.metadata);
  const schema = dynamicFieldSchema(input.metadata);
  const searchable = plain([input.label, metadata?.categoryName, metadata?.providerType, metadata?.providerDescription].filter(Boolean).join(" "));
  const hasRemote = schema.some((field) => field.key === "remote_session_id") || /ultra\s*viewer|team\s*viewer|any\s*desk|remote session/.test(searchable);
  const quantityOnly = schema.length === 1 && schema[0].key === "quantity";
  const credentialsExpected = /rent|rental|aluguel|id password|instant auto|credential|login/.test(searchable);
  const licenseExpected = /licen[cs]e|licenca|activation key|ativacao/.test(searchable);
  const codeExpected = /code|codigo|credit|credito/.test(searchable);
  const expectedDeliveryType = credentialsExpected ? "CREDENTIALS" : licenseExpected ? "LICENSE" : codeExpected ? "CODE" : schema.length > 1 ? "MULTI_FIELD" : "TEXT";
  const unsupportedField = schema.some((field) => field.type === "select" && !plainRecord(metadata)?.fieldOptions);
  let automationClass: ProductAutomation["automationClass"];
  let technicalEligibility: ProductAutomation["technicalEligibility"];
  if (hasRemote) [automationClass, technicalEligibility] = ["REMOTE_SESSION", "REVIEW"];
  else if (input.providerCostCents == null) [automationClass, technicalEligibility] = ["MANUAL_REVIEW", "REVIEW"];
  else if (!schema.length) [automationClass, technicalEligibility] = ["MANUAL_REVIEW", "REVIEW"];
  else if (unsupportedField) [automationClass, technicalEligibility] = ["UNSUPPORTED", "UNSUPPORTED"];
  else if (quantityOnly && expectedDeliveryType === "CREDENTIALS") [automationClass, technicalEligibility] = ["AUTO_CREDENTIAL", "READY"];
  else if (quantityOnly) [automationClass, technicalEligibility] = ["AUTO_GENERIC_REPLAY", "READY"];
  else [automationClass, technicalEligibility] = ["AUTO_FIELD_BASED", "READY"];
  const signaturePayload = {
    provider: plain(input.providerCode ?? "heartunlocks"),
    fields: schema.map(({ key, type, required, customerVisible }) => ({ key, type, required, customerVisible })).sort((a, b) => a.key.localeCompare(b.key)),
    quantity: quantityOnly ? "FIXED_ONE" : schema.some((field) => field.key === "quantity") ? "SUPPLIED" : "NONE",
    callback: true,
    fulfillment: hasRemote ? "REMOTE" : "AUTOMATIC",
    delivery: expectedDeliveryType,
  };
  return {
    automationClass,
    technicalEligibility,
    expectedDeliveryType,
    fieldSchema: schema,
    contractSignature: createHash("sha256").update(JSON.stringify(signaturePayload)).digest("hex"),
  };
}

export function validateDynamicFieldValues(schema: DynamicField[], values: unknown) {
  const source = plainRecord(values) ?? {};
  const output: Record<string, string | number> = {};
  for (const field of schema) {
    if (field.key === "quantity") {
      output[field.providerFieldName] = 1;
      continue;
    }
    const raw = source[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value) throw new Error(`PROVIDER_FIELD_REQUIRED:${field.key}`);
    if (!value) continue;
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`PROVIDER_FIELD_INVALID:${field.key}`);
    if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(value)) throw new Error(`PROVIDER_FIELD_INVALID:${field.key}`);
    if (field.validation?.minLength && value.length < field.validation.minLength) throw new Error(`PROVIDER_FIELD_INVALID:${field.key}`);
    if (field.validation?.maxLength && value.length > field.validation.maxLength) throw new Error(`PROVIDER_FIELD_INVALID:${field.key}`);
    output[field.providerFieldName] = value;
  }
  return output;
}
