require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// ---- Supabase Setup ----
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---- Telegram Bot Setup ----
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ---- Country Aliases ----
const countriesMap = {
  'united states': 'United States',
  'usa': 'United States',
  'u.s.a': 'United States',
  'us': 'United States',
  'u.s': 'United States',

  'united kingdom': 'United Kingdom',
  'uk': 'United Kingdom',
  'u.k': 'United Kingdom',
  'great britain': 'United Kingdom',
  'england': 'United Kingdom',

  'uae': 'United Arab Emirates',
  'u.a.e': 'United Arab Emirates',
  'united arab emirates': 'United Arab Emirates',

  'india': 'India',
  'canada': 'Canada',
  'australia': 'Australia',
  'germany': 'Germany',
  'france': 'France',
  'italy': 'Italy',
  'spain': 'Spain',
  'brazil': 'Brazil'
};

// ---- Supabase Save Lead ----
async function saveLead(username, country, phone, email) {
  const { error } = await supabase
    .from('leads')
    .insert([{ username, country, phone, email }]); // created_at auto

  if (error) {
    console.error("❌ Supabase insert failed:", error.message);
  } else {
    console.log(`✅ Lead saved to Supabase: ${username}`);
  }
}

// ---- Check if User Exists in Supabase ----
async function isUserRegistered(username) {
  const { data, error } = await supabase
    .from('leads')
    .select('username')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    console.error("❌ Supabase check failed:", error.message);
    return false;
  }
  return !!data;
}

// ---- Validation Helpers ----
const isValidPhone = (p) => /^\+?\d{7,15}$/.test(p.trim());
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function normalizeCountry(input) {
  const s = input.trim().toLowerCase();
  const exact = countriesMap[s];
  if (exact) return exact;

  const key = Object.keys(countriesMap).find(
    k => k.includes(s) || s.includes(k)
  );
  return key ? countriesMap[key] : input.trim();
}

// ---- Ask Utilities ----
function ask(chatId, userId, prompt) {
  return new Promise((resolve) => {
    bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown' }).then(() => {
      const handler = (msg) => {
        if (msg.chat.id !== chatId || msg.from.id !== userId) return;
        bot.removeListener('message', handler);
        resolve((msg.text || '').trim());
      };
      bot.on('message', handler);
    });
  });
}

async function askUntilValid(chatId, userId, prompt, validate, errorMsg) {
  while (true) {
    const answer = await ask(chatId, userId, prompt);
    if (!validate || validate(answer)) return answer;
    await bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
  }
}

// ---- Check Membership ----
async function checkMembership(userId) {
  try {
    const member = await bot.getChatMember(process.env.CHANNEL_ID, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

// ---- /start Command ----
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || 'NoUsername';
  const firstName = msg.from.first_name || 'Friend';
  const alreadyRegistered = await isUserRegistered(username);

  if (alreadyRegistered) {
    const isMember = await checkMembership(userId);
    if (isMember) {
      await bot.sendPhoto(
        chatId,
        "https://drive.google.com/uc?export=download&id=1Le3p2FU77iywbdWujZnsgUoDkbk31ftf",
        {
          caption: `✅ **Hi ${firstName}**, you are already registered and part of **Bullman Capital**.\n\n💬 Please contact our support team: **@Rocky05250**`,
          parse_mode: 'Markdown'
        }
      );
    } else {
      await bot.sendPhoto(
        chatId,
        "https://drive.google.com/uc?export=download&id=1tapl-WVZGAtftaRS84ydH8onj2phqqUd",
        {
          caption: `👋 **Hi ${firstName}**, you are registered but not a member of **Bullman Capital** yet.\n\n🚀 Please join here to access our community:\n👉 https://t.me/+v9b6L5hz7oJjMTNl`,
          parse_mode: 'Markdown'
        }
      );
    }
    return;
  }

  // Send Welcome Image
  await bot.sendPhoto(
    chatId,
    "https://drive.google.com/uc?export=download&id=1Ovi1U2juiE7tO_3DREBiPXdNrWnp9tS2",
    {
      caption: `🎉 *Welcome to Bullman Capital*, ${firstName}!\n\n🚀 Unlock consistent profits with our exclusive *trading course*, premium *indicator*, and *private traders’ community*.\n\nLet's get you onboard. I’ll just collect a couple of details.`,
      parse_mode: 'Markdown'
    }
  );

  // Ask Country
  const countryRaw = await askUntilValid(
    chatId, userId,
    "🌍 What country are you from? (full name or abbreviation like *USA*, *UK*, *UAE*)",
    (t) => t.length >= 2,
    "❌ Please type a valid country (e.g., *USA*, *United States*, *UK*)."
  );
  const country = normalizeCountry(countryRaw);

  // Ask Phone
  const phone = await askUntilValid(
    chatId, userId,
    "📱 Please share your working phone number **with country code** (e.g., +15551234567):",
    isValidPhone,
    "❌ That doesn't look right. Use digits only, 7–15 long, optional leading '+'. Try again:"
  );

  // Ask Email
  const email = await askUntilValid(
    chatId, userId,
    "📧 Finally, what's your best email?",
    isValidEmail,
    "❌ That email format looks off. Example: name@example.com — try again:"
  );

  // Save to Supabase
  await saveLead(username, country, phone, email);

  // Send Invite
  await bot.sendPhoto(
    chatId,
    "https://drive.google.com/uc?export=download&id=1tapl-WVZGAtftaRS84ydH8onj2phqqUd",
    {
      caption: `✅ All set, ${firstName}! 🥳\n\nHere’s your exclusive invitation to join **Bullman Capital**:\n👉 https://t.me/+v9b6L5hz7oJjMTNl\n\nWelcome aboard! 🎯`,
      parse_mode: 'Markdown'
    }
  );
});

// ---- Handle Other Messages from Registered Users ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || 'NoUsername';
  const firstName = msg.from.first_name || 'Friend';

  if (msg.text && msg.text.toLowerCase().startsWith('/start')) return;

  if (await isUserRegistered(username)) {
    const isMember = await checkMembership(userId);
    if (isMember) {
      bot.sendPhoto(
        chatId,
        "https://drive.google.com/uc?export=download&id=1Le3p2FU77iywbdWujZnsgUoDkbk31ftf",
        {
          caption: `✅ **Hi ${firstName}**, you are already registered and part of **Bullman Capital**.\n\n💬 Please contact our support team: **@Rocky05250**`,
          parse_mode: 'Markdown'
        }
      );
    }
  }
});
