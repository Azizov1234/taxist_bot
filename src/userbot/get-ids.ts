import { getPeerId } from "telegram/Utils.js";
import { createAndConnectUserbotClient } from "./gramjs.client.js";

function getTitle(entity: any): string {
  if (!entity) {
    return "Noma'lum";
  }

  if (typeof entity.title === "string" && entity.title.trim().length > 0) {
    return entity.title.trim();
  }

  const firstName = typeof entity.firstName === "string" ? entity.firstName : typeof entity.first_name === "string" ? entity.first_name : "";
  const lastName = typeof entity.lastName === "string" ? entity.lastName : typeof entity.last_name === "string" ? entity.last_name : "";
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

  if (fullName.length > 0) {
    return fullName;
  }

  return "Noma'lum";
}

export async function printDialogsWithIds(): Promise<void> {
  const client = await createAndConnectUserbotClient();

  try {
    const dialogs = await client.getDialogs({ limit: 500 });

    console.log("Chat title => chat id");
    for (const dialog of dialogs) {
      const entity = (dialog as any).entity;
      if (!entity) {
        continue;
      }

      const title = getTitle(entity);
      const chatId = getPeerId(entity, true);
      console.log(`${title} => ${chatId}`);
    }
  } finally {
    await client.disconnect();
  }
}
