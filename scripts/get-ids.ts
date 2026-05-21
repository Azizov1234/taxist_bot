import { printDialogsWithIds } from "../src/userbot/get-ids.js";

printDialogsWithIds().catch((error) => {
  console.error("get-ids xatosi:", error);
  process.exit(1);
});
