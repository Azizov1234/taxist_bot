# Taxi Userbot (Node.js + TypeScript + GramJS + Prisma)

Bu loyiha eski grammY bot kodini saqlagan holda userbot rejimini default qiladi.

## Texnologiya
- Node.js + TypeScript
- GramJS (`telegram`)
- Legacy mode uchun grammY (o'chirilmagan)
- PostgreSQL + Prisma
- dotenv + zod env validation
- pino logger + `BotLog` jadvali

## Tez Boshlash
1. `my.telegram.org` ga kiring va `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` oling.
2. `.env.example` dan `.env` yarating.
3. `npm install`.
4. `npx prisma generate`.
5. `npx prisma migrate dev`.
6. `npm run dev`.
7. Birinchi login paytida telefon raqam, Telegram code, 2FA password kiriting.
8. Konsolda chiqqan `TELEGRAM_STRING_SESSION` ni `.env` ga yozing.
9. `npm run get:ids` orqali chat IDlarni oling.
10. Userbot source guruhda admin bo'lsa xabar o'chira oladi, admin bo'lmasa o'chirmaydi.
11. `.env`, `TELEGRAM_STRING_SESSION`, `TELEGRAM_API_HASH` ni hech kimga bermang.

## Muhim
- `TELEGRAM_API_ID` va `TELEGRAM_API_HASH` BotFather'dan emas, faqat `my.telegram.org` dan olinadi.
- `.env` va session ma'lumotlarini GitHubga push qilmang.
- API keylar faqat `.env` ichida bo'lsin, kodga yozilmang.
- API key/token/session/hash qiymatlari logga chiqmasligi kerak.
- Agar API key skrinshot/chat/GitHub'da ko'rinib qolsa, darhol regenerate qiling.
- AI default o'chiq (`AI_ENABLED=false`); kerak bo'lsa keylarni qo'shib, provider tartibini `AI_PROVIDER_ORDER` bilan sozlang.

## ENV namunasi
Asosiy maydonlar `.env.example` ichida tayyor.
- Tavsiya etiladi: region bo'yicha ajratish
- `PASSENGER_CHAT_IDS_TASHKENT`, `PASSENGER_CHAT_IDS_GULISTON`, `PASSENGER_CHAT_IDS_KOMSOMOL`
- Public username/link source'lar uchun: `PASSENGER_CHAT_USERNAMES_TASHKENT`, `PASSENGER_CHAT_USERNAMES_GULISTON`, `PASSENGER_CHAT_USERNAMES_KOMSOMOL`
- `DRIVER_CHAT_ID_TASHKENT`, `DRIVER_CHAT_ID_GULISTON`, `DRIVER_CHAT_ID_KOMSOMOL`
- Legacy fallback ham bor: `SOURCE_CHAT_IDS`, `PASSENGER_CHAT_IDS`, `DRIVER_CHAT_ID`
- `PASSENGER_HELP_GROUP_LINK` (ixtiyoriy): username/telefon bo'lmasa yo'lovchiga lichkada yuboriladigan yordamchi guruh havolasi.
- `DRIVER_PREMIUM_GROUP_LINK` (ixtiyoriy): haydovchi pullik guruhiga qo'shilish havolasi. Driver reklama xabari bloklanganda guruh va lichkaga shu link yuboriladi.
- `TELEGRAM_BOT_TOKEN` (ixtiyoriy): userbot mode'da admin command javoblarini va driver kanal postlarini oddiy bot nomidan yuborish uchun.
- `ADMIN_COMMAND_REPLY_MODE=bot|userbot|off` (default: `bot`): admin command javob transporti.
- `DRIVER_DELIVERY_MODE=auto|bot|userbot` (default: `auto`): `auto` token bo'lsa oddiy bot orqali, token bo'lmasa eski userbot transporti orqali yuboradi. Userbot driver kanalga umuman yozmasin desangiz `bot` qiling va `TELEGRAM_BOT_TOKEN`ni to'ldiring.

## Runtime Sozlamalar
- Admin paneldan qo'shilgan yo'lovchi guruhlari, haydovchi guruhlari va yoqish/o'chirish sozlamalari `.env` faylga ham, `RuntimeConfig` DB jadvaliga ham yoziladi.
- Adminlar alohida `AdminUser` DB jadvalida saqlanadi. `.env`dagi `ADMIN_TELEGRAM_ID`/`ADMIN_TELEGRAM_IDS` start paytida `SUPERADMIN` sifatida bir marta upsert qilinadi.
- `/addadmin @username` yoki `/addadmin 123456789` yangi admin qo'shadi; username bilan qo'shilsa bot IDni aniqlay olsa `telegramId`ni ham saqlaydi.
- Bot start paytida avval `.env` o'qiladi, keyin DBdagi `RuntimeConfig` qiymatlari qo'shiladi.
- Public guruh username/link bilan qo'shilsa, userbot guruhni ko'rgan paytda chat IDni orqa fonda aniqlab, `.env` va DBga saqlaydi.
- `PASSENGER_GROUP_AUTO_REPLIES=false` va `USERBOT_READ_ONLY=true` holatda userbot passenger guruhlarga yozmaydi.

## Scriptlar
- `npm run dev` - default userbot (`src/main.ts`)
- `npm run build` - TypeScript build
- `npm run start` - `dist/main.js` ishga tushirish
- `npm run server:deploy` - serverda `pull + install + prisma + build + restart`
- `npm run get:ids` - dialoglar ro'yxati (`chat title => chat id`)
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:deploy`
- `npm run seed:dk:v2` - Dehqonobod/Kamsamol V2 keywordlarni `KeywordDictionary`ga upsert qilish
- `npm run keyword:v2:stats` - V2 keyword count va classification checklarni ko'rish

## Ishlash Rejimlari
- Default: userbot mode (`TELEGRAM_MODE` bo'sh yoki `userbot`)
- Legacy: eski grammY botni ishlatish uchun `.env` ga:
  - `TELEGRAM_MODE=legacy`
  - `TELEGRAM_BOT_TOKEN=...`

## Asosiy Flow
1. App start
2. ENV validation
3. Prisma connect
4. GramJS userbot connect
5. Passenger source chatlar parse (`TASHKENT/GULISTON/KOMSOMOL` bo'yicha)
6. Source chatlardan yangi xabarlarni tinglash
7. Text/caption bo'lmasa skip
8. Duplicate tekshirish
9. Normalize
10. Rule-based analyzer
11. AI analyzer (provider fallback)
12. AI xato bo'lsa rule-based fallback
13. Lead bo'lsa source regioniga mos driver chatga `DRIVER_DELIVERY_MODE` bo'yicha yuborish (`bot` mode'da oddiy Bot API bot post qiladi)
14. `DELETE_SOURCE_MESSAGE_IF_ADMIN=true` bo'lsa source xabarni o'chirishga urinish
15. `DELETE_IGNORED_MESSAGE_IF_ADMIN=true` bo'lsa `IGNORED` (noise/spam/reklama) xabarlarni ham source'dan o'chirishga urinish
16. `SEND_PRIVATE_ACK_TO_PASSENGER=true` bo'lsa xabar egasining lichkasiga tasdiq xabari yuborish
17. `LISTENER_BACKFILL_SECONDS` orqali restartdan oldingi so'nggi xabarlarni ham ushlash (default: 180s)
18. `LISTENER_STARTUP_BACKFILL_LIMIT` orqali app ishga tushganda har source chatdan oxirgi N ta xabarni qayta tekshirish (default: 20)
19. `STARTUP_BACKFILL_DELETE_SOURCE=false` bo'lsa startup backfill paytida source xabarlar o'chirilmaydi (faqat tekshiriladi/yuboriladi)
20. Permission bo'lmasa crash qilmasdan log yozish
21. Lead statusni DB ga yozish

## Server barqarorlik sozlamalari
- `TELEGRAM_USE_WSS=true` — Telegram bilan 443 orqali ulanish (ko'p serverlarda 80 ga nisbatan barqarorroq).
- `TELEGRAM_CONNECTION_RETRIES=-1` — ulanish xatolarida cheksiz retry.
- `TELEGRAM_RECONNECT_RETRIES=-1` — reconnect cheksiz.
- `TELEGRAM_RETRY_DELAY_MS=2000` — reconnect oralig'i.
- `TELEGRAM_STARTUP_CONNECT_MAX_ATTEMPTS=0` — startup connect cheksiz urinadi (`0` = infinite).
- `TELEGRAM_STARTUP_CONNECT_RETRY_MS=5000` — startup retry oralig'i.
- `LISTENER_PERIODIC_CATCH_UP_ENABLED=true` — live event uzilib-qaytsa ham so'nggi xabarlarni periodik tekshiradi.
- `USERBOT_HEARTBEAT_INTERVAL_MS=60000` — userbot Telegram ulanishini tekshiradi; ketma-ket xato ko'paysa process supervisor restart qilishi uchun chiqadi.
- `AUTH_KEY_DUPLICATED` logda ko'rinsa, bir xil `TELEGRAM_STRING_SESSION` ikki joyda ishlayapti. Yangi session oling va faqat bitta instance qoldiring.

## Admin commandlar (DB adminlar)
Userbot listener commandlari. Javoblar default oddiy Bot API orqali yuboriladi (`TELEGRAM_BOT_TOKEN` + `ADMIN_COMMAND_REPLY_MODE=bot`).
- `.` yakka holda javob qaytarmaydi
- `.help`
- `.status`
- `.stats`
- `.test <text>`
- `.sources`
- `.pause`
- `.resume`
- `.last 10`

Legacy grammY `/` commandlari ham kodda saqlangan.

## Userbot + Oddiy Bot Bridge
`TELEGRAM_MODE=userbot` qoladi: userbot passenger/source guruhlarni kuzatadi, klassifikatsiya qiladi va lead payloadni ichki bridge servisiga beradi.

Driver kanalga kim post qilishini `DRIVER_DELIVERY_MODE` belgilaydi:
- `bot`: faqat oddiy Telegram bot (`TELEGRAM_BOT_TOKEN`) driver kanalga yuboradi.
- `userbot`: eski GramJS userbot transporti.
- `auto`: token bo'lsa `bot`, token bo'lmasa `userbot`.

## Serverga pull va ishga tushirish
1. Serverda loyihaga kiring: `cd /path/to/taxi-bot`
2. `.env` yarating: `cp .env.example .env`
3. `.env` ichida shu maydonlarni to'ldiring:
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`
   - `TELEGRAM_STRING_SESSION`
   - `PASSENGER_CHAT_IDS_TASHKENT`
   - `PASSENGER_CHAT_IDS_GULISTON`
   - `PASSENGER_CHAT_IDS_KOMSOMOL`
   - `PASSENGER_CHAT_USERNAMES_KOMSOMOL` (public link/username source'lar bo'lsa)
   - `DRIVER_CHAT_ID_TASHKENT`
   - `DRIVER_CHAT_ID_GULISTON`
   - `DRIVER_CHAT_ID_KOMSOMOL`
   - `ADMIN_TELEGRAM_ID`
   - `DATABASE_URL`
4. Deploy qiling: `npm run server:deploy`

Qo'lda deploy qilish kerak bo'lsa:
1. `git pull --ff-only origin main`
2. `npm ci`
3. `npx prisma generate`
4. `npx prisma migrate deploy`
5. `npm run build`
6. `npm run start`
