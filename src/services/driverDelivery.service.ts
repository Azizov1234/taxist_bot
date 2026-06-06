import type { DriverSendResult, UnifiedIncomingMessage } from "./lead.service.js";
import { writeInfo } from "./logger.service.js";
import { sendTelegramBotMessage } from "./telegramBotApi.service.js";

export interface DriverLeadDeliveryParams {
  payload: UnifiedIncomingMessage;
  driverChatId: number;
  formattedText: string;
  originalText: string;
}

export async function sendDriverLeadViaBotBridge(params: DriverLeadDeliveryParams): Promise<DriverSendResult> {
  const sent = await sendTelegramBotMessage(params.driverChatId, params.formattedText);
  if (!sent) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for bot driver delivery");
  }

  await writeInfo("Driver lead delivered via Bot API bridge", {
    sourceChatId: params.payload.sourceChatId,
    sourceRegion: params.payload.sourceRegion ?? null,
    sourceMessageId: params.payload.sourceMessageId,
    driverChatId: params.driverChatId,
    driverMessageId: sent.messageId,
    originalTextLength: params.originalText.length
  });

  return {
    driverMessageId: sent.messageId,
    forwardedOriginal: true,
    forwardedContactVisible: false
  };
}
