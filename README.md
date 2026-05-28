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
- `AI_PROVIDER_ORDER` orqali provider tartibini istalgan payt o'zgartirish mumkin.

## ENV namunasi
Asosiy maydonlar `.env.example` ichida tayyor.
- Tavsiya etiladi: region bo'yicha ajratish
- `PASSENGER_CHAT_IDS_TASHKENT`, `PASSENGER_CHAT_IDS_GULISTON`
- `DRIVER_CHAT_ID_TASHKENT`, `DRIVER_CHAT_ID_GULISTON`
- Legacy fallback ham bor: `PASSENGER_CHAT_IDS`, `DRIVER_CHAT_ID`
- `PASSENGER_HELP_GROUP_LINK` (ixtiyoriy): username/telefon bo'lmasa yo'lovchiga lichkada yuboriladigan yordamchi guruh havolasi.
- `DRIVER_PREMIUM_GROUP_LINK` (ixtiyoriy): haydovchi pullik guruhiga qo'shilish havolasi. Driver reklama xabari bloklanganda guruh va lichkaga shu link yuboriladi.

## Scriptlar
- `npm run dev` - default userbot (`src/main.ts`)
- `npm run build` - TypeScript build
- `npm run start` - `dist/main.js` ishga tushirish
- `npm run server:deploy` - serverda `pull + install + prisma + build + restart`
- `npm run get:ids` - dialoglar ro'yxati (`chat title => chat id`)
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:deploy`

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
5. Passenger source chatlar parse (`TASHKENT/GULISTON` bo'yicha)
6. Source chatlardan yangi xabarlarni tinglash
7. Text/caption bo'lmasa skip
8. Duplicate tekshirish
9. Normalize
10. Rule-based analyzer
11. AI analyzer (provider fallback)
12. AI xato bo'lsa rule-based fallback
13. Lead bo'lsa source regioniga mos driver chatga formatlangan yuborish
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

## Admin commandlar (faqat `ADMIN_TELEGRAM_ID`)
Userbot commandlari:
- `.status`
- `.stats`
- `.test <text>`
- `.sources`
- `.pause`
- `.resume`
- `.last 10`

Legacy grammY `/` commandlari ham kodda saqlangan.

## Serverga pull va ishga tushirish
1. Serverda loyihaga kiring: `cd /path/to/taxi-bot`
2. `.env` yarating: `cp .env.example .env`
3. `.env` ichida shu maydonlarni to'ldiring:
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`
   - `TELEGRAM_STRING_SESSION`
   - `PASSENGER_CHAT_IDS_TASHKENT`
   - `PASSENGER_CHAT_IDS_GULISTON`
   - `DRIVER_CHAT_ID_TASHKENT`
   - `DRIVER_CHAT_ID_GULISTON`
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
