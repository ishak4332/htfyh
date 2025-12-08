const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { createClient } = require('bedrock-protocol');
const fs = require('fs');
const os = require('os');
const pidusage = require('pidusage');
const path = require('path');

const botToken = process.env.BOT_TOKEN || '8232223825:AAHI9R476holfyAcS5yd6mBkcjGFcgGGB_8';
const ownerId = parseInt(process.env.ADMIN_ID) || 8366132300;
const ADMIN_ID = ownerId;

const requiredChannels = ['GabarGamer', 'muf071', 'muf071', 'modc77'];

const bot = new Telegraf(botToken);

let servers = {};
let users = [];
let clients = {};
let intervals = {};
let spamIntervals = {};
const botCooldowns = new Map();
const userVersions = {};
const userStates = {};
let microsoftAccounts = {};
let admins = [ownerId];

// --- إضافة متغيرات جديدة ---
let playerNotifications = {};
let chatForwarding = {};

// --- ملفات التخزين لأسماء البوتات لكل مستخدم ---
let userBotNames = {}; // سيتم تحميلها من الملف

// --- JSON Database Management ---
const dataDir = path.join(__dirname, 'data');

// إنشاء مجلد data إذا لم يكن موجوداً
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbLocks = new Map();

// Helper function to acquire a lock for a file
async function acquireLock(file) {
    while (dbLocks.get(file)) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    dbLocks.set(file, true);
}

// Helper function to release a lock
function releaseLock(file) {
    dbLocks.delete(file);
}

// Helper function to read a JSON file
async function readDb(file) {
    await acquireLock(file);
    try {
        const filePath = path.join(dataDir, file);
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            if (file === 'users.json') return [];
            if (file === 'servers.json') return [];
            if (file === 'config.json') return {};
            if (file === 'versions.json') return [];
            if (file === 'admins.json') return [ownerId];
            if (file === 'player_notifications.json') return {};
            if (file === 'chat_forwarding.json') return {};
            if (file === 'bot_names.json') return {}; // ملف جديد لأسماء البوتات
            return {};
        }
        if (error.name === 'SyntaxError') {
            const defaults = {
                'users.json': [],
                'servers.json': [],
                'versions.json': [],
                'config.json': {},
                'admins.json': [ownerId],
                'player_notifications.json': {},
                'chat_forwarding.json': {},
                'bot_names.json': {} // ملف جديد
            };
            return defaults[file] || {};
        }
        throw error;
    } finally {
        releaseLock(file);
    }
}

// Helper function to write to a JSON file
async function writeDb(file, data) {
    await acquireLock(file);
    try {
        const filePath = path.join(dataDir, file);
        await fs.promises.writeFile(filePath, JSON.stringify(data, null, 4));
    } finally {
        releaseLock(file);
    }
}

// --- Database Models ---
const Users = {
    find: (query) => readDb('users.json').then(users => users.filter(user => Object.keys(query).every(key => user[key] === query[key]))),
    findOne: (query) => readDb('users.json').then(users => users.find(user => Object.keys(query).every(key => user[key] === query[key]))),
    create: async (user) => {
        const users = await readDb('users.json');
        users.push(user);
        await writeDb('users.json', users);
        return user;
    },
    updateOne: async (query, update) => {
        const users = await readDb('users.json');
        const userIndex = users.findIndex(user => Object.keys(query).every(key => user[key] === query[key]));
        if (userIndex > -1) {
            users[userIndex] = { ...users[userIndex], ...update };
            await writeDb('users.json', users);
        }
        return userIndex > -1;
    }
};

const Servers = {
    find: (query) => readDb('servers.json').then(servers => servers.filter(server => Object.keys(query).every(key => server[key] === query[key]))),
    findOne: (query) => readDb('servers.json').then(servers => servers.find(server => Object.keys(query).every(key => server[key] === query[key]))),
    create: async (server) => {
        const servers = await readDb('servers.json');
        servers.push(server);
        await writeDb('servers.json', servers);
        return server;
    },
    updateOne: async (query, update) => {
        const servers = await readDb('servers.json');
        const serverIndex = servers.findIndex(server => Object.keys(query).every(key => server[key] === query[key]));
        if (serverIndex > -1) {
            servers[serverIndex] = { ...servers[serverIndex], ...update };
            await writeDb('servers.json', servers);
        }
        return serverIndex > -1;
    },
    deleteOne: async (query) => {
        let servers = await readDb('servers.json');
        const initialCount = servers.length;
        servers = servers.filter(server => !Object.keys(query).every(key => server[key] === query[key]));
        await writeDb('servers.json', servers);
        return servers.length < initialCount;
    }
};

const Admins = {
    find: () => readDb('admins.json'),
    add: async (userId) => {
        const admins = await readDb('admins.json');
        if (!admins.includes(userId)) {
            admins.push(userId);
            await writeDb('admins.json', admins);
        }
        return admins;
    },
    remove: async (userId) => {
        let admins = await readDb('admins.json');
        admins = admins.filter(id => id !== userId);
        await writeDb('admins.json', admins);
        return admins;
    },
    isAdmin: async (userId) => {
        const admins = await readDb('admins.json');
        return admins.includes(userId);
    }
};

// --- إدارة أسماء البوتات لكل مستخدم ---
const BotNames = {
    // الحصول على أسماء البوتات للمستخدم
    getForUser: async (userId) => {
        const botNames = await readDb('bot_names.json');
        return botNames[userId] || {
            firstBot: 'muf879',
            secondBot: 'muf880'
        };
    },
    
    // تحديث أسماء البوتات للمستخدم
    updateForUser: async (userId, updates) => {
        const botNames = await readDb('bot_names.json');
        if (!botNames[userId]) {
            botNames[userId] = {
                firstBot: 'muf879',
                secondBot: 'muf880'
            };
        }
        botNames[userId] = { ...botNames[userId], ...updates };
        await writeDb('bot_names.json', botNames);
        return botNames[userId];
    },
    
    // الحصول على اسم البوت الثاني للمستخدم
    getSecondBotName: async (userId) => {
        const botNames = await readDb('bot_names.json');
        return botNames[userId]?.secondBot || 'muf880';
    }
};

// --- Setup and Initial Checks ---
const setupInitialConfig = async () => {
    try {
        const config = await readDb('config.json');
        if (Object.keys(config).length === 0) {
            await writeDb('config.json', { botOnline: true });
        }
        
        // تحميل قائمة الأدمنية
        admins = await Admins.find();
        
        // تحميل أسماء البوتات لكل مستخدم
        userBotNames = await readDb('bot_names.json');
    } catch (e) {
        // Silent error handling
    }
};

// --- User Management ---
bot.use(async (ctx, next) => {
    const isBotOnline = (await readDb('config.json')).botOnline ?? true;
    if (ctx.from?.id !== ADMIN_ID && !isBotOnline && ctx.message?.text !== '/start' && !ctx.callbackQuery) {
        return ctx.reply('🤖 البوت في وضع الصيانة حاليًا، الرجاء المحاولة لاحقًا.').catch(() => {});
    }
    const userId = ctx.from?.id;
    if (userId) {
        const user = await Users.findOne({ userId });
        if (user && user.isBanned) {
            return;
        }
        if (!user) {
            await Users.create({ userId, isBanned: false, createdAt: Date.now() });
        }
    }
    await next();
});

// Load data with better error handling
function loadData() {
  try {
    if (fs.existsSync('servers.json')) {
      const data = fs.readFileSync('servers.json', 'utf8');
      servers = JSON.parse(data);
    }
  } catch (error) {
    // Silent error handling
  }

  try {
    if (fs.existsSync('users.json')) {
      const data = fs.readFileSync('users.json', 'utf8');
      users = JSON.parse(data);
    }
  } catch (error) {
    // Silent error handling
  }

  try {
    if (fs.existsSync('microsoft.json')) {
      const data = fs.readFileSync('microsoft.json', 'utf8');
      microsoftAccounts = JSON.parse(data);
    }
  } catch (error) {
    // Silent error handling
  }

  // تحميل الإعدادات الجديدة
  try {
    if (fs.existsSync('player_notifications.json')) {
      const data = fs.readFileSync('player_notifications.json', 'utf8');
      playerNotifications = JSON.parse(data);
    }
  } catch (error) {
    // Silent error handling
  }

  try {
    if (fs.existsSync('chat_forwarding.json')) {
      const data = fs.readFileSync('chat_forwarding.json', 'utf8');
      chatForwarding = JSON.parse(data);
    }
  } catch (error) {
    // Silent error handling
  }
}

// Save data with error handling
function saveServers() {
  try {
    fs.writeFileSync('servers.json', JSON.stringify(servers, null, 2));
  } catch (error) {
    // Silent error handling
  }
}

function saveUsers() {
  try {
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
  } catch (error) {
    // Silent error handling
  }
}

function saveMicrosoftAccounts() {
  try {
    fs.writeFileSync('microsoft.json', JSON.stringify(microsoftAccounts, null, 2));
  } catch (error) {
    // Silent error handling
  }
}

// دوال حفظ الإعدادات الجديدة
function savePlayerNotifications() {
  try {
    fs.writeFileSync('player_notifications.json', JSON.stringify(playerNotifications, null, 2));
  } catch (error) {
    // Silent error handling
  }
}

function saveChatForwarding() {
  try {
    fs.writeFileSync('chat_forwarding.json', JSON.stringify(chatForwarding, null, 2));
  } catch (error) {
    // Silent error handling
  }
}

loadData();

async function isSubscribed(ctx) {
  try {
    for (let ch of requiredChannels) {
      const member = await ctx.telegram.getChatMember('@' + ch, ctx.from.id);
      if (!['member', 'administrator', 'creator'].includes(member.status)) return false;
    }
    return true;
  } catch (error) {
    // Silent error handling
    return false;
  }
}

async function notifyOwner(ctx) {
  try {
    const user = ctx.from;
    const id = user.id;

    if (!users.includes(id)) {
      users.push(id);
      saveUsers();

      const message = `تم دخول شخص جديد إلى البوت الخاص بك 👾

• الاسم : ${user.first_name}
• المعرف : ${user.username ? '@' + user.username : 'لا يوجد'}
• الايدي : ${id}

• عدد الأعضاء الكلي : ${users.length}`;

      try {
        await bot.telegram.sendMessage(ownerId, message);
      } catch (err) {
        // Silent error handling
      }
    }
  } catch (error) {
    // Silent error handling
  }
}

// ==================== دوال إنشاء الحسابات والتحقق ====================

// دالة لإنشاء كود تحقق
function generateCaptcha() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==================== نهاية دوال الحسابات ====================

// --- Scenes and Stage Setup ---
const stage = new Scenes.Stage([]);
// Suppress all console outputs including warnings from libraries
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
};

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

// Global error handler to suppress all Telegraf logging
bot.catch((_err, _ctx) => { /* intentionally silent */ });

bot.use(session());
bot.use(stage.middleware());

// --- Broadcast Wizard ---
const broadcastWizard = new Scenes.WizardScene(
    'admin-broadcast-wizard',
    async (ctx) => {
        try {
            ctx.wizard.state.broadcast = { pin: false };
            await ctx.reply(
                'أرسل الرسالة التي تريد إذاعتها للجميع.\nللإلغاء أرسل /cancel'
            );
            return ctx.wizard.next();
        } catch (e) {
            // Silent error handling
        }
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم إلغاء الإذاعة.').catch(() => {});
        }
        ctx.wizard.state.broadcast.sourceChatId = ctx.chat.id;
        ctx.wizard.state.broadcast.sourceMessageId = ctx.message.message_id;
        const pin = ctx.wizard.state.broadcast.pin;
        const btnText = pin ? '📌 التثبيت: مفعّل' : '📌 التثبيت: معطّل';
        try {
            await ctx.reply(
                'اختر إعدادات الإذاعة ثم اضغط "🚀 إرسال":',
                Markup.inlineKeyboard([
                    [Markup.button.callback(btnText, 'toggle_pin')],
                    [Markup.button.callback('🚀 إرسال', 'broadcast_send')],
                    [Markup.button.callback('❌ إلغاء', 'broadcast_cancel')],
                ])
            );
        } catch (e) {
            // Silent error handling
        }
    }
);

// Options buttons
broadcastWizard.action('toggle_pin', async (ctx) => {
    try {
        await ctx.answerCbQuery();
    } catch(e) {}
    ctx.wizard.state.broadcast.pin = !ctx.wizard.state.broadcast.pin;
    const pin = ctx.wizard.state.broadcast.pin;
    const btnText = pin ? '📌 التثبيت: مفعّل' : '📌 التثبيت: معطّل';
    try {
        await ctx.editMessageReplyMarkup(
            Markup.inlineKeyboard([
                [Markup.button.callback(btnText, 'toggle_pin')],
                [Markup.button.callback('🚀 إرسال', 'broadcast_send')],
                [Markup.button.callback('❌ إلغاء', 'broadcast_cancel')],
            ]).reply_markup
        );
    } catch (e) {
        // Silent error handling
    }
});

broadcastWizard.action('broadcast_cancel', async (ctx) => {
    try {
        await ctx.answerCbQuery('تم الإلغاء');
    } catch(e) {}
    await ctx.scene.leave();
    try {
        await ctx.editMessageText('تم إلغاء الإذاعة.');
    } catch(e) {}
});

broadcastWizard.action('broadcast_send', async (ctx) => {
    try {
        await ctx.answerCbQuery('جاري الإرسال...');
    } catch(e) {}
    const { sourceChatId, sourceMessageId, pin } = ctx.wizard.state.broadcast || {};
    if (!sourceChatId || !sourceMessageId) {
        await ctx.scene.leave();
        return ctx.reply('❌ حدث خطأ: لا توجد رسالة للبث.').catch(() => {});
    }
    await ctx.scene.leave();
    await ctx.reply('جاري إرسال الإذاعة...').catch(() => {});
    const users = await Users.find({ isBanned: false });
    let successCount = 0, failureCount = 0, pinSuccess = 0, pinFail = 0;
    for (const user of users) {
        try {
            const sent = await ctx.telegram.copyMessage(
                user.userId,
                sourceChatId,
                sourceMessageId
            );
            successCount++;
            if (pin && sent && sent.message_id) {
                try {
                    await ctx.telegram.pinChatMessage(user.userId, sent.message_id, { disable_notification: true });
                    pinSuccess++;
                } catch (e) {
                    pinFail++;
                }
            }
        } catch (e) {
            failureCount++;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    let result = `✅ تمت الإذاعة.\n\n✅ أُرسلت إلى: ${successCount}\n❌ فشل: ${failureCount}`;
    if (pin) {
        result += `\n\n📌 التثبيت:\n- تم التثبيت: ${pinSuccess}\n- فشل التثبيت: ${pinFail}`;
    }
    await ctx.reply(result).catch(() => {});
});

// --- User Action Scene ---
const userActionScene = new Scenes.BaseScene('admin-user-action-scene');
userActionScene.enter((ctx) => {
    const action = ctx.match[1];
    const actionText = {
        'ban': 'لحظر المستخدم',
        'unban': 'لرفع الحظر',
        'info': 'لعرض معلوماته'
    };
    ctx.scene.state.action = action;
    ctx.reply(`أرسل ID المستخدم ${actionText[action]}\nللإلغاء أرسل /cancel`).catch(() => {});
});

userActionScene.on('text', async (ctx) => {
    if (ctx.message.text === '/cancel') {
        await ctx.scene.leave();
        return ctx.reply('تم إلغاء العملية.').catch(() => {});
    }
    const targetId = parseInt(ctx.message.text.trim());
    if (isNaN(targetId)) return ctx.reply('ID غير صالح.').catch(() => {});
    if (targetId === ADMIN_ID) return ctx.reply('لا يمكن تطبيق هذا الإجراء على المطور الأساسي.').catch(() => {});
    const user = await Users.findOne({ userId: targetId });
    if (!user) return ctx.reply('مستخدم غير موجود.').catch(() => {});
    const action = ctx.scene.state.action;
    switch (action) {
        case 'ban':
            if (user.isBanned) return ctx.reply('هذا المستخدم محظور بالفعل.').catch(() => {});
            await Users.updateOne({ userId: targetId }, { isBanned: true });
            await ctx.reply('✅ تم حظر المستخدم بنجاح.').catch(() => {});
            break;
        case 'unban':
            if (!user.isBanned) return ctx.reply('هذا المستخدم غير محظور.').catch(() => {});
            await Users.updateOne({ userId: targetId }, { isBanned: false });
            await ctx.reply('✅ تم رفع الحظر عن المستخدم بنجاح.').catch(() => {});
            break;
        case 'info':
            const servers = await Servers.find({ userId: targetId });
            const serverCount = servers.length;
            const userStatus = user.isBanned ? 'محظور 🚫' : 'غير محظور ✅';
            await ctx.reply(
                `👤 معلومات المستخدم:
                - ID: \`${user.userId}\`
                - الحالة: ${userStatus}
                - عدد السيرفرات المضافة: ${serverCount}`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
            break;
    }
    await ctx.scene.leave();
});

// --- Add Server Wizard ---
const addServerWizard = new Scenes.WizardScene(
    'admin-add-server-wizard',
    async (ctx) => {
        await ctx.reply('أرسل IP السيرفر مع المنفذ (مثل: play.example.com:25565)\nللإلغاء أرسل /cancel');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم إلغاء إضافة السيرفر.');
        }
        const [ip, port] = ctx.message.text.split(':');
        if (!ip || !port || isNaN(parseInt(port))) {
            return ctx.reply('صيغة خاطئة. أرسل IP:PORT.\nللإلغاء أرسل /cancel');
        }
        ctx.wizard.state.server = { ip, port: parseInt(port) };
        await ctx.reply('أرسل اسمًا للسيرفر.');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم إلغاء إضافة السيرفر.');
        }
        const name = ctx.message.text;
        const { ip, port } = ctx.wizard.state.server;
        const serverExists = await Servers.findOne({ ip, port });
        if (serverExists) {
            await ctx.scene.leave();
            return ctx.reply('هذا السيرفر موجود بالفعل.');
        }
        const newServer = { ip, port, name, addedBy: ADMIN_ID };
        await Servers.create(newServer);
        await ctx.scene.leave();
        return ctx.reply(`✅ تم إضافة السيرفر ${name} بنجاح.`);
    }
);

// --- Remove Server Wizard ---
const removeServerWizard = new Scenes.WizardScene(
    'admin-remove-server-wizard',
    async (ctx) => {
        const servers = await Servers.find({});
        if (servers.length === 0) {
            await ctx.scene.leave();
            return ctx.reply('لا يوجد سيرفرات حاليًا.');
        }
        let list = servers.map(s => `${s.name} - ${s.ip}:${s.port}`).join('\n');
        await ctx.reply(`أرسل IP السيرفر الذي تريد حذفه.\n\nالسيرفرات الحالية:\n${list}\n\nللإلغاء أرسل /cancel`);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم إلغاء حذف السيرفر.');
        }
        const [ip, port] = ctx.message.text.split(':');
        if (!ip || !port) {
            return ctx.reply('صيغة خاطئة. أرسل IP:PORT.\nللإلغاء أرسل /cancel');
        }
        const success = await Servers.deleteOne({ ip, port: parseInt(port) });
        await ctx.scene.leave();
        if (success) {
            return ctx.reply('✅ تم حذف السيرفر بنجاح.');
        } else {
            return ctx.reply('❌ لم يتم العثور على السيرفر.');
        }
    }
);

// --- Maintenance Mode Scene ---
const maintenanceModeScene = new Scenes.BaseScene('admin-maintenance-mode-scene');
maintenanceModeScene.enter((ctx) => {
    ctx.reply(
        'اختر وضع الصيانة:\n\n' +
        '1. ✅ تشغيل البوت\n' +
        '2. ⛔ إيقاف البوت للصيانة\n' +
        '3. ❌ إلغاء',
        Markup.keyboard([
            ['✅ تشغيل البوت'],
            ['⛔ إيقاف البوت للصيانة'],
            ['❌ إلغاء']
        ]).oneTime().resize()
    ).catch(() => {});
});

maintenanceModeScene.on('text', async (ctx) => {
    const choice = ctx.message.text;
    if (choice === '❌ إلغاء') {
        await ctx.scene.leave();
        return ctx.reply('تم الإلغاء.').catch(() => {});
    }
    const config = await readDb('config.json');
    if (choice === '✅ تشغيل البوت') {
        config.botOnline = true;
        await writeDb('config.json', config);
        await ctx.reply('✅ تم تشغيل البوت.').catch(() => {});
    } else if (choice === '⛔ إيقاف البوت للصيانة') {
        config.botOnline = false;
        await writeDb('config.json', config);
        await ctx.reply('⛔ تم إيقاف البوت للصيانة.').catch(() => {});
    } else {
        await ctx.reply('اختر خيارًا صحيحًا.').catch(() => {});
        return;
    }
    await ctx.scene.leave();
});

// --- Admin Management Scene ---
const adminManagementScene = new Scenes.BaseScene('admin-management-scene');
adminManagementScene.enter((ctx) => {
    ctx.reply(
        '👑 إدارة الأدمنية\n\nاختر الإجراء المطلوب:',
        Markup.inlineKeyboard([
            [Markup.button.callback('➕ رفع أدمن', 'add_admin')],
            [Markup.button.callback('➖ تنزيل أدمن', 'remove_admin')],
            [Markup.button.callback('📋 قائمة الأدمنية', 'list_admins')],
            [Markup.button.callback('🔙 رجوع', 'admin_panel')]
        ])
    );
});

adminManagementScene.action('add_admin', async (ctx) => {
    ctx.scene.state.action = 'add_admin';
    ctx.reply('أرسل ID المستخدم لرفعه كأدمن:\nللإلغاء أرسل /cancel');
});

adminManagementScene.action('remove_admin', async (ctx) => {
    ctx.scene.state.action = 'remove_admin';
    ctx.reply('أرسل ID المستخدم لتنزيله من الأدمنية:\nللإلغاء أرسل /cancel');
});

adminManagementScene.action('list_admins', async (ctx) => {
    const admins = await Admins.find();
    let list = '📋 قائمة الأدمنية:\n\n';
    admins.forEach((adminId, index) => {
        list += `${index + 1}. ${adminId}\n`;
    });
    list += `\n📊 العدد الإجمالي: ${admins.length} أدمن`;
    ctx.reply(list);
});

adminManagementScene.action('admin_panel', (ctx) => {
    ctx.scene.leave();
    showAdminPanel(ctx);
});

adminManagementScene.on('text', async (ctx) => {
    if (ctx.message.text === '/cancel') {
        await ctx.scene.leave();
        return ctx.reply('تم الإلغاء.').catch(() => {});
    }
    
    const targetId = parseInt(ctx.message.text.trim());
    if (isNaN(targetId)) return ctx.reply('ID غير صالح.').catch(() => {});
    
    const action = ctx.scene.state.action;
    
    if (action === 'add_admin') {
        if (targetId === ADMIN_ID) return ctx.reply('هذا المستخدم هو المطور الأساسي.').catch(() => {});
        
        const isAlreadyAdmin = await Admins.isAdmin(targetId);
        if (isAlreadyAdmin) return ctx.reply('هذا المستخدم أدمن بالفعل.').catch(() => {});
        
        await Admins.add(targetId);
        admins = await Admins.find();
        await ctx.reply(`✅ تم رفع المستخدم ${targetId} كأدمن بنجاح.`);
    } 
    else if (action === 'remove_admin') {
        if (targetId === ADMIN_ID) return ctx.reply('لا يمكن تنزيل المطور الأساسي.').catch(() => {});
        
        const isAdmin = await Admins.isAdmin(targetId);
        if (!isAdmin) return ctx.reply('هذا المستخدم ليس أدمن.').catch(() => {});
        
        await Admins.remove(targetId);
        admins = await Admins.find();
        await ctx.reply(`✅ تم تنزيل المستخدم ${targetId} من الأدمنية بنجاح.`);
    }
    
    await ctx.scene.leave();
});

// --- Version Selection Scene ---
const versionSelectionScene = new Scenes.BaseScene('version-selection-scene');
versionSelectionScene.enter((ctx) => {
    ctx.reply('اختر النسخة المطلوبة:', Markup.inlineKeyboard([
        [Markup.button.callback('1.16.201', 'version_1.16.201'), Markup.button.callback('1.16.210', 'version_1.16.210'), Markup.button.callback('1.16.220', 'version_1.16.220')],
        [Markup.button.callback('1.17.0', 'version_1.17.0'), Markup.button.callback('1.17.10', 'version_1.17.10'), Markup.button.callback('1.17.30', 'version_1.17.30')],
        [Markup.button.callback('1.17.40', 'version_1.17.40'), Markup.button.callback('1.18.0', 'version_1.18.0'), Markup.button.callback('1.18.11', 'version_1.18.11')],
        [Markup.button.callback('1.18.30', 'version_1.18.30'), Markup.button.callback('1.19.1', 'version_1.19.1'), Markup.button.callback('1.19.10', 'version_1.19.10')],
        [Markup.button.callback('1.19.20', 'version_1.19.20'), Markup.button.callback('1.19.21', 'version_1.19.21'), Markup.button.callback('1.19.30', 'version_1.19.30')],
        [Markup.button.callback('1.19.40', 'version_1.19.40'), Markup.button.callback('1.19.41', 'version_1.19.41'), Markup.button.callback('1.19.50', 'version_1.19.50')],
        [Markup.button.callback('1.19.60', 'version_1.19.60'), Markup.button.callback('1.19.62', 'version_1.19.62'), Markup.button.callback('1.19.63', 'version_1.19.63')],
        [Markup.button.callback('1.19.70', 'version_1.19.70'), Markup.button.callback('1.19.80', 'version_1.19.80'), Markup.button.callback('1.20.0', 'version_1.20.0')],
        [Markup.button.callback('1.20.10', 'version_1.20.10'), Markup.button.callback('1.20.30', 'version_1.20.30'), Markup.button.callback('1.20.40', 'version_1.20.40')],
        [Markup.button.callback('1.20.50', 'version_1.20.50'), Markup.button.callback('1.20.61', 'version_1.20.61'), Markup.button.callback('1.20.71', 'version_1.20.71')],
        [Markup.button.callback('1.20.80', 'version_1.20.80'), Markup.button.callback('1.21.0', 'version_1.21.0'), Markup.button.callback('1.21.2', 'version_1.21.2')],
        [Markup.button.callback('1.21.21', 'version_1.21.21'), Markup.button.callback('1.21.30', 'version_1.21.30'), Markup.button.callback('1.21.42', 'version_1.21.42')],
        [Markup.button.callback('1.21.50', 'version_1.21.50'), Markup.button.callback('1.21.60', 'version_1.21.60'), Markup.button.callback('1.21.70', 'version_1.21.70')],
        [Markup.button.callback('1.21.80', 'version_1.21.80'), Markup.button.callback('1.21.90', 'version_1.21.90'), Markup.button.callback('1.21.93', 'version_1.21.93')],
        [Markup.button.callback('1.21.100', 'version_1.21.100'), Markup.button.callback('1.21.111', 'version_1.21.111'), Markup.button.callback('1.21.120', 'version_1.21.120')],
        [Markup.button.callback('1.21.124', 'version_1.21.124')], // إضافة الإصدار 1.21.124
        [Markup.button.callback('🔙 العودة', 'back_to_main')]
    ]));
});

// --- Add Channel Scene ---
const addChannelScene = new Scenes.BaseScene('add-channel-scene');
addChannelScene.enter((ctx) => {
    ctx.reply('أرسل اسم القناة بدون @ لإضافتها:\nللإلغاء أرسل /cancel');
});

addChannelScene.on('text', async (ctx) => {
    if (ctx.message.text === '/cancel') {
        await ctx.scene.leave();
        return ctx.reply('تم الإلغاء.');
    }
    
    const channelName = ctx.message.text.trim();
    
    if (requiredChannels.includes(channelName)) {
        await ctx.reply('❌ هذه القناة موجودة مسبقاً.');
    } else {
        requiredChannels.push(channelName);
        await ctx.reply(`✅ تم إضافة القناة @${channelName} بنجاح!`);
    }
    
    await ctx.scene.leave();
});

// --- Remove Channel Scene ---
const removeChannelScene = new Scenes.BaseScene('remove-channel-scene');
removeChannelScene.enter((ctx) => {
    let list = 'القنوات الحالية:\n';
    requiredChannels.forEach((ch, i) => {
        list += `${i + 1}. @${ch}\n`;
    });
    ctx.reply(`${list}\nأرسل اسم القناة بدون @ لحذفها:\nللإلغاء أرسل /cancel`);
});

removeChannelScene.on('text', async (ctx) => {
    if (ctx.message.text === '/cancel') {
        await ctx.scene.leave();
        return ctx.reply('تم الإلغاء.');
    }
    
    const channelName = ctx.message.text.trim();
    const index = requiredChannels.indexOf(channelName);
    
    if (index === -1) {
        await ctx.reply('❌ هذه القناة غير موجودة.');
    } else {
        requiredChannels.splice(index, 1);
        await ctx.reply(`✅ تم حذف القناة @${channelName} بنجاح!`);
    }
    
    await ctx.scene.leave();
});

// --- Register Scenes ---
stage.register(broadcastWizard);
stage.register(userActionScene);
stage.register(addServerWizard);
stage.register(removeServerWizard);
stage.register(maintenanceModeScene);
stage.register(adminManagementScene);
stage.register(versionSelectionScene);
stage.register(addChannelScene);
stage.register(removeChannelScene);

// --- دالة مراقبة الشات ---
function setupChatMonitoring(userId, client) {
    if (!chatForwarding[userId]) return;
    
    client.on('text', (packet) => {
        try {
            if (packet.source_name && packet.message && 
                !packet.source_name.includes('Bot') && 
                !packet.source_name.includes('MUF') &&
                packet.source_name !== client.username) {
                
                // إرسال الرسالة إلى صاحب السيرفر
                bot.telegram.sendMessage(
                    userId,
                    `💬 ${packet.source_name}: ${packet.message}`
                ).catch(() => {});
            }
        } catch (error) {
            // Silent error handling
        }
    });
}

// --- دالة محسنة للاتصال بالسيرفر مع رسائل محسنة ---
async function connectToServer(userId, attempt = 1) {
    try {
        if (!servers[userId]) return;

        if (clients[userId] && clients[userId].connected) return;

        const { host, port } = servers[userId];
        const version = userVersions[userId] || '1.21.93';

        // إيقاف أي اتصالات سابقة
        if (clients[userId]) {
            try {
                clients[userId].end();
            } catch (error) {
                // تجاهل الأخطاء
            }
            delete clients[userId];
        }

        if (spamIntervals[userId]) {
            clearInterval(spamIntervals[userId]);
            delete spamIntervals[userId];
        }

        if (intervals[userId]) {
            clearInterval(intervals[userId]);
            delete intervals[userId];
        }

        // الحصول على أسماء البوتات للمستخدم
        const botNames = await BotNames.getForUser(userId);
        const firstBotName = botNames.firstBot || 'muf879';

        let authOptions = {
            host,
            port,
            username: firstBotName,
            version,
            offline: true,
            connectTimeout: 30000,
            skipPing: true,
            authTitle: false,
            profilesFolder: './cache',
            useNativeRaknet: true,
            onMsaCode: () => {},
            doAzureAuth: false,
            doLocalAuth: false
        };

        // استخدام الحساب الحقيقي إذا موجود
        if (microsoftAccounts[userId] && microsoftAccounts[userId].accessToken) {
            authOptions = {
                host,
                port,
                username: microsoftAccounts[userId].username || microsoftAccounts[userId].email.split('@')[0],
                version,
                offline: true,
                connectTimeout: 30000,
                skipPing: true,
                authTitle: false,
                profilesFolder: './cache',
                useNativeRaknet: true,
                onMsaCode: () => {},
                doAzureAuth: false,
                doLocalAuth: false
            };
        }

        // إرسال رسالة المحاولة الأولى فقط
        if (attempt === 1) {
            await bot.telegram.sendMessage(userId, `🚀 جاري الاتصال بالسيرفر كـ ${authOptions.username}...`).catch(() => {});
        }

        try {
            const client = createClient(authOptions);
            
            clients[userId] = client;

            client.on('join', async () => {
                try {
                    // رسالة نجاح الاتصال للبوت الأول
                    await bot.telegram.sendMessage(userId, `✅ ${authOptions.username} دخل السيرفر بنجاح!`);

                    // إضافة المراقبة بعد الاتصال الناجح
                    setupChatMonitoring(userId, client);

                    if (intervals[userId]) {
                        clearInterval(intervals[userId]);
                        delete intervals[userId];
                    }

                    // Start second bot after 5 seconds
                    setTimeout(() => {
                        createSecondBot(userId, host, port, version);
                    }, 5000);

                    // سلوك البوت الأول
                    spamIntervals[userId] = setInterval(() => {
                        try {
                            if (client.connected) {
                                // حركة عشوائية
                                client.queue('move_player', {
                                    runtime_id: client.entityId,
                                    position: {
                                        x: Math.random() * 10,
                                        y: 64,
                                        z: Math.random() * 10
                                    },
                                    pitch: Math.random() * 90,
                                    yaw: Math.random() * 360,
                                    head_yaw: Math.random() * 360,
                                    mode: 0,
                                    on_ground: true,
                                    ridden_runtime_id: 0,
                                    teleport_cause: 0,
                                    teleport_item: 0
                                });

                                // رسائل دردشة عشوائية
                                const messages = ['hi', 'hello', 'hey', 'how are you?', 'nice server', 'gg', 'good game'];
                                const randomMessage = messages[Math.floor(Math.random() * messages.length)];

                                client.queue('text', {
                                    type: 'chat',
                                    needs_translation: false,
                                    source_name: authOptions.username,
                                    message: randomMessage,
                                    xuid: '',
                                    platform_chat_id: '',
                                });
                            }
                        } catch (err) {}
                    }, Math.random() * 30000 + 15000);
                } catch (error) {}
            });

            client.on('disconnect', (reason) => {
                // رسالة فصل مبسطة
                bot.telegram.sendMessage(userId, `❌ تم فصل ${authOptions.username}.`).catch(() => {});

                if (spamIntervals[userId]) {
                    clearInterval(spamIntervals[userId]);
                    delete spamIntervals[userId];
                }
                delete clients[userId];

                // لا نرسل رسائل إعادة المحاولة للمستخدم
                if (attempt < 2) {
                    setTimeout(() => {
                        connectToServer(userId, attempt + 1);
                    }, 5000);
                }
            });

            client.on('error', (err) => {
                if (err.message.includes('Ping timed out') || err.message.includes('ECONNREFUSED')) {
                    bot.telegram.sendMessage(userId, `⚠️ السيرفر يستجيب ببطء، جاري إعادة المحاولة...`).catch(() => {});
                } else {
                    bot.telegram.sendMessage(userId, `❌ خطأ في الاتصال.`).catch(() => {});
                }

                if (spamIntervals[userId]) {
                    clearInterval(spamIntervals[userId]);
                    delete spamIntervals[userId];
                }
                delete clients[userId];

                if (attempt < 2) {
                    setTimeout(() => {
                        connectToServer(userId, attempt + 1);
                    }, 5000);
                }
            });

            setTimeout(() => {
                if (!client.connected) {
                    try {
                        client.end();
                    } catch (e) {}
                    if (attempt < 2) {
                        setTimeout(() => {
                            connectToServer(userId, attempt + 1);
                        }, 5000);
                    }
                }
            }, 25000);

        } catch (error) {
            bot.telegram.sendMessage(userId, `❌ فشل في إنشاء اتصال.`).catch(() => {});
            
            if (attempt < 2) {
                setTimeout(() => {
                    connectToServer(userId, attempt + 1);
                }, 5000);
            }
        }

    } catch (error) {
        bot.telegram.sendMessage(userId, `❌ فشل في تشغيل البوت.`).catch(() => {});
        
        if (attempt < 2) {
            setTimeout(() => {
                connectToServer(userId, attempt + 1);
            }, 5000);
        }
    }
}

// --- تحديث دالة البوت الثاني مع الاسم القابل للتغيير لكل مستخدم ---
async function createSecondBot(userId, host, port, version) {
    try {
        // الحصول على اسم البوت الثاني للمستخدم
        const secondBotName = await BotNames.getSecondBotName(userId);
        
        let authOptions = {
            host,
            port,
            username: secondBotName,
            version,
            offline: true,
            connectTimeout: 30000,
            skipPing: true,
            authTitle: false,
            profilesFolder: './cache',
            useNativeRaknet: true,
            onMsaCode: () => {},
            doAzureAuth: false,
            doLocalAuth: false
        };

        // استخدام الحساب الحقيقي إذا موجود
        if (microsoftAccounts[userId] && microsoftAccounts[userId].accessToken) {
            authOptions = {
                host,
                port,
                username: microsoftAccounts[userId].username + "_2",
                version,
                offline: true,
                connectTimeout: 30000,
                skipPing: true,
                authTitle: false,
                profilesFolder: './cache',
                useNativeRaknet: true,
                onMsaCode: () => {},
                doAzureAuth: false,
                doLocalAuth: false
            };
        }

        const secondClient = createClient(authOptions);

        const clientKey = `${userId}_second`;
        clients[clientKey] = secondClient;

        secondClient.on('join', () => {
            // رسالة نجاح البوت الثاني
            bot.telegram.sendMessage(userId, `✅ ${authOptions.username} دخل السيرفر!`).catch(() => {});

            if (spamIntervals[clientKey]) {
                clearInterval(spamIntervals[clientKey]);
            }
            
            spamIntervals[clientKey] = setInterval(() => {
                try {
                    if (secondClient.connected) {
                        // حركة عشوائية للبوت الثاني
                        secondClient.queue('move_player', {
                            runtime_id: secondClient.entityId,
                            position: {
                                x: Math.random() * 15,
                                y: 64,
                                z: Math.random() * 15
                            },
                            pitch: Math.random() * 90,
                            yaw: Math.random() * 360,
                            head_yaw: Math.random() * 360,
                            mode: 0,
                            on_ground: true,
                            ridden_runtime_id: 0,
                            teleport_cause: 0,
                            teleport_item: 0
                        });

                        // رسائل دردشة عشوائية
                        const messages = ['wow', 'cool', 'nice', 'lol', 'good game', 'thanks', 'awesome'];
                        const randomMessage = messages[Math.floor(Math.random() * messages.length)];

                        secondClient.queue('text', {
                            type: 'chat',
                            needs_translation: false,
                            source_name: authOptions.username,
                            message: randomMessage,
                            xuid: '',
                            platform_chat_id: '',
                        });
                    }
                } catch (err) {}
            }, Math.random() * 25000 + 20000);
        });

        secondClient.on('disconnect', (reason) => {
            bot.telegram.sendMessage(userId, `❌ تم فصل ${authOptions.username}.`).catch(() => {});

            if (spamIntervals[clientKey]) {
                clearInterval(spamIntervals[clientKey]);
                delete spamIntervals[clientKey];
            }
            delete clients[clientKey];
        });

        secondClient.on('error', (err) => {
            if (spamIntervals[clientKey]) {
                clearInterval(spamIntervals[clientKey]);
                delete spamIntervals[clientKey];
            }
            delete clients[clientKey];
        });

    } catch (error) {}
}

// --- Bot Commands ---
bot.start(async (ctx) => {
    try {
        if (!(await isSubscribed(ctx))) {
            return ctx.reply('🚫 يجب عليك الاشتراك في القنوات أولاً:\n' + requiredChannels.map(ch => '@' + ch).join('\n'));
        }

        await notifyOwner(ctx);

        // إظهار واجهة المستخدم العادي مع زر الأدمن للمسؤولين
        const isAdmin = await Admins.isAdmin(ctx.from.id);
        if (isAdmin) {
            await ctx.reply(
                'أهلاً بك! أنا بوت للتحقق من حالة سيرفرات الألعاب.\n\nيمكنك إرسال IP السيرفر مع المنفذ للتحقق من حالته. مثال: `play.example.com:25565`\n\nيمكنك إرسال /list لعرض قائمة السيرفرات المتاحة.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('👑 لوحة تحكم الادمن 👑', 'admin_panel')]
                ])
            );
        }
        
        // عرض خيارات النسخ الموسعة للمستخدمين بدون زر تلقائي
        await ctx.reply('شنو اصدار لعبتك؟', Markup.inlineKeyboard([
            [Markup.button.callback('1.16.201', 'version_1.16.201'), Markup.button.callback('1.16.210', 'version_1.16.210'), Markup.button.callback('1.16.220', 'version_1.16.220')],
            [Markup.button.callback('1.17.0', 'version_1.17.0'), Markup.button.callback('1.17.10', 'version_1.17.10'), Markup.button.callback('1.17.30', 'version_1.17.30')],
            [Markup.button.callback('1.17.40', 'version_1.17.40'), Markup.button.callback('1.18.0', 'version_1.18.0'), Markup.button.callback('1.18.11', 'version_1.18.11')],
            [Markup.button.callback('1.18.30', 'version_1.18.30'), Markup.button.callback('1.19.1', 'version_1.19.1'), Markup.button.callback('1.19.10', 'version_1.19.10')],
            [Markup.button.callback('1.19.20', 'version_1.19.20'), Markup.button.callback('1.19.21', 'version_1.19.21'), Markup.button.callback('1.19.30', 'version_1.19.30')],
            [Markup.button.callback('1.19.40', 'version_1.19.40'), Markup.button.callback('1.19.41', 'version_1.19.41'), Markup.button.callback('1.19.50', 'version_1.19.50')],
            [Markup.button.callback('1.19.60', 'version_1.19.60'), Markup.button.callback('1.19.62', 'version_1.19.62'), Markup.button.callback('1.19.63', 'version_1.19.63')],
            [Markup.button.callback('1.19.70', 'version_1.19.70'), Markup.button.callback('1.19.80', 'version_1.19.80'), Markup.button.callback('1.20.0', 'version_1.20.0')],
            [Markup.button.callback('1.20.10', 'version_1.20.10'), Markup.button.callback('1.20.30', 'version_1.20.30'), Markup.button.callback('1.20.40', 'version_1.20.40')],
            [Markup.button.callback('1.20.50', 'version_1.20.50'), Markup.button.callback('1.20.61', 'version_1.20.61'), Markup.button.callback('1.20.71', 'version_1.20.71')],
            [Markup.button.callback('1.20.80', 'version_1.20.80'), Markup.button.callback('1.21.0', 'version_1.21.0'), Markup.button.callback('1.21.2', 'version_1.21.2')],
            [Markup.button.callback('1.21.21', 'version_1.21.21'), Markup.button.callback('1.21.30', 'version_1.21.30'), Markup.button.callback('1.21.42', 'version_1.21.42')],
            [Markup.button.callback('1.21.50', 'version_1.21.50'), Markup.button.callback('1.21.60', 'version_1.21.60'), Markup.button.callback('1.21.70', 'version_1.21.70')],
            [Markup.button.callback('1.21.80', 'version_1.21.80'), Markup.button.callback('1.21.90', 'version_1.21.90'), Markup.button.callback('1.21.93', 'version_1.21.93')],
            [Markup.button.callback('1.21.100', 'version_1.21.100'), Markup.button.callback('1.21.111', 'version_1.21.111'), Markup.button.callback('1.21.120', 'version_1.21.120')],
            [Markup.button.callback('1.21.124', 'version_1.21.124')], // إضافة الإصدار 1.21.124
            [Markup.button.callback('📋 عرض المزيد', 'show_more_versions')]
        ]));
    } catch (error) {
        // Silent error handling
    }
});

// --- Version Selection ---
bot.action(/version_(.+)/, async (ctx) => {
    try {
        const version = ctx.match[1];
        userVersions[ctx.from.id] = version;

        await ctx.answerCbQuery(`✅ تم اختيار: ${version}`);
        
        await ctx.editMessageText(
            `✅ تم اختيار النسخة: ${version}\nهسه تكدر تضيف السيرفر.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('👥 قسم اللاعبين', 'players_section')],
                [Markup.button.callback('🔄 تغيير اسم البوت2', 'change_bot_name')],
                [Markup.button.callback('☕ جافا', 'java_connect')],
                [Markup.button.callback('➕ إضافة سيرفر', 'add')],
                [Markup.button.callback('🗑️ حذف السيرفر', 'del')],
                [Markup.button.callback('▶️ تشغيل البوت', 'run')],
                [Markup.button.callback('🛑 إيقاف البوت', 'stop')],
                ...(await Admins.isAdmin(ctx.from.id) ? [[Markup.button.callback('👑 لوحة تحكم الادمن 👑', 'admin_panel')]] : [])
            ])
        );
    } catch (error) {
        // Silent error handling
    }
});

// --- قسم اللاعبين ---
bot.action('players_section', async (ctx) => {
    try {
        const userId = ctx.from.id;
        
        if (!servers[userId]) {
            return ctx.editMessageText(
                '❗ لم تقم بإضافة سيرفر بعد.\nيرجى إضافة سيرفر أولاً للوصول إلى قسم اللاعبين.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('➕ إضافة سيرفر', 'add')],
                    [Markup.button.callback('🔙 العودة', 'back_to_main')]
                ])
            );
        }

        // الحصول على الإعدادات الحالية للمستخدم
        const forwardingEnabled = chatForwarding[userId] || false;

        await ctx.editMessageText(
            `👥 قسم إدارة اللاعبين\n\n` +
            `💬 إعادة توجيه الشات: ${forwardingEnabled ? '✅ مفعلة' : '❌ معطلة'}\n\n` +
            `اختر الخيار المطلوب:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('💬 إعادة توجيه الشات', 'toggle_chat_forwarding')],
                [Markup.button.callback('🔙 العودة', 'back_to_main')]
            ])
        );
    } catch (error) {
        // Silent error handling
    }
});

// تبديل إعادة توجيه الشات
bot.action('toggle_chat_forwarding', async (ctx) => {
    try {
        const userId = ctx.from.id;
        
        // تبديل الحالة
        chatForwarding[userId] = !chatForwarding[userId];
        saveChatForwarding();
        
        const status = chatForwarding[userId] ? '✅ تم تفعيل' : '❌ تم تعطيل';
        
        await ctx.answerCbQuery(`${status} إعادة توجيه الشات`);
        
        // العودة إلى قسم اللاعبين
        ctx.editMessageText(
            `👥 قسم إدارة اللاعبين\n\n` +
            `💬 إعادة توجيه الشات: ${chatForwarding[userId] ? '✅ مفعلة' : '❌ معطلة'}\n\n` +
            `اختر الخيار المطلوب:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('💬 إعادة توجيه الشات', 'toggle_chat_forwarding')],
                [Markup.button.callback('🔙 العودة', 'back_to_main')]
            ])
        );
    } catch (error) {
        // Silent error handling
    }
});

// --- Server Management ---
bot.action('add', async (ctx) => {
    try {
        await ctx.editMessageText(
            '📥 أرسل الهوست والبورت بهذا الشكل:\nhost:port',
            Markup.inlineKeyboard([
                [Markup.button.callback('🔙 العودة', 'back_to_main')]
            ])
        );
        userStates[ctx.from.id] = 'awaiting_server';
    } catch (error) {
        // Silent error handling
    }
});

bot.action('del', async (ctx) => {
    try {
        const userId = ctx.from.id;
        if (servers[userId]) {
            delete servers[userId];
            saveServers();
            stopUserBots(userId);
            await ctx.editMessageText(
                '🗑️ تم حذف السيرفر.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 العودة', 'back_to_main')]
                ])
            );
        } else {
            await ctx.editMessageText(
                '❗ لا يوجد سيرفر محفوظ.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 العودة', 'back_to_main')]
                ])
            );
        }
    } catch (error) {
        // Silent error handling
    }
});

bot.action('run', async (ctx) => {
    try {
        const userId = ctx.from.id;

        if (!servers[userId]) {
            return ctx.editMessageText(
                '❗ أضف السيرفر أولاً.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 العودة', 'back_to_main')]
                ])
            );
        }

        await ctx.editMessageText(
            '🚀 جارٍ تشغيل البوت...\n⏳ قد تستغرق العملية بضع ثواني',
            Markup.inlineKeyboard([
                [Markup.button.callback('🔙 العودة', 'back_to_main')]
            ])
        );

        // تشغيل البوت مع إعادة المحاولة التلقائية
        setTimeout(() => {
            try {
                connectToServer(userId, 1);
            } catch (error) {
                bot.telegram.sendMessage(userId, '❌ فشل في تشغيل البوت.').catch(() => {});
            }
        }, 2000);
    } catch (error) {
        // Silent error handling
    }
});

bot.action('stop', async (ctx) => {
    try {
        const userId = ctx.from.id;
        stopUserBots(userId);
        await ctx.editMessageText(
            '🛑 تم إيقاف البوت.',
            Markup.inlineKeyboard([
                [Markup.button.callback('🔙 العودة', 'back_to_main')]
            ])
        );
    } catch (error) {
        // Silent error handling
    }
});

bot.action('java_connect', async (ctx) => {
    try {
        const javaMessage = `للحصول على خدمات الجافا، تواصل مع البوت المختص:
👤 @LOKmam_bot`;

        await ctx.editMessageText(
            javaMessage,
            Markup.inlineKeyboard([
                [Markup.button.url('🔗 الانتقال إلى @LOKmam_bot', 'https://t.me/LOKmam_bot')],
                [Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'back_to_main')]
            ])
        );
    } catch (error) {
        // Silent error handling
    }
});

// --- إضافة زر تغيير اسم البوت الثاني ---
bot.action('change_bot_name', async (ctx) => {
    try {
        const userId = ctx.from.id;
        // الحصول على الاسم الحالي للبوت الثاني للمستخدم
        const currentName = await BotNames.getSecondBotName(userId);
        
        await ctx.editMessageText(
            `🔄 تغيير اسم البوت الثاني\n\n` +
            `📝 **الاسم الحالي:** ${currentName}\n\n` +
            `💡 يمكنك تغيير اسم البوت الثاني الذي سيتم استخدامه عند تشغيل البوت.\n` +
            `✏️ أرسل الاسم الجديد (2-15 حرف):`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🔙 العودة', 'back_to_main')]
            ])
        );
        userStates[userId] = 'awaiting_bot_name';
    } catch (error) {
        // Silent error handling
    }
});

// --- معالج زر عرض المزيد من النسخ ---
bot.action('show_more_versions', (ctx) => {
    ctx.scene.enter('version-selection-scene');
});

bot.action('back_to_main', async (ctx) => {
    try {
        const isAdmin = await Admins.isAdmin(ctx.from.id);
        
        await ctx.editMessageText(
            '🤖 تحكم بالبوت:',
            Markup.inlineKeyboard([
                [Markup.button.callback('👥 قسم اللاعبين', 'players_section')],
                [Markup.button.callback('🔄 تغيير اسم البوت2', 'change_bot_name')],
                [Markup.button.callback('☕ جافا', 'java_connect')],
                [Markup.button.callback('➕ إضافة سيرفر', 'add')],
                [Markup.button.callback('🗑️ حذف السيرفر', 'del')],
                [Markup.button.callback('▶️ تشغيل البوت', 'run')],
                [Markup.button.callback('🛑 إيقاف البوت', 'stop')],
                ...(isAdmin ? [[Markup.button.callback('👑 لوحة تحكم الادمن 👑', 'admin_panel')]] : [])
            ])
        );
    } catch (error) {
        // Silent error handling
    }
});

// --- Admin Panel Functions ---
async function showAdminPanel(ctx) {
    try {
        const config = await readDb('config.json');
        const botOnline = config.botOnline ?? true;
        const onlineStatusText = botOnline ? '✅ يعمل' : '❌ متوقف';
        
        await ctx.editMessageText(
            `أهلاً بك يا مالكي في لوحة التحكم الرئيسية! 👋\n\nحالة البوت: ${onlineStatusText}`,
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('📢 إذاعة رسالة', 'admin_broadcast'),
                    Markup.button.callback('📈 إحصائيات البوت', 'admin_stats')
                ],
                [
                    Markup.button.callback('🔧 الإعدادات', 'admin_settings'),
                    Markup.button.callback('📦 إدارة السيرفرات', 'admin_servers')
                ],
                [
                    Markup.button.callback('🔍 بحث عن مستخدم', 'admin_user_info'),
                    Markup.button.callback('🛡️ حظر مستخدم', 'admin_ban_user'),
                    Markup.button.callback('🔓 رفع الحظر', 'admin_unban_user')
                ],
                [
                    Markup.button.callback('👑 إدارة الأدمنية', 'admin_management')
                ],
                [
                    Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'back_to_main')
                ]
            ])
        );
    } catch (e) {
        // Silent error handling
    }
}

// --- Admin Panel Actions ---
bot.action('admin_panel', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await showAdminPanel(ctx);
    } catch (e) {
        // Silent error handling
    }
});

bot.action('admin_broadcast', (ctx) => ctx.scene.enter('admin-broadcast-wizard'));
bot.action('admin_ban_user', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'ban' }));
bot.action('admin_unban_user', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'unban' }));
bot.action('admin_user_info', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'info' }));
bot.action('admin_management', (ctx) => ctx.scene.enter('admin-management-scene'));

// --- Admin Stats ---
bot.action('admin_stats', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const usersCount = (await Users.find({})).length;
        const serversCount = (await Servers.find({})).length;
        const onlineUsers = (await Users.find({ isBanned: false })).length;
        const offlineUsers = usersCount - onlineUsers;
        const cpuUsage = (await pidusage(process.pid)).cpu.toFixed(2);
        const memUsage = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
        const uptime = process.uptime();
        const days = Math.floor(uptime / (3600 * 24));
        const hours = Math.floor(uptime % (3600 * 24) / 3600);
        const minutes = Math.floor(uptime % 3600 / 60);
        
        await ctx.editMessageText(
            `📈 إحصائيات البوت:\n\n` +
            `- إجمالي المستخدمين: ${usersCount}\n` +
            `- المستخدمون النشطون: ${onlineUsers}\n` +
            `- المستخدمون المحظورون: ${offlineUsers}\n` +
            `- إجمالي السيرفرات المضافة: ${serversCount}\n` +
            `- استهلاك الـ CPU: ${cpuUsage}%\n` +
            `- استهلاك الذاكرة: ${memUsage} MB\n` +
            `- وقت التشغيل: ${days} يوم, ${hours} ساعة, ${minutes} دقيقة\n` +
            `- المنصة: ${os.platform()}`,
            Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'admin_panel')]])
        );
    } catch (e) {
        // Silent error handling
    }
});

// --- Admin Settings ---
bot.action('admin_settings', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const config = await readDb('config.json');
        const botOnline = config.botOnline ?? true;
        
        await ctx.editMessageText(
            `🔧 إعدادات البوت:\n\n` +
            `- حالة البوت: ${botOnline ? '✅ يعمل' : '❌ متوقف'}\n` +
            `- عدد القنوات المطلوبة: ${requiredChannels.length}\n` +
            `- القنوات: ${requiredChannels.map(ch => '@' + ch).join(', ')}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🔄 تبديل حالة البوت', 'toggle_bot_status')],
                [Markup.button.callback('📺 إدارة القنوات', 'manage_channels')],
                [Markup.button.callback('🔙 رجوع', 'admin_panel')]
            ])
        );
    } catch (e) {
        // Silent error handling
    }
});

// --- Toggle Bot Status ---
bot.action('toggle_bot_status', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const config = await readDb('config.json');
        config.botOnline = !config.botOnline;
        await writeDb('config.json', config);
        
        await ctx.editMessageText(
            `✅ تم ${config.botOnline ? 'تشغيل' : 'إيقاف'} البوت ${config.botOnline ? '✅' : '❌'}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🔙 رجوع', 'admin_settings')]
            ])
        );
    } catch (e) {
        // Silent error handling
    }
});

// --- Manage Channels ---
bot.action('manage_channels', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        
        await ctx.editMessageText(
            `📺 إدارة القنوات:\n\n` +
            `القنوات الحالية:\n${requiredChannels.map((ch, i) => `${i + 1}. @${ch}`).join('\n')}\n\n` +
            `إجمالي القنوات: ${requiredChannels.length}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('➕ إضافة قناة', 'add_channel')],
                [Markup.button.callback('➖ حذف قناة', 'remove_channel')],
                [Markup.button.callback('🔙 رجوع', 'admin_settings')]
            ])
        );
    } catch (e) {
        // Silent error handling
    }
});

// --- Add Channel ---
bot.action('add_channel', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.scene.enter('add-channel-scene');
    } catch (e) {
        // Silent error handling
    }
});

// --- Remove Channel ---
bot.action('remove_channel', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.scene.enter('remove-channel-scene');
    } catch (e) {
        // Silent error handling
    }
});

// --- Admin Server Management ---
bot.action('admin_servers', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            '📦 إدارة السيرفرات',
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('➕ إضافة سيرفر', 'admin_add_server'),
                    Markup.button.callback('➖ حذف سيرفر', 'admin_remove_server')
                ],
                [Markup.button.callback('📜 عرض كل السيرفرات', 'admin_all_servers')],
                [Markup.button.callback('🔙 رجوع', 'admin_panel')]
            ])
        );
    } catch (e) {
        // Silent error handling
    }
});

bot.action('admin_add_server', (ctx) => ctx.scene.enter('admin-add-server-wizard'));
bot.action('admin_remove_server', (ctx) => ctx.scene.enter('admin-remove-server-wizard'));

const showAllServers = async (ctx, page = 1) => {
    const servers = await Servers.find({});
    const perPage = 10;
    const totalPages = Math.ceil(servers.length / perPage);
    const paginatedServers = servers.slice((page - 1) * perPage, page * perPage);

    let list = '📜 قائمة السيرفرات:\n\n';
    if (paginatedServers.length > 0) {
        list += paginatedServers.map((s, i) => `${(page - 1) * perPage + i + 1}. ${s.name} - ${s.ip}:${s.port}`).join('\n');
    } else {
        list += 'لا يوجد سيرفرات.';
    }

    const buttons = [];
    if (page > 1) {
        buttons.push(Markup.button.callback('◀️ السابق', `servers_page_${page - 1}`));
    }
    if (page < totalPages) {
        buttons.push(Markup.button.callback('▶️ التالي', `servers_page_${page + 1}`));
    }

    await ctx.editMessageText(
        list,
        Markup.inlineKeyboard([
            buttons,
            [Markup.button.callback('🔙 رجوع', 'admin_servers')]
        ])
    );
};

bot.action(/servers_page_(\d+)/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await showAllServers(ctx, page);
});

bot.action('admin_all_servers', async (ctx) => {
    await ctx.answerCbQuery();
    await showAllServers(ctx);
});

// --- Text Message Handling ---
bot.on('text', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const text = ctx.message.text;

        // Clear console command
        if (text === '/clear') {
            // Silent clear
            return ctx.reply('✅ تم مسح الكونسول.');
        }

        if (userStates[userId] === 'awaiting_server') {
            const parts = text.split(':');
            if (parts.length !== 2) {
                return ctx.reply('❗ تأكد من الشكل: host:port');
            }

            const host = parts[0].trim();
            const port = parseInt(parts[1].trim());

            if (isNaN(port)) {
                return ctx.reply('❗ البورت يجب أن يكون رقم.');
            }

            servers[userId] = { host, port };
            saveServers();
            delete userStates[userId];

            ctx.reply(`✅ تم حفظ السيرفر:\n🌐 الهوست: ${host}\n🔌 البورت: ${port}`);
        }
        // معالج تغيير اسم البوت الثاني
        else if (userStates[userId] === 'awaiting_bot_name') {
            const newName = text.trim();
            
            if (newName.length < 2 || newName.length > 15) {
                ctx.reply('❗ الاسم يجب أن يكون بين 2 و 15 حرفاً.');
                return;
            }

            // تحديث اسم البوت الثاني للمستخدم فقط
            await BotNames.updateForUser(userId, { secondBot: newName });
            delete userStates[userId];
            
            ctx.reply(`✅ تم تغيير اسم البوت الثاني الخاص بك إلى:\n**${newName}**`);
        }
        // أوامر الأدمن
        else if (await Admins.isAdmin(ctx.from.id)) {
            if (text.startsWith('/broadcast ')) {
                const message = text.replace('/broadcast ', '');
                if (!message) return ctx.reply('❗ أرسل الرسالة مع الأمر.');

                ctx.reply('🚀 جارٍ إرسال الرسالة إلى كل المستخدمين...');

                let sentCount = 0;
                for (let uid of users) {
                    try {
                        await bot.telegram.sendMessage(uid, message);
                        sentCount++;
                        await new Promise(r => setTimeout(r, 50));
                    } catch (err) {
                        // Silent error handling
                    }
                }

                return ctx.reply(`✅ تم إرسال الإذاعة إلى ${sentCount} مستخدم.`);
            }
            else if (text === '/stats') {
                const userCount = users.length;
                const activeBotsCount = Object.keys(clients).length;
                const serversCount = Object.keys(servers).length;
                const microsoftAccountsCount = Object.keys(microsoftAccounts).length;

                ctx.reply(`📊 لوحة تحكم الادمن:

👥 عدد المستخدمين: ${userCount}
🟢 البوتات الشغالة حاليًا: ${activeBotsCount}
🖥️ السيرفرات المضافة: ${serversCount}
🔐 الحسابات المحفوظة: ${microsoftAccountsCount}`);
            }
            else if (text === '/channels') {
                const channelsList = requiredChannels.map((ch, index) => `${index + 1}. @${ch}`).join('\n');
                const message = `📺 قائمة القنوات المطلوبة حاليًا:

${channelsList}

📊 العدد الإجمالي: ${requiredChannels.length} قناة`;

                ctx.reply(message);
            }
            else if (text.startsWith('/addchannel ')) {
                const channelName = ctx.message.text.replace('/addchannel ', '').replace('@', '').trim();

                if (!channelName) {
                    return ctx.reply('❗ استخدم الأمر بهذا الشكل:\n/addchannel @اسم_القناة');
                }

                if (requiredChannels.includes(channelName)) {
                    return ctx.reply(`❗ القناة @${channelName} موجودة مسبقًا في القائمة.`);
                }

                requiredChannels.push(channelName);
                ctx.reply(`✅ تم إضافة القناة @${channelName} بنجاح!\n📊 العدد الإجمالي: ${requiredChannels.length} قناة`);
            }
            else if (text.startsWith('/removechannel ')) {
                const channelName = ctx.message.text.replace('/removechannel ', '').replace('@', '').trim();

                if (!channelName) {
                    return ctx.reply('❗ استخدم الأمر بهذا الشكل:\n/removechannel @اسم_القناة');
                }

                const channelIndex = requiredChannels.indexOf(channelName);

                if (channelIndex === -1) {
                    return ctx.reply(`❗ القناة @${channelName} غير موجودة في القائمة.`);
                }

                requiredChannels.splice(channelIndex, 1);
                ctx.reply(`🗑️ تم حذف القناة @${channelName} بنجاح!\n📊 العدد الإجمالي: ${requiredChannels.length} قناة`);
            }
        }
    } catch (error) {
        // Silent error handling
    }
});

// --- Bot Functions ---
function stopUserBots(userId) {
    try {
        // Stop main client
        if (clients[userId]) {
            try {
                clients[userId].end();
            } catch (error) {
                // Silent error handling
            }
            delete clients[userId];
        }

        // Stop reconnection interval
        if (intervals[userId]) {
            clearInterval(intervals[userId]);
            delete intervals[userId];
        }

        // Stop spam interval for main bot
        if (spamIntervals[userId]) {
            clearInterval(spamIntervals[userId]);
            delete spamIntervals[userId];
        }

        // Stop all additional bots for this user
        for (let key of Object.keys(clients)) {
            if (key.startsWith(userId + '_')) {
                try {
                    clients[key].end();
                } catch (error) {
                    // Silent error handling
                }
                delete clients[key];

                if (spamIntervals[key]) {
                    clearInterval(spamIntervals[key]);
                    delete spamIntervals[key];
                }
            }
        }

        // إيقاف المراقبة
        if (intervals[`monitor_${userId}`]) {
            clearInterval(intervals[`monitor_${userId}`]);
            delete intervals[`monitor_${userId}`];
        }
        
        if (intervals[`refresh_${userId}`]) {
            clearInterval(intervals[`refresh_${userId}`]);
            delete intervals[`refresh_${userId}`];
        }
    } catch (error) {
        // Silent error handling
    }
}

function generateBotName() {
    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    return 'MUF' + randomNum;
}

bot.action('add_bot', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const now = Date.now();
        const lastPress = botCooldowns.get(userId) || 0;

        if (now - lastPress < 5000) {
            return ctx.answerCbQuery('⏳ انتظر 5 ثواني قبل الضغط مرة أخرى', { show_alert: true });
        }

        botCooldowns.set(userId, now);

        if (!servers[userId]) return ctx.reply('❗ أضف السيرفر أولاً.');

        const { host, port } = servers[userId];
        const version = userVersions[userId] || '1.21.93';
        const botName = generateBotName();

        try {
            const client = createClient({
                host,
                port,
                username: botName,
                version,
                offline: true,
                connectTimeout: 10000,
            });

            // Suppress all client logs for additional bots
            client.on('packet', () => {});
            client.on('raw', () => {});

            const clientKey = `${userId}_${botName}`;
            clients[clientKey] = client;

            client.on('join', () => {
                bot.telegram.sendMessage(userId, `✅ تم دخول بوت إضافي: ${botName}`).catch(() => {});

                if (spamIntervals[clientKey]) {
                    clearInterval(spamIntervals[clientKey]);
                }
                spamIntervals[clientKey] = setInterval(() => {
                    try {
                        if (client.connected) {
                            // Simulate real player movement
                            client.queue('move_player', {
                                runtime_id: client.entityId,
                                position: {
                                    x: Math.random() * 20,
                                    y: 64,
                                    z: Math.random() * 20
                                },
                                pitch: Math.random() * 90,
                                yaw: Math.random() * 360,
                                head_yaw: Math.random() * 360,
                                mode: 0,
                                on_ground: true,
                                ridden_runtime_id: 0,
                                teleport_cause: 0,
                                teleport_item: 0
                            });

                            // Random chat messages like real player
                            const messages = ['gg', 'nice build', 'cool world', 'fun server', 'awesome', 'great!'];
                            const randomMessage = messages[Math.floor(Math.random() * messages.length)];

                            client.queue('text', {
                                type: 'chat',
                                needs_translation: false,
                                source_name: botName,
                                message: randomMessage,
                                xuid: '',
                                platform_chat_id: '',
                            });
                        }
                    } catch (err) {
                        // Silent spam error
                    }
                }, Math.random() * 35000 + 25000);
            });

            client.on('disconnect', (reason) => {
                bot.telegram.sendMessage(userId, `❌ تم فصل البوت الإضافي: ${botName}`).catch(() => {});

                if (spamIntervals[clientKey]) {
                    clearInterval(spamIntervals[clientKey]);
                    delete spamIntervals[clientKey];
                }
                delete clients[clientKey];
            });

            client.on('error', (err) => {
                if (spamIntervals[clientKey]) {
                    clearInterval(spamIntervals[clientKey]);
                    delete spamIntervals[clientKey];
                }
                delete clients[clientKey];
            });

        } catch (error) {
            // Silent error handling
            ctx.reply('❌ فشل في إنشاء البوت الإضافي.');
        }
    } catch (error) {
        // Silent error handling
    }
});

// --- Handle process termination gracefully ---
process.on('SIGINT', () => {
    Object.values(clients).forEach(client => {
        try {
            client.end();
        } catch (error) {
            // Silent error handling
        }
    });

    Object.values(intervals).forEach(interval => {
        clearInterval(interval);
    });

    Object.values(spamIntervals).forEach(interval => {
        clearInterval(interval);
    });

    process.exit(0);
});

process.on('uncaughtException', () => {
    // Silent error handling
});

process.on('unhandledRejection', () => {
    // Silent error handling
});

// --- Bot Launch ---
setupInitialConfig().then(() => {
    bot.launch().then(() => {
        // Silent startup
    }).catch(err => {
        // Silent error handling
    });
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
