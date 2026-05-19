# Taxi Lead Bot (Node.js + TypeScript + grammY + Prisma)

Production-ready Telegram bot: yo'lovchilar guruhidagi taxi/yolovchi so'rovlarini aniqlaydi va haydovchilar chatiga yuboradi.

## Texnologiya
- Node.js + TypeScript
- grammY
- PostgreSQL + Prisma
- dotenv + zod env validation
- Logging: pino + `BotLog` jadvali

## Papkalar
- `src/bot/` - bot command va handlerlar
- `src/services/` - biznes logika (lead, keyword, logger)
- `src/config/` - env va default keywordlar
- `src/utils/` - normalize, phone, route util funksiyalar
- `src/prisma/` - prisma client
- `prisma/` - schema va seed

## ENV
`.env` ochib quyidagini to'ldiring:

```env
BOT_TOKEN=
PASSENGER_GROUP_ID=-100...
DRIVER_GROUP_OR_CHANNEL_ID=-100...
ADMIN_TELEGRAM_ID=
LOG_CHANNEL_ID=
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/taxi_bot?schema=public"
```

`LOG_CHANNEL_ID` ixtiyoriy.

## 1) BotFather'dan token olish
1. Telegram'da `@BotFather` ga kiring.
2. `/newbot` bosing.
3. Bot nomi va username bering.
4. Berilgan tokenni `BOT_TOKEN`ga yozing.

## 2) /setprivacy -> Disable qilish
1. `@BotFather` -> `/setprivacy`
2. Botni tanlang.
3. `Disable` qiling.

Bu bot guruhdagi oddiy xabarlarni ham ko'rishi uchun kerak.

## 3) Botni yo'lovchilar guruhiga admin qilish
- Bot `PASSENGER_GROUP_ID` guruhida bo'lishi kerak.
- Xabarlarni o'qish imkoniga ega bo'lsin.

## 4) Botni haydovchilar kanal/guruhiga admin qilish
- Bot `DRIVER_GROUP_OR_CHANNEL_ID` chatiga xabar yubora olishi kerak.
- Kanal bo'lsa, post qilish huquqi bo'lsin.

## 5) Group/Channel ID olish
Variantlar:
1. Botga `/getid` yuborib chat IDni oling (admin uchun).
2. `@userinfobot` yoki shunga o'xshash botlardan ID olish.

Eslatma: group/channel ID odatda `-100...` formatida bo'ladi.

## 6) .env to'ldirish
`.env.example` ni `.env` ga nusxa qilib barcha qiymatlarni kiriting.

## 7) npm install
```bash
npm install
```

## 8) Prisma migrate
```bash
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
```

## 9) Development run
```bash
npm run dev
```

## 10) Production deploy
1. Serverga Node.js 20+ va PostgreSQL tayyorlang.
2. Kodni serverga chiqaring.
3. `.env` ni to'ldiring.
4. Quyidagini ishga tushiring:

```bash
npm ci
npm run build
npx prisma migrate deploy
npm run db:seed
npm start
```

5. PM2 yoki systemd bilan processni doimiy qiling.

PM2 misol:
```bash
npm i -g pm2
pm2 start dist/index.js --name taxi-lead-bot
pm2 save
pm2 startup
```

## Admin buyruqlari
- `/start` - bot ishlayotganini ko'rsatadi
- `/status` - umumiy status
- `/stats` - kunlik/haftalik statistika
- `/keywords` - active keywordlar
- `/addkeyword taxi_soz` - keyword qo'shish
- `/removekeyword taxi_soz` - keywordni inactive qilish
- `/test matn` - lead aniqlash testi
- `/getid` - chat va user ID

Faqat `ADMIN_TELEGRAM_ID` foydalanuvchi bu buyruqlarni ishlata oladi.

## Lead aniqlash logikasi
- Faqat `PASSENGER_GROUP_ID` ichidagi xabarlar analiz qilinadi.
- Matn normalize qilinadi (`o'`, `o‘`, `oʻ` -> `o`; `g'`, `g‘`, `gʻ` -> `g`).
- Latin/kiril keywordlar bo'yicha tekshiradi.
- Pattern asosida ham aniqlaydi (`...dan ...ga`, `...ga ketish kerak`, `joy bormi` va boshqalar).
- Telefon raqamlarni ajratadi va formatlaydi (`+998 90 123 45 67`).
- Route topishga harakat qiladi.
- Duplicate xabarlarni qayta yubormaydi.
- Spam/reklama xabarlarni filter qiladi.

## Muhim cheklov
Bot foydalanuvchining yashirin telefon raqamini Telegram'dan ola olmaydi. Faqat xabar ichida yozilgan raqamni ajratadi.

## Eslatma
Docker bu loyihada majburiy emas va qo'shilmagan.
