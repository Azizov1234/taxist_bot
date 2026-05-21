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

## Scriptlar
- `npm run dev` - default userbot (`src/main.ts`)
- `npm run build` - TypeScript build
- `npm run start` - `dist/main.js` ishga tushirish
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
5. `PASSENGER_CHAT_IDS` parse
6. Source chatlardan yangi xabarlarni tinglash
7. Text/caption bo'lmasa skip
8. Duplicate tekshirish
9. Normalize
10. Rule-based analyzer
11. AI analyzer (provider fallback)
12. AI xato bo'lsa rule-based fallback
13. Lead bo'lsa driver chatga formatlangan yuborish
14. `DELETE_SOURCE_MESSAGE_IF_ADMIN=true` bo'lsa source xabarni o'chirishga urinish
15. Permission bo'lmasa crash qilmasdan log yozish
16. Lead statusni DB ga yozish

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
