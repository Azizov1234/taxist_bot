import type { DriverSendResult, UnifiedIncomingMessage } from "./lead.service.js";
import { writeInfo, writeWarn } from "./logger.service.js";
import { sendTelegramBotMessage } from "./telegramBotApi.service.js";
import { extractPhone } from "../utils/phone.js";

export interface DriverLeadDeliveryParams {
  payload: UnifiedIncomingMessage;
  driverChatId: number;
  formattedText: string;
  originalText: string;
}

interface PassengerContactCandidate {
  type: "username" | "phone" | "sender_id";
  url: string;
}

function getTelegramPhoneDigits(text: string): string | null {
  const phone = extractPhone(text);
  if (!phone) {
    return null;
  }

  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) {
    return digits;
  }

  return null;
}

function addUniqueContactCandidate(
  candidates: PassengerContactCandidate[],
  candidate: PassengerContactCandidate | null
): void {
  if (!candidate || candidates.some((item) => item.url === candidate.url)) {
    return;
  }

  candidates.push(candidate);
}

function buildPassengerContactCandidates(payload: UnifiedIncomingMessage, originalText: string): PassengerContactCandidate[] {
  const candidates: PassengerContactCandidate[] = [];
  const username = payload.senderUsername?.trim().replace(/^@/, "");
  if (username) {
    addUniqueContactCandidate(candidates, {
      type: "username",
      url: `https://t.me/${username}`
    });
  }

  const phoneDigits = getTelegramPhoneDigits(originalText);
  if (phoneDigits) {
    addUniqueContactCandidate(candidates, {
      type: "phone",
      url: `tg://resolve?phone=${phoneDigits}`
    });
  }

  const senderId = Number(payload.senderId);
  if (Number.isInteger(senderId) && senderId > 0) {
    addUniqueContactCandidate(candidates, {
      type: "sender_id",
      url: `tg://user?id=${senderId}`
    });
  }

  return candidates;
}

function buildPassengerContactReplyMarkup(candidate: PassengerContactCandidate): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        {
          text: "\u{1F695} MIJOZGA YOZISH",
          url: candidate.url
        }
      ]
    ]
  };
}

function isPassengerContactButtonError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("BUTTON_USER_INVALID") ||
    error.message.includes("BUTTON_URL_INVALID") ||
    error.message.includes("BUTTON_TYPE_INVALID") ||
    error.message.includes("unsupported URL protocol")
  );
}

export async function sendDriverLeadViaBotBridge(params: DriverLeadDeliveryParams): Promise<DriverSendResult> {
  const contactCandidates = buildPassengerContactCandidates(params.payload, params.originalText);
  let sent: Awaited<ReturnType<typeof sendTelegramBotMessage>> = null;

  for (const contactCandidate of contactCandidates) {
    try {
      sent = await sendTelegramBotMessage(params.driverChatId, params.formattedText, {
        replyMarkup: buildPassengerContactReplyMarkup(contactCandidate)
      });
      break;
    } catch (error) {
      if (!isPassengerContactButtonError(error)) {
        throw error;
      }

      await writeWarn("Passenger contact button candidate invalid, trying next fallback", {
        sourceChatId: params.payload.sourceChatId,
        sourceRegion: params.payload.sourceRegion ?? null,
        sourceMessageId: params.payload.sourceMessageId,
        senderId: params.payload.senderId,
        senderUsername: params.payload.senderUsername ?? null,
        contactType: contactCandidate.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (!sent) {
    if (contactCandidates.length > 0) {
      await writeWarn("Passenger contact buttons invalid, retrying driver lead without button", {
        sourceChatId: params.payload.sourceChatId,
        sourceRegion: params.payload.sourceRegion ?? null,
        sourceMessageId: params.payload.sourceMessageId,
        senderId: params.payload.senderId,
        senderUsername: params.payload.senderUsername ?? null,
        triedContactTypes: contactCandidates.map((candidate) => candidate.type)
      });
    }

    sent = await sendTelegramBotMessage(params.driverChatId, params.formattedText);
  }

  if (!sent) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for bot driver delivery");
  }

  await writeInfo("Driver lead delivered via Bot API bridge", {
    sourceChatId: params.payload.sourceChatId,
    sourceRegion: params.payload.sourceRegion ?? null,
    sourceMessageId: params.payload.sourceMessageId,
    driverChatId: params.driverChatId,
    driverMessageId: sent.messageId,
    originalTextLength: params.originalText.length,
    contactCandidateTypes: contactCandidates.map((candidate) => candidate.type)
  });

  return {
    driverMessageId: sent.messageId,
    forwardedOriginal: true,
    forwardedContactVisible: false
  };
}
