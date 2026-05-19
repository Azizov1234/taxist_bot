import type { Api, RawApi } from "grammy";
import { env } from "../config/env.js";

export interface ChatAccessCheck {
  chatId: number;
  ok: boolean;
  title?: string | undefined;
  type?: string | undefined;
  membershipStatus?: string | undefined;
  error?: string | undefined;
}

async function checkSingleChat(api: Api<RawApi>, chatId: number): Promise<ChatAccessCheck> {
  try {
    const me = await api.getMe();
    const chat = await api.getChat(chatId);
    const member = await api.getChatMember(chatId, me.id);

    const base: ChatAccessCheck = {
      chatId,
      ok: true
    };

    if ("title" in chat) {
      base.title = chat.title;
    }

    base.type = chat.type;
    base.membershipStatus = member.status;

    return base;
  } catch (error) {
    return {
      chatId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function checkConfiguredChats(api: Api<RawApi>): Promise<{ passenger: ChatAccessCheck; driver: ChatAccessCheck }> {
  const [passenger, driver] = await Promise.all([
    checkSingleChat(api, env.PASSENGER_GROUP_ID),
    checkSingleChat(api, env.DRIVER_GROUP_OR_CHANNEL_ID)
  ]);

  return { passenger, driver };
}
