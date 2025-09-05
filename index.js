require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---- Supabase Setup ----
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ---- country aliases ----
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

// ---- CSV storage ----
const leadsFile = path.join(__dirname, 'leads.csv');
if (!fs.existsSync(leadsFile)) {
  fs.writeFileSync(leadsFile, `"Username","Country","Phone","Email"\n`, 'utf8');
}

async function saveLead(username, country, phone, email) {
  // Save locally
  const line = `"${username}","${country}","${phone}","${email}"\n`;
  fs.appendFileSync(leadsFile, line, 'utf8');

  // Save in Supabase
  const { error } = await supabase
    .from('leads')
    .insert([{ username, country, phone, email }]);

  if (error) {
    console.error("❌ Supabase insert failed:", error.message);
  } else {
    console.log(`✅ Lead saved to Supabase: ${username}`);
  }
}

function isUserRegistered(username) {
  const data = fs.readFileSync(leadsFile, 'utf8');
  const lines = data.split(/\r?\n/).slice(1); // skip header
  return lines.some(l => l.startsWith(`"${username}",`));
}

// ---- validation helpers ----
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

// ---- asking utilities ----
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

// ---- check membership ----
async function checkMembership(userId) {
  try {
    const member = await bot.getChatMember(process.env.CHANNEL_ID, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    return false;
  }
}

// ---- onboarding flow ----
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || 'NoUsername';
  const firstName = msg.from.first_name || 'Friend';
  const alreadyRegistered = isUserRegistered(username);

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

  // Send welcome image + text
  await bot.sendPhoto(
    chatId,
    "https://drive.google.com/uc?export=download&id=1Ovi1U2juiE7tO_3DREBiPXdNrWnp9tS2",
    {
      caption: `🎉 *Welcome to Bullman Capital*, ${firstName}!\n\n🚀 Unlock consistent profits with our exclusive *trading course*, premium *indicator*, and *private traders’ community*.\n\nLet's get you onboard. I’ll just collect a couple of details.`,
      parse_mode: 'Markdown'
    }
  );

  // Ask country
  const countryRaw = await askUntilValid(
    chatId, userId,
    "🌍 What country are you from? (full name or abbreviation like *USA*, *UK*, *UAE*)",
    (t) => t.length >= 2,
    "❌ Please type a valid country (e.g., *USA*, *United States*, *UK*)."
  );
  const country = normalizeCountry(countryRaw);

  // Ask phone
  const phone = await askUntilValid(
    chatId, userId,
    "📱 Please share your working phone number **with country code** (e.g., +15551234567):",
    isValidPhone,
    "❌ That doesn't look right. Use digits only, 7–15 long, optional leading '+'. Try again:"
  );

  // Ask email
  const email = await askUntilValid(
    chatId, userId,
    "📧 Finally, what's your best email?",
    isValidEmail,
    "❌ That email format looks off. Example: name@example.com — try again:"
  );

  // Save and send invite
  await saveLead(username, country, phone, email);

  await bot.sendPhoto(
    chatId,
    "https://drive.google.com/uc?export=download&id=1tapl-WVZGAtftaRS84ydH8onj2phqqUd",
    {
      caption: `✅ All set, ${firstName}! 🥳\n\nHere’s your exclusive invitation to join **Bullman Capital**:\n👉 https://t.me/+v9b6L5hz7oJjMTNl\n\nWelcome aboard! 🎯`,
      parse_mode: 'Markdown'
    }
  );
});

// ---- handle all other messages from registered users ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || 'NoUsername';
  const firstName = msg.from.first_name || 'Friend';

  if (msg.text && msg.text.toLowerCase().startsWith('/start')) return;

  if (isUserRegistered(username)) {
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
    } else {
      bot.sendPhoto(
        chatId,
        "https://drive.google.com/uc?export=download&id=1tapl-WVZGAtftaRS84ydH8onj2phqqUd",
        {
          caption: `👋 **Hi ${firstName}**, you are registered but not a member of **Bullman Capital** yet.\n\n🚀 Please join here to access our community:\n👉 https://t.me/+v9b6L5hz7oJjMTNl`,
          parse_mode: 'Markdown'
        }
      );
    }
  }
});
