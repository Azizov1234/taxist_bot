import {
  DRIVER_AD_NEGATIVE_KEYWORDS,
  MOVEMENT_KEYWORDS,
  PASSENGER_KEYWORDS_CYRILLIC,
  PASSENGER_KEYWORDS_LATIN,
  ROUTE_KEYWORDS,
  SPAM_KEYWORDS
} from "../config/defaultKeywords.js";
import { type AIProviderName, env } from "../config/env.js";
import { detectRoute } from "../utils/route.js";
import { extractPhone } from "../utils/phone.js";
import { normalizeUzbekText, stripExtraPunctuation } from "../utils/text.js";
import { logger } from "./logger.service.js";

export type ProviderName = AIProviderName | "keyword";

type ProviderStatus = "active" | "cooldown";

interface ProviderState {
  name: AIProviderName;
  status: ProviderStatus;
  disabledUntil: number | null;
  reason: string | null;
}

interface AIResult {
  is_passenger_lead: boolean;
  confidence: number;
  reason: string;
  from_location: string | null;
  to_location: string | null;
  phone: string | null;
  passenger_count: number | null;
  time_hint: string | null;
  is_driver_ad: boolean;
  is_spam: boolean;
}

interface LeadProviderAdapter {
  readonly name: AIProviderName;
  isConfigured(): boolean;
  analyzeLead(text: string): Promise<AIResult>;
}

interface OpenAICompatibleRequest {
  providerName: AIProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  text: string;
  extraHeaders?: Record<string, string>;
}

export interface ProviderStatusSnapshot {
  name: AIProviderName;
  status: ProviderStatus;
  disabledUntil: number | null;
  keyConfigured: boolean;
  reason: string | null;
}

export interface MessageClassification {
  is_passenger_request: boolean;
  confidence: number;
  reason: string;
  provider: ProviderName;
  normalizedText: string;
  keywordScore?: number;
  providerStatuses: ProviderStatusSnapshot[];
  isDriverAd: boolean;
  isSpam: boolean;
  fromLocation: string | null;
  toLocation: string | null;
  phone: string | null;
  passengerCount: number | null;
  timeHint: string | null;
}

export interface KeywordClassification {
  is_passenger_request: boolean;
  confidence: number;
  reason: string;
  score: number;
}

export interface LeadClassification {
  isLead: boolean;
  isSpam: boolean;
  score: number;
  normalizedText: string;
  matchedKeywords: string[];
  matchedPatterns: string[];
  route: string | null;
}

const ALL_AI_PROVIDERS: AIProviderName[] = ["gemini", "groq", "cerebras", "openrouter", "cloudflare"];
const TEMPORARY_ERROR_CODES = new Set([500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `Sen Telegram taxi guruhidagi xabarni analiz qilasan.
Maqsad: xabar YO'LOVCHI taxi qidiryaptimi yoki yo'qmi aniqlash.

Faqat JSON qaytar. Hech qanday qo'shimcha matn qaytarma.

Schema:
{
  "is_passenger_lead": true,
  "confidence": 0.0,
  "reason": "qisqa sabab",
  "from_location": null,
  "to_location": null,
  "phone": null,
  "passenger_count": null,
  "time_hint": null,
  "is_driver_ad": false,
  "is_spam": false
}

Qoidalar:
- Odam taxi/taksi qidirayotgan bo'lsa: is_passenger_lead=true.
- Odam borish/ketish niyatini yozsa: is_passenger_lead=true.
- Driver reklama bo'lsa ("bo'sh joy bor", "odam olaman", "taxi xizmati"): is_passenger_lead=false, is_driver_ad=true.
- Spam/reklama/link/kanalga chaqirish bo'lsa: is_spam=true.
- Lotin, kirill, aralash yozuv, xato yozuvlarni tushun.
- Agar matn faqat umumiy savol bo'lsa ("qayerdan qayerga", "qayerga?", "куда?") va yo'lovchi niyati aniq bo'lmasa: is_passenger_lead=false.
- from_location/to_location maydonlariga savol so'zlarini yozma: "qayer", "qayerga", "qayerdan", "куда", "откуда". Bunday holatda null qaytar.
- Aniqlanmagan maydonlar null bo'lsin.`;

const GENERIC_LOCATION_TOKENS = new Set([
  "qayer",
  "qayerga",
  "qayerdan",
  "qayerda",
  "qaer",
  "qaerga",
  "qaerdan",
  "qaerda",
  "qayoqqa",
  "куда",
  "откуда",
  "где",
  "where",
  "where to",
  "from where"
]);

const UZBEK_ENGLISH_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\b(taxi|taksi|takis)\b/iu, hint: "taxi request" },
  { pattern: /\b(kerak|kere|kerek|ker|krk)\b/iu, hint: "needs a ride" },
  { pattern: /\b(hozir|tez|srochna|shoshilinch)\b/iu, hint: "urgent / now" },
  { pattern: /\b(qayerdan|qayerga|qayerda|qaerdan|qaerga)\b/iu, hint: "location question (from/to/where)" },
  { pattern: /\b(ketish|borish|ketaman|boraman)\b/iu, hint: "travel intent (go/leave)" },
  { pattern: /\b(odam|kishi)\b/iu, hint: "passenger count mentioned" },
  { pattern: /\b(joy bor|odam olaman|mijoz olaman|yolovchi olaman)\b/iu, hint: "driver advertisement signal" }
];

class AIProviderHttpError extends Error {
  readonly provider: AIProviderName;
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly responseBody: string;

  constructor(provider: AIProviderName, status: number, message: string, retryAfterMs: number | null, responseBody: string) {
    super(message);
    this.name = "AIProviderHttpError";
    this.provider = provider;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.responseBody = responseBody;
  }
}

class AIProviderTimeoutError extends Error {
  readonly provider: AIProviderName;
  readonly timeoutMs: number;

  constructor(provider: AIProviderName, timeoutMs: number) {
    super(`${provider} request timed out after ${timeoutMs}ms`);
    this.name = "AIProviderTimeoutError";
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}

class AIProviderNetworkError extends Error {
  readonly provider: AIProviderName;

  constructor(provider: AIProviderName, message: string) {
    super(message);
    this.name = "AIProviderNetworkError";
    this.provider = provider;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return Number(value.toFixed(2));
}

function baseCooldownMs(): number {
  return Math.max(1, env.AI_COOLDOWN_MINUTES) * 60_000;
}

function timeoutMs(): number {
  return env.AI_TIMEOUT_MS > 0 ? env.AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return Math.round(asNumber * 1000);
  }

  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : 0;
  }

  return null;
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const withoutFence = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  if (withoutFence.startsWith("{") && withoutFence.endsWith("}")) {
    return withoutFence;
  }

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return withoutFence.slice(start, end + 1);
  }

  return withoutFence;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLocationToken(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeLocationFromAI(value: unknown): string | null {
  const raw = asStringOrNull(value);
  if (!raw) {
    return null;
  }

  const token = normalizeLocationToken(raw);
  if (!token || GENERIC_LOCATION_TOKENS.has(token)) {
    return null;
  }

  return raw;
}

function buildProviderInputText(text: string): string {
  const normalized = normalizeText(text);
  const hints = UZBEK_ENGLISH_HINTS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.hint);
  const uniqueHints = [...new Set(hints)];
  const hintLine = uniqueHints.length > 0 ? uniqueHints.join("; ") : "none";

  return [
    `Original message: ${text}`,
    `Normalized message: ${normalized}`,
    `English hints: ${hintLine}`
  ].join("\n");
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(1, Math.round(parsed));
}

function parseAIResult(raw: string): AIResult {
  const payload = extractJsonObject(raw);
  const parsed = JSON.parse(payload) as Record<string, unknown>;

  const rawDecision = parsed.is_passenger_lead ?? parsed.is_passenger_request;
  const isPassengerLead =
    typeof rawDecision === "boolean"
      ? rawDecision
      : typeof rawDecision === "string"
        ? rawDecision.trim().toLowerCase() === "true"
        : false;

  return {
    is_passenger_lead: isPassengerLead,
    confidence: clampConfidence(Number(parsed.confidence ?? 0)),
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "AI decision",
    from_location: sanitizeLocationFromAI(parsed.from_location),
    to_location: sanitizeLocationFromAI(parsed.to_location),
    phone: asStringOrNull(parsed.phone),
    passenger_count: asNumberOrNull(parsed.passenger_count),
    time_hint: asStringOrNull(parsed.time_hint),
    is_driver_ad: Boolean(parsed.is_driver_ad),
    is_spam: Boolean(parsed.is_spam)
  };
}

function containsKeyword(normalizedText: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) {
    return false;
  }

  const boundaryPattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedKeyword)}(?=$|[^\\p{L}\\p{N}])`, "iu");
  return boundaryPattern.test(normalizedText);
}

function uniqueNormalized(values: readonly string[]): string[] {
  const normalized = values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);

  return [...new Set(normalized)];
}

const passengerKeywords = uniqueNormalized([...PASSENGER_KEYWORDS_LATIN, ...PASSENGER_KEYWORDS_CYRILLIC]);
const routeKeywords = uniqueNormalized(ROUTE_KEYWORDS);
const movementKeywords = uniqueNormalized(MOVEMENT_KEYWORDS);
const spamKeywords = uniqueNormalized(SPAM_KEYWORDS);
const driverAdKeywords = uniqueNormalized(DRIVER_AD_NEGATIVE_KEYWORDS);

function collectHits(normalizedText: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => containsKeyword(normalizedText, keyword));
}

function confidenceFromKeywordScore(score: number, isPassengerRequest: boolean): number {
  if (isPassengerRequest) {
    return clampConfidence(0.55 + Math.min(score, 8) * 0.06);
  }

  return clampConfidence(0.15 + Math.max(0, score) * 0.1);
}

export function normalizeText(text: string): string {
  return normalizeUzbekText(stripExtraPunctuation(text));
}

export function keywordClassify(text: string): KeywordClassification {
  const normalized = normalizeText(text);

  if (!normalized) {
    return {
      is_passenger_request: false,
      confidence: 0,
      reason: "Empty message",
      score: 0
    };
  }

  const passengerHits = collectHits(normalized, passengerKeywords);
  const routeHits = collectHits(normalized, routeKeywords);
  const movementHits = collectHits(normalized, movementKeywords);
  const spamHits = collectHits(normalized, spamKeywords);
  const driverAdHits = collectHits(normalized, driverAdKeywords);
  const hasPhone = Boolean(extractPhone(text));

  const score =
    passengerHits.length * 3 +
    routeHits.length * 2 +
    movementHits.length +
    (hasPhone ? 1 : 0) -
    spamHits.length * 3 -
    driverAdHits.length * 3;

  const isPassengerRequest = score >= 3;
  const confidence = confidenceFromKeywordScore(score, isPassengerRequest);

  return {
    is_passenger_request: isPassengerRequest,
    confidence,
    reason: `score=${score}; passenger=${passengerHits.length}; route=${routeHits.length}; movement=${movementHits.length}; phone=${hasPhone ? 1 : 0}; spam=${spamHits.length}; driver_ad=${driverAdHits.length}`,
    score
  };
}

async function requestJson(providerName: AIProviderName, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new AIProviderHttpError(
        providerName,
        response.status,
        `${providerName} HTTP ${response.status}`,
        parseRetryAfterMs(response.headers.get("retry-after")),
        responseText
      );
    }

    return JSON.parse(responseText) as unknown;
  } catch (error) {
    if (error instanceof AIProviderHttpError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AIProviderTimeoutError(providerName, timeoutMs());
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new AIProviderNetworkError(providerName, `${providerName} network error: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWithOpenAICompatible(request: OpenAICompatibleRequest): Promise<AIResult> {
  const modelInput = buildProviderInputText(request.text);

  const payload = {
    model: request.model,
    temperature: 0,
    response_format: { type: "json_object" },
    max_tokens: 320,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Message:\n${modelInput}` }
    ]
  };

  const response = (await requestJson(request.providerName, request.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      ...(request.extraHeaders ?? {})
    },
    body: JSON.stringify(payload)
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`${request.providerName} response content is empty`);
  }

  return parseAIResult(content);
}

class GeminiProvider implements LeadProviderAdapter {
  readonly name = "gemini" as const;

  isConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  async analyzeLead(text: string): Promise<AIResult> {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const modelInput = buildProviderInputText(text);

    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${SYSTEM_PROMPT}\n\nMessage:\n${modelInput}` }]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    };

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

    const response = (await requestJson(this.name, endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("Gemini response content is empty");
    }

    return parseAIResult(content);
  }
}

class GroqProvider implements LeadProviderAdapter {
  readonly name = "groq" as const;

  isConfigured(): boolean {
    return Boolean(env.GROQ_API_KEY);
  }

  async analyzeLead(text: string): Promise<AIResult> {
    if (!env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    return analyzeWithOpenAICompatible({
      providerName: this.name,
      apiKey: env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: env.GROQ_MODEL,
      text
    });
  }
}

class CerebrasProvider implements LeadProviderAdapter {
  readonly name = "cerebras" as const;

  isConfigured(): boolean {
    return Boolean(env.CEREBRAS_API_KEY);
  }

  async analyzeLead(text: string): Promise<AIResult> {
    if (!env.CEREBRAS_API_KEY) {
      throw new Error("CEREBRAS_API_KEY is not configured");
    }

    return analyzeWithOpenAICompatible({
      providerName: this.name,
      apiKey: env.CEREBRAS_API_KEY,
      baseUrl: "https://api.cerebras.ai/v1/chat/completions",
      model: env.CEREBRAS_MODEL,
      text
    });
  }
}

class OpenRouterProvider implements LeadProviderAdapter {
  readonly name = "openrouter" as const;

  isConfigured(): boolean {
    return Boolean(env.OPENROUTER_API_KEY);
  }

  async analyzeLead(text: string): Promise<AIResult> {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const extraHeaders: Record<string, string> = {};
    if (env.OPENROUTER_SITE_URL) {
      extraHeaders["HTTP-Referer"] = env.OPENROUTER_SITE_URL;
    }

    if (env.OPENROUTER_APP_NAME) {
      extraHeaders["X-Title"] = env.OPENROUTER_APP_NAME;
    }

    return analyzeWithOpenAICompatible({
      providerName: this.name,
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      model: env.OPENROUTER_MODEL,
      text,
      extraHeaders
    });
  }
}

class CloudflareProvider implements LeadProviderAdapter {
  readonly name = "cloudflare" as const;

  isConfigured(): boolean {
    return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
  }

  async analyzeLead(text: string): Promise<AIResult> {
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for Cloudflare provider");
    }

    return analyzeWithOpenAICompatible({
      providerName: this.name,
      apiKey: env.CLOUDFLARE_API_TOKEN,
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
      model: env.CLOUDFLARE_MODEL,
      text
    });
  }
}

const providerAdapters: Record<AIProviderName, LeadProviderAdapter> = {
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
  cerebras: new CerebrasProvider(),
  openrouter: new OpenRouterProvider(),
  cloudflare: new CloudflareProvider()
};

const providers: Record<AIProviderName, ProviderState> = {
  gemini: { name: "gemini", status: "active", disabledUntil: null, reason: null },
  groq: { name: "groq", status: "active", disabledUntil: null, reason: null },
  cerebras: { name: "cerebras", status: "active", disabledUntil: null, reason: null },
  openrouter: { name: "openrouter", status: "active", disabledUntil: null, reason: null },
  cloudflare: { name: "cloudflare", status: "active", disabledUntil: null, reason: null }
};

function refreshProviderState(providerName: AIProviderName): void {
  const provider = providers[providerName];
  if (provider.status !== "cooldown") {
    return;
  }

  if (!provider.disabledUntil || Date.now() >= provider.disabledUntil) {
    provider.status = "active";
    provider.disabledUntil = null;
    provider.reason = null;
    logger.info({ provider: providerName }, "Provider cooldown finished, provider is active again");
  }
}

function isProviderConfigured(providerName: AIProviderName): boolean {
  return providerAdapters[providerName].isConfigured();
}

function isProviderAvailable(providerName: AIProviderName): boolean {
  refreshProviderState(providerName);
  return isProviderConfigured(providerName) && providers[providerName].status === "active";
}

function getErrorSummary(error: unknown): string {
  if (error instanceof AIProviderHttpError) {
    const body = error.responseBody.slice(0, 250);
    return `HTTP ${error.status}: ${body || error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toProviderSnapshot(providerName: AIProviderName): ProviderStatusSnapshot {
  refreshProviderState(providerName);
  const provider = providers[providerName];

  return {
    name: provider.name,
    status: provider.status,
    disabledUntil: provider.disabledUntil,
    keyConfigured: isProviderConfigured(providerName),
    reason: provider.reason
  };
}

export function getProviderStatusSnapshot(): ProviderStatusSnapshot[] {
  return ALL_AI_PROVIDERS.map((providerName) => toProviderSnapshot(providerName));
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof AIProviderHttpError && error.status === 429) {
    return true;
  }

  if (error instanceof Error) {
    return /429|rate limit/i.test(error.message);
  }

  return false;
}

export function isTemporaryError(error: unknown): boolean {
  if (error instanceof AIProviderTimeoutError || error instanceof AIProviderNetworkError) {
    return true;
  }

  if (error instanceof AIProviderHttpError) {
    return TEMPORARY_ERROR_CODES.has(error.status);
  }

  if (error instanceof Error) {
    return /timed out|timeout|econnreset|enotfound|socket hang up/i.test(error.message);
  }

  return false;
}

export function disableProvider(providerName: AIProviderName, ms: number, reason: string): void {
  const provider = providers[providerName];
  const cooldownMs = Math.max(1_000, ms);
  const disabledUntil = Date.now() + cooldownMs;

  provider.status = "cooldown";
  provider.disabledUntil = disabledUntil;
  provider.reason = reason;

  logger.warn(
    {
      provider: providerName,
      reason,
      cooldownMs,
      disabledUntil: new Date(disabledUntil).toISOString(),
      providerStatuses: getProviderStatusSnapshot()
    },
    "Provider moved to cooldown"
  );
}

export function getAvailableProvider(): AIProviderName | null {
  for (const providerName of env.AI_PROVIDER_ORDER) {
    if (isProviderAvailable(providerName)) {
      return providerName;
    }
  }

  return null;
}

function cooldownMsFromError(error: unknown): number {
  if (error instanceof AIProviderHttpError && error.status === 429 && error.retryAfterMs !== null) {
    return Math.max(1_000, error.retryAfterMs);
  }

  return baseCooldownMs();
}

async function classifyWithProvider(providerName: AIProviderName, text: string): Promise<AIResult> {
  return providerAdapters[providerName].analyzeLead(text);
}

export async function classifyMessage(text: string): Promise<MessageClassification> {
  const normalizedText = normalizeText(text);

  if (env.AI_ENABLED) {
    for (const providerName of env.AI_PROVIDER_ORDER) {
      if (!isProviderConfigured(providerName)) {
        logger.debug({ provider: providerName }, "Provider skipped because credentials are not configured");
        continue;
      }

      if (!isProviderAvailable(providerName)) {
        continue;
      }

      for (let attempt = 0; attempt <= env.AI_MAX_RETRIES; attempt += 1) {
        try {
          logger.info({ provider: providerName, attempt: attempt + 1 }, "Classifier provider selected");
          const aiResult = await classifyWithProvider(providerName, text);

          return {
            is_passenger_request: aiResult.is_passenger_lead,
            confidence: clampConfidence(aiResult.confidence),
            reason: aiResult.reason,
            provider: providerName,
            normalizedText,
            providerStatuses: getProviderStatusSnapshot(),
            isDriverAd: aiResult.is_driver_ad,
            isSpam: aiResult.is_spam,
            fromLocation: aiResult.from_location,
            toLocation: aiResult.to_location,
            phone: aiResult.phone,
            passengerCount: aiResult.passenger_count,
            timeHint: aiResult.time_hint
          };
        } catch (error) {
          const canRetry = attempt < env.AI_MAX_RETRIES;

          if (isRateLimitError(error) || isTemporaryError(error)) {
            if (canRetry) {
              continue;
            }

            disableProvider(providerName, cooldownMsFromError(error), getErrorSummary(error));
            break;
          }

          if (canRetry) {
            continue;
          }

          logger.warn(
            {
              provider: providerName,
              error: getErrorSummary(error)
            },
            "Provider failed, trying next provider"
          );
        }
      }
    }
  }

  const fallback = keywordClassify(text);

  return {
    is_passenger_request: fallback.is_passenger_request,
    confidence: fallback.confidence,
    reason: fallback.reason,
    provider: "keyword",
    normalizedText,
    keywordScore: fallback.score,
    providerStatuses: getProviderStatusSnapshot(),
    isDriverAd: false,
    isSpam: false,
    fromLocation: null,
    toLocation: null,
    phone: null,
    passengerCount: null,
    timeHint: null
  };
}

export async function classifyLead(rawText: string): Promise<LeadClassification> {
  const result = await classifyMessage(rawText);

  return {
    isLead: result.is_passenger_request,
    isSpam: result.isSpam,
    score: result.keywordScore ?? Math.round(result.confidence * 10),
    normalizedText: result.normalizedText,
    matchedKeywords: [],
    matchedPatterns: [],
    route: detectRoute(rawText)
  };
}
