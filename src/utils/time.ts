export function formatMessageDate(date: Date): string {
  return new Intl.DateTimeFormat("uz-UZ", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Tashkent"
  }).format(date);
}
