import {
  DRIVER_AD_NEGATIVE_KEYWORDS,
  MOVEMENT_KEYWORDS,
  PASSENGER_KEYWORDS_CYRILLIC,
  PASSENGER_KEYWORDS_LATIN,
  ROUTE_KEYWORDS,
  SPAM_KEYWORDS
} from "../config/defaultKeywords.js";
import { env } from "../config/env.js";
import { detectRoute } from "../utils/route.js";
import { extractPhone } from "../utils/phone.js";
import { normalizeUzbekText, stripExtraPunctuation } from "../utils/text.js";
import { logger } from "./logger.service.js";

type AIProviderName = "groq" | "gemini" | "openrouter";
export type ProviderName = AIProviderName | "keyword";

type ProviderStatus = "active" | "cooldown";

interface ProviderState {
  name: AIProviderName;
  apiKey: string | undefined;
  status: ProviderStatus;
  disabledUntil: number | null;
  reason: string | null;
}

interface AIResult {
  is_passenger_request: boolean;
  confidence: number;
  reason: string;
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
}

export interface KeywordClassification extends AIResult {
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

const PROVIDER_PRIORITY: AIProviderName[] = ["groq", "gemini", "openrouter"];
const TEMPORARY_ERROR_CODES = new Set([500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You are a Telegram taxi request classifier.

Analyze one Telegram message. The message can be in Uzbek Latin, Uzbek Cyrillic, Russian, or mixed slang.

Return ONLY valid JSON:
{
  "is_passenger_request": true,
  "confidence": 0.0,
  "reason": "short reason"
}

Passenger request means:
- person needs taxi
- person needs car
- person needs a ride
- person asks who can take them
- person writes route/location/time/phone
- person says “taxi kerak”, “taksi kerak”, “mashina kerak”, “borish kerak”, “ketish kerak”
- Uzbek Cyrillic, Latin, Russian and slang should be understood

Not passenger request:
- driver advertising himself
- driver says he has empty seats
- taxi service advertisement
- random chat
- spam
- price discussion only
- links/reklama

Rules:
- If passenger needs taxi, return true.
- If driver is offering taxi, return false.
- If unsure, return false.
- confidence must be between 0 and 1.
- Do not return markdown.
- Do not explain outside JSON.`;

const providers: Record<AIProviderName, ProviderState> = {
  groq: {
    name: "groq",
    apiKey: env.GROQ_API_KEY,
    status: "active",
    disabledUntil: null,
    reason: null
  },
  gemini: {
    name: "gemini",
    apiKey: env.GEMINI_API_KEY,
    status: "active",
    disabledUntil: null,
    reason: null
  },
  openrouter: {
    name: "openrouter",
    apiKey: env.OPENROUTER_API_KEY,
    status: "active",
    disabledUntil: null,
    reason: null
  }
};

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

function refreshProviderState(providerName: AIProviderName): void {
  const provider = providers[providerName];
  if (provider.status !== "cooldown") {
    return;
  }

  if (!provider.disabledUntil) {
    provider.status = "active";
    provider.reason = null;
    return;
  }

  if (Date.now() >= provider.disabledUntil) {
    provider.status = "active";
    provider.disabledUntil = null;
    provider.reason = null;
    logger.info({ provider: providerName }, "Provider cooldown finished, provider is active again");
  }
}

function isProviderConfigured(providerName: AIProviderName): boolean {
  return Boolean(providers[providerName].apiKey);
}

function isProviderAvailable(providerName: AIProviderName): boolean {
  refreshProviderState(providerName);
  const provider = providers[providerName];

  if (!provider.apiKey) {
    return false;
  }

  return provider.status === "active";
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

function parseAIResult(raw: string): AIResult {
  const payload = extractJsonObject(raw);
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  const rawDecision = parsed.is_passenger_request;
  const isPassengerRequest =
    typeof rawDecision === "boolean"
      ? rawDecision
      : typeof rawDecision === "string"
        ? rawDecision.trim().toLowerCase() === "true"
        : false;
  const rawConfidence = parsed.confidence;
  const rawReason = parsed.reason;

  return {
    is_passenger_request: isPassengerRequest,
    confidence: clampConfidence(Number(rawConfidence ?? 0)),
    reason: typeof rawReason === "string" ? rawReason.slice(0, 300) : "AI decision"
  };
}

function containsKeyword(normalizedText: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) {
    return false;
  }

  if (normalizedKeyword.length <= 2) {
    const boundaryPattern = new RegExp(`(^|\\s|[.,!?;:()\\[\\]{}])${escapeRegExp(normalizedKeyword)}($|\\s|[.,!?;:()\\[\\]{}])`, "iu");
    return boundaryPattern.test(normalizedText);
  }

  return normalizedText.includes(normalizedKeyword);
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

export async function classifyWithGroq(text: string): Promise<AIResult> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const payload = {
    model: env.GROQ_MODEL,
    temperature: 0,
    max_tokens: 180,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Message:\n${text}` }
    ]
  };

  const response = (await requestJson("groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = response.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Groq response content is empty");
  }

  return parseAIResult(content);
}

export async function classifyWithGemini(text: string): Promise<AIResult> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\nMessage:\n${text}` }]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json"
    }
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = (await requestJson("gemini", endpoint, {
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

export async function classifyWithOpenRouter(text: string): Promise<AIResult> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const payload = {
    model: env.OPENROUTER_MODEL,
    temperature: 0,
    max_tokens: 180,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Message:\n${text}` }
    ]
  };

  const response = (await requestJson("openrouter", "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = response.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter response content is empty");
  }

  return parseAIResult(content);
}

function toProviderSnapshot(providerName: AIProviderName): ProviderStatusSnapshot {
  refreshProviderState(providerName);
  const provider = providers[providerName];

  return {
    name: provider.name,
    status: provider.status,
    disabledUntil: provider.disabledUntil,
    keyConfigured: Boolean(provider.apiKey),
    reason: provider.reason
  };
}

export function getProviderStatusSnapshot(): ProviderStatusSnapshot[] {
  return PROVIDER_PRIORITY.map((providerName) => toProviderSnapshot(providerName));
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
  for (const providerName of PROVIDER_PRIORITY) {
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
  if (providerName === "groq") {
    return classifyWithGroq(text);
  }

  if (providerName === "gemini") {
    return classifyWithGemini(text);
  }

  return classifyWithOpenRouter(text);
}

export async function classifyMessage(text: string): Promise<MessageClassification> {
  const normalizedText = normalizeText(text);

  for (const providerName of PROVIDER_PRIORITY) {
    if (!isProviderConfigured(providerName)) {
      continue;
    }

    if (!isProviderAvailable(providerName)) {
      continue;
    }

    try {
      logger.info({ provider: providerName }, "Classifier provider selected");
      const aiResult = await classifyWithProvider(providerName, text);

      return {
        is_passenger_request: aiResult.is_passenger_request,
        confidence: clampConfidence(aiResult.confidence),
        reason: aiResult.reason,
        provider: providerName,
        normalizedText,
        providerStatuses: getProviderStatusSnapshot()
      };
    } catch (error) {
      if (isRateLimitError(error) || isTemporaryError(error)) {
        disableProvider(providerName, cooldownMsFromError(error), getErrorSummary(error));
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

  const fallback = keywordClassify(text);

  return {
    is_passenger_request: fallback.is_passenger_request,
    confidence: fallback.confidence,
    reason: fallback.reason,
    provider: "keyword",
    normalizedText,
    keywordScore: fallback.score,
    providerStatuses: getProviderStatusSnapshot()
  };
}

export async function classifyLead(rawText: string): Promise<LeadClassification> {
  const result = await classifyMessage(rawText);

  return {
    isLead: result.is_passenger_request,
    isSpam: !result.is_passenger_request && result.reason.includes("spam="),
    score: result.keywordScore ?? Math.round(result.confidence * 10),
    normalizedText: result.normalizedText,
    matchedKeywords: [],
    matchedPatterns: [],
    route: detectRoute(rawText)
  };
}
