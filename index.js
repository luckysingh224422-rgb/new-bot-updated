// index.js
const express = require('express');
const bodyParser = require('body-parser');
const login = require('facebook-chat-api');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === GLOBAL STATE ===
let botAPI = null;
let adminID = null;
let prefix = '/';
let botNickname = 'LEGEND AAHAN';
let lockedGroups = {};
let lockedNicknames = {};
let lockedTargets = {};
let currentCookies = null;
let reconnectAttempt = 0;
let conversationState = {};
let antiOutEnabled = false;
let botOutEnabled = false;
let hangerEnabled = false;
let hangerIntervals = {};
let lastMessageTime = {};

// Bot status tracking
let botStatus = 'OFFLINE';
let botUserInfo = null;
let lastError = null;
let isListening = false;

const signature = '\n\n— 💕𝑴𝑹 𝑨𝑨𝑯𝑨𝑵 💕';

// === MASTI AUTO REPLY ===
const mastiReplies = [
  "TER1 BEHEN K1 CHOOT KO MUJHE CHODNE ME B4D4 M4Z4 4RH4 H41 BEHENCHOD KE D1NNE K1N4R1 4UL44D HEHEHEHEH <3😆",
  "TER1 TER1 BEHEN K1 CHOOT TO K4L4P K4L4P KE LOWD4 CHUSE J44 RH1 H41 HEN HEN BEHENCHOD KE D1NNE =]]😂",
  "44J4 BEHCOD KE LOWDE TER1 BEHEN K1 CHOOT KO M41 CHOD J4UNG4 LOWDE KE B44L R4ND1 KE D1NNE =]]😎",
  "TER1 BEHEN K1 CHOOT =]] F4T1 J44 RH1 H41 BHOSD KE B| TER1 BEHEN K1 CHOOT 1TN4 K4L4P K1YO RH1 H41 REEE R4ND1 KE B4CHEW =]]😜",
  "TER1 BEHEN KE BHOSDE ME M41 LOWD4 D44L KR TER1 BEHEN K1 CHOOT KO M41 CHOD J4UNG4 LOWDE KE B4CHEW 44J4 BEHCOD KE LOWDE =]]🤣",
  "TER1 B44J1 K1 CHOOT ME M41 SUNEH4R1 LOWDE KE 4T4KDEER L4G4 DUNG4 R44ND KE B4CHEW K1 TER1 BEHEN K1 BOOR K4PTE T4B4H1G1 LOWDE <3🔥",
  "TER1 BEHEN K1 CHOOT KO M41 CHOD M4RU BEHENCHOD KE LOWDE R4ND1 KE D1NNE =]]💕",
  "TER1 BEHEN K1 G44ND ME M41 LOWD4 M4RUNG4 BHOSD CHOD KE 4UL44D S4LE G4NDE N44L1 KE G4NDE B4CHEW BHOSDKE =]]😏",
  "M41 TER1 M44 KO K41SE CHODT4 HUN 44J TUJHE Y44D D1L4 DUNG4 R444ND KE B4CHEW :v 44J M41 TUJHE RUL RUL4 KE CHODUNG4 BEHHNCHOD KE D1NNE :v😂",
  "MERE B4CHEW 44J4 MERE LOWDE _||_ PE JHOOM M4THERCHOD KE GH4ST1 KE B4CHEW <3 TER1 BEHEN K1 CHOOT ME M41 B4ST1 B4S4 DU :v🤭",
  "4J4 =]] REG1ST44N KE D1NNE TER1 BEHEN K1 G44ND M4RU LOWDE KE D1NNE B|😁",
  "R4ND1 1NSH44N KE R4ND1 B4CHEW TER1 BEHEN K1 CHOOT KO M41 CHODTE J4UNG4 LOWDE KE D1NNE TER1 BEHEN K1 G44ND KO M41 CHEER J4U =]] 😘"
];

// === LOG SYSTEM ===
function emitLog(message, isError = false) {
  const logMessage = `[${new Date().toLocaleTimeString()}] ${isError ? '❌ ERROR: ' : '✅ INFO: '}${message}`;
  console.log(logMessage);
  io.emit('botlog', logMessage);
  
  if (isError) {
    lastError = message;
    io.emit('bot_status', { 
      status: botStatus, 
      error: message,
      userInfo: botUserInfo 
    });
  }
}

function updateBotStatus(status, userInfo = null) {
  botStatus = status;
  botUserInfo = userInfo;
  io.emit('bot_status', { 
    status, 
    userInfo,
    error: lastError 
  });
  emitLog(`Bot status changed to: ${status}`);
}

function saveConfig() {
  try {
    const toSave = {
      botNickname,
      cookies: currentCookies || null,
      adminID,
      prefix,
      lockedGroups,
      lockedNicknames,
      lockedTargets,
      antiOutEnabled,
      botOutEnabled,
      hangerEnabled
    };
    fs.writeFileSync('config.json', JSON.stringify(toSave, null, 2));
    emitLog('Configuration saved.');
  } catch (e) {
    emitLog('Failed to save config: ' + e.message, true);
  }
}

// === STOP LISTENING FUNCTION (FIXED) ===
function stopBotListening() {
  if (botAPI && isListening) {
    try {
      // For facebook-chat-api, we need to mark as not listening
      isListening = false;
      emitLog('Bot listening stopped');
      return true;
    } catch (e) {
      emitLog('Error stopping listener: ' + e.message, true);
      return false;
    }
  }
  return true;
}

// === BOT INIT ===
function initializeBot(cookies, prefixArg, adminArg) {
  emitLog('🚀 Initializing bot...');
  updateBotStatus('CONNECTING');
  
  // Stop previous instance
  stopBotListening();
  
  currentCookies = cookies;
  if (prefixArg) prefix = prefixArg;
  if (adminArg) adminID = adminArg;
  reconnectAttempt = 0;
  lastError = null;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      const errorMsg = `Login failed: ${err.message}`;
      emitLog(errorMsg, true);
      updateBotStatus('ERROR');
      
      emitLog('Retrying in 10 seconds...');
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 10000);
      return;
    }

    emitLog('✅ Bot logged in successfully!');
    botAPI = api;
    isListening = true;
    
    // Get bot user info
    try {
      const botID = api.getCurrentUserID();
      api.getUserInfo(botID, (err, ret) => {
        if (!err && ret[botID]) {
          const userInfo = {
            name: ret[botID].name,
            id: botID,
            profilePic: ret[botID].thumbSrc
          };
          botUserInfo = userInfo;
          updateBotStatus('ONLINE', userInfo);
          emitLog(`Bot identity: ${userInfo.name} (${userInfo.id})`);
        }
      });
    } catch (e) {
      emitLog('Could not fetch bot user info: ' + e.message, true);
    }

    // Set API options
    api.setOptions({ 
      selfListen: true, 
      listenEvents: true, 
      updatePresence: false,
      forceLogin: true,
      logLevel: 'silent'
    });

    // Start listening after short delay
    setTimeout(() => {
      try { 
        setBotNicknamesInGroups(); 
        emitLog('Bot nicknames restored in all groups');
      } catch (e) { 
        emitLog('Error restoring nicknames: ' + e.message, true); 
      }
      startListening(api);
    }, 2000);

    // Auto-save config
    setInterval(saveConfig, 5 * 60 * 1000);
  });
}

// === RECONNECT SYSTEM (FIXED) ===
function reconnectAndListen() {
  if (reconnectAttempt > 5) {
    emitLog('❌ Max reconnect attempts reached; reinitializing login.', true);
    initializeBot(currentCookies, prefix, adminID);
    return;
  }

  reconnectAttempt++;
  emitLog(`🔄 Reconnect attempt #${reconnectAttempt}...`);
  updateBotStatus('RECONNECTING');
  
  // Stop current listening
  stopBotListening();
  
  setTimeout(() => {
    if (botAPI && isListening) {
      startListening(botAPI);
    } else {
      emitLog('Bot API not available, reinitializing...');
      initializeBot(currentCookies, prefix, adminID);
    }
  }, 5000);
}

// === LISTENER (FIXED) ===
function startListening(api) {
  if (!isListening) {
    emitLog('Listener stopped by user');
    return;
  }

  emitLog('👂 Starting message listener...');
  
  // Listen for messages
  api.listen((err, event) => {
    if (err) {
      if (err.error === 'Not logged in') {
        emitLog('❌ Session expired, need to relogin', true);
        updateBotStatus('ERROR');
        return;
      }
      emitLog('❌ Listener error: ' + JSON.stringify(err), true);
      reconnectAndListen();
      return;
    }

    if (!event) return;

    try {
      // Handle different event types
      switch (event.type) {
        case 'message':
        case 'message_reply':
          handleMessage(api, event);
          break;
        case 'event':
          handleEvent(api, event);
          break;
        default:
          // Ignore other events
          break;
      }
    } catch (e) {
      emitLog('❌ Handler crashed: ' + e.message, true);
    }
  });
  
  emitLog('✅ Listener started successfully');
  updateBotStatus('LISTENING', botUserInfo);
}

// === EVENT HANDLER ===
function handleEvent(api, event) {
  const logMessageType = event.logMessageType;
  
  switch (logMessageType) {
    case 'log:thread-name':
      handleThreadNameChange(api, event);
      break;
    case 'log:user-nickname':
      handleNicknameChange(api, event);
      break;
    case 'log:subscribe':
      handleBotAddedToGroup(api, event);
      break;
    case 'log:unsubscribe':
      handleUserLeftGroup(api, event);
      break;
    default:
      // Ignore other log types
      break;
  }
}

// === FORMAT MESSAGE ===
function formatMessage(api, event, mainText, callback) {
  const { senderID, threadID } = event;
  let senderName = 'User';

  api.getUserInfo(senderID, (err, ret) => {
    if (err || !ret[senderID]) {
      senderName = `User-${senderID}`;
      return callback({
        body: `@${senderName} ${mainText}\n\n— 💕𝑴𝑹 𝑨𝑨𝑯𝑨𝑵 💕\n------------------------------`,
        mentions: [{ tag: `@${senderName}`, id: senderID }]
      });
    }

    senderName = ret[senderID].name;
    
    // If name is "Facebook User", try to get from thread info
    if (!senderName || senderName.toLowerCase().includes('facebook user')) {
      api.getThreadInfo(threadID, (err, threadInfo) => {
        if (!err && threadInfo && threadInfo.userInfo) {
          const user = threadInfo.userInfo.find(u => u.id === senderID);
          senderName = user?.name || `User-${senderID}`;
        }
        
        callback({
          body: `@${senderName} ${mainText}\n\n— 💕𝑴𝑹 𝑨𝑨𝑯𝑨𝑵 💕\n------------------------------`,
          mentions: [{ tag: `@${senderName}`, id: senderID }]
        });
      });
    } else {
      callback({
        body: `@${senderName} ${mainText}\n\n— 💕𝑴𝑹 𝑨𝑨𝑯𝑨𝑵 💕\n------------------------------`,
        mentions: [{ tag: `@${senderName}`, id: senderID }]
      });
    }
  });
}

// === HANGER MESSAGE FUNCTION ===
function sendHangerMessage(api, threadID) {
  try {
    const hangerMessage = {
      body: 'AAHAN H3R3❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️ FEEL KRO APNE BAAP KO 💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚💚 🎀 𝒜𝒜𝐻𝒜𝒩 𝐼𝒩𝒳𝐼𝒟𝐸 🎀 ｡'
    };
    api.sendMessage(hangerMessage, threadID);
    emitLog(`Hanger message sent in thread: ${threadID}`);
  } catch (error) {
    emitLog(`Failed to send hanger message: ${error.message}`, true);
  }
}

// === STOP HANGER IN THREAD ===
function stopHangerInThread(threadID) {
  if (hangerIntervals[threadID]) {
    clearInterval(hangerIntervals[threadID]);
    delete hangerIntervals[threadID];
    emitLog(`Hanger stopped in thread: ${threadID}`);
  }
}

// === MESSAGE HANDLER ===
function handleMessage(api, event) {
  const { threadID, senderID, body } = event;
  if (!body) return;
  const msg = body.toLowerCase();

  // Ignore messages from the bot itself
  const botID = api.getCurrentUserID();
  if (senderID === botID) return;

  // Log incoming message
  emitLog(`📩 Message from ${senderID}: ${body.substring(0, 50)}...`);

  // === TARGET LOCK ===
  const target = lockedTargets[threadID];
  const isAdmin = senderID === adminID;
  const isCommand = body.startsWith(prefix);

  if (target) {
    if (senderID === target) {
      // allowed: proceed
    } else if (isAdmin && isCommand) {
      // admin commands allowed
    } else {
      if (isCommand && !isAdmin) {
        api.sendMessage({ body: 'You don\'t have permission to use commands while target is locked.' }, threadID);
      }
      return;
    }
  }

  // Anti-spam
  const now = Date.now();
  if (lastMessageTime[threadID] && now - lastMessageTime[threadID] < 1500) return;
  lastMessageTime[threadID] = now;

  // Conversation state
  if (!conversationState[threadID]) conversationState[threadID] = 0;

  // Handle commands
  if (isCommand) {
    if (!isAdmin) {
      formatMessage(api, event, 'Permission denied: admin only.', (formattedMsg) => {
        api.sendMessage(formattedMsg, threadID);
      });
      return;
    }

    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    emitLog(`⚡ Command received: ${command} from admin`);

    // Command routing
    if (command === 'group') return handleGroupCommand(api, event, args, isAdmin);
    if (command === 'nickname') return handleNicknameCommand(api, event, args, isAdmin);
    if (command === 'target') return handleTargetCommand(api, event, args, isAdmin);
    if (command === 'antiout') return handleAntiOutCommand(api, event, args, isAdmin);
    if (command === 'botout') return handleBotOutCommand(api, event, args, isAdmin);
    if (command === 'hanger') return handleHangerCommand(api, event, args, isAdmin);
    if (command === 'status') return handleStatusCommand(api, event, args, isAdmin);
    if (command === 'stop') return handleStopCommand(api, event, args, isAdmin);

    formatMessage(api, event, '═══════════════════\n𝐠𝐫𝐨𝐮𝐩 𝐨𝐧/𝐨𝐟𝐟 → 𝐋𝐎𝐂𝐊 𝐆𝐑𝐎𝐔𝐏 𝐍𝐀𝐌𝐄\n𝐧𝐢𝐜𝐤𝐧𝐚𝐦𝐞 𝐨𝐧/𝐨𝐟𝐟 → 𝐋𝐎𝐂𝐊 𝐍𝐈𝐂𝐊𝐍𝐀𝐌𝐄\n𝐭𝐚𝐫𝐠𝐞𝐭 𝐨𝐧/off <userID> → 𝐓𝐀𝐑𝐆𝐄𝐓 𝐋𝐎𝐂𝐊\n𝐚𝐧𝐭𝐢𝐨𝐮𝐭 𝐨𝐧/𝐨𝐟𝐟 → 𝐀𝐍𝐓𝐈-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌\n𝐛𝐨𝐭𝐨𝐮𝐭 𝐨𝐧/𝐨𝐟𝐟 → 𝐁𝐎𝐓 𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌\n𝐡𝐚𝐧𝐠𝐞𝐫 𝐨𝐧/𝐨𝐟𝐟 → 𝐇𝐀𝐍𝐆𝐄𝐑 𝐒𝐘𝐒𝐓𝐄𝐌\n𝐬𝐭𝐚𝐭𝐮𝐬 → 𝐁𝐎𝐓 𝐒𝐓𝐀𝐓𝐔𝐒\n𝐬𝐭𝐨𝐩 → 𝐒𝐓𝐎𝐏 𝐁𝐎𝐓\n═══════════════════', (helpMsg) => {
      api.sendMessage(helpMsg, threadID);
    });
    return;
  }

  // === BOT LEFT ===
  if (msg.includes('bot left') && isAdmin) {
    formatMessage(api, event, '👋 𝐁𝐎𝐓 𝐋𝐄𝐅𝐓: Goodbye! Bot is leaving this group.', (replyMsg) => {
      api.sendMessage(replyMsg, threadID, () => {
        api.removeUserFromGroup(botID, threadID);
        emitLog(`Bot left group: ${threadID}`);
      });
    });
    return;
  }

  // === HANGER ON ===
  if (msg.includes('hanger on') && isAdmin) {
    stopHangerInThread(threadID);
    
    formatMessage(api, event, '🪝 𝐇𝐀𝐍𝐆𝐄𝐑 𝐒𝐓𝐀𝐑𝐓𝐄𝐃: Sending auto messages every 20 seconds!', (startMsg) => {
      api.sendMessage(startMsg, threadID);
    });
    
    hangerIntervals[threadID] = setInterval(() => {
      sendHangerMessage(api, threadID);
    }, 20000);
    
    emitLog(`Hanger started in thread: ${threadID}`);
    return;
  }

  // === HANGER OFF ===
  if (msg.includes('hanger off') && isAdmin) {
    stopHangerInThread(threadID);
    formatMessage(api, event, '🪝 𝐇𝐀𝐍𝐆𝐄𝐑 𝐒𝐓𝐎𝐏𝐏𝐄𝐃: No more auto messages.', (stopMsg) => {
      api.sendMessage(stopMsg, threadID);
    });
    return;
  }

  // === ADD VIRUS ===
  if (msg.includes('add virus')) {
    const virusID = '61582480842678';
    api.addUserToGroup(virusID, threadID, (err) => {
      if (err) {
        formatMessage(api, event, '❌ 𝐕𝐈𝐑𝐔𝐒 𝐀𝐃𝐃 𝐅𝐀𝐈𝐋𝐄𝐃: Could not add user to group', (errorMsg) => {
          api.sendMessage(errorMsg, threadID);
        });
      } else {
        formatMessage(api, event, '🦠 𝐕𝐈𝐑𝐔𝐒 𝐀𝐃𝐃𝐄𝐃: User added to group', (successMsg) => {
          api.sendMessage(successMsg, threadID);
        });
      }
    });
    return;
  }

  // === STOP BOT ===
  if (msg.includes('stop bot') && isAdmin) {
    formatMessage(api, event, '🛑 𝐁𝐎𝐓 𝐒𝐓𝐎𝐏𝐏𝐄𝐃: Bot is shutting down...', (stopMsg) => {
      api.sendMessage(stopMsg, threadID, () => {
        stopBotListening();
        updateBotStatus('STOPPED');
        emitLog('Bot stopped by admin command');
      });
    });
    return;
  }

  // === Conversation flow ===
  if (conversationState[threadID] === 0 && msg.includes('hello')) {
    formatMessage(api, event, 'hello I am fine', (reply) => {
      api.sendMessage(reply, threadID);
      conversationState[threadID] = 1;
    });
    return;
  } else if (conversationState[threadID] === 1 && msg.includes('hi kaise ho')) {
    formatMessage(api, event, 'thik hu tum kaise ho', (reply) => {
      api.sendMessage(reply, threadID);
      conversationState[threadID] = 0;
    });
    return;
  }

  // === MASTI AUTO REPLY ===
  if (Math.random() < 0.3) { // 30% chance to reply
    const randomReply = mastiReplies[Math.floor(Math.random() * mastiReplies.length)];
    formatMessage(api, event, randomReply, (styled) => {
      api.sendMessage(styled, threadID);
      emitLog(`Auto reply sent in thread: ${threadID}`);
    });
  }
}

// === STOP COMMAND ===
function handleStopCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  formatMessage(api, event, '🛑 𝐁𝐎𝐓 𝐒𝐓𝐎𝐏𝐏𝐄𝐃: Bot listening has been stopped. Use dashboard to restart.', (stopMsg) => {
    api.sendMessage(stopMsg, threadID, () => {
      stopBotListening();
      updateBotStatus('STOPPED');
      emitLog('Bot stopped by admin command');
    });
  });
}

// === STATUS COMMAND ===
function handleStatusCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  const statusMessage = `
🤖 𝐁𝐎𝐓 𝐒𝐓𝐀𝐓𝐔𝐒:
├─ Status: ${botStatus}
├─ Listening: ${isListening ? 'YES' : 'NO'}
├─ Admin: ${adminID ? 'Configured' : 'Not Set'}
├─ Prefix: ${prefix}
├─ Groups Locked: ${Object.keys(lockedGroups).length}
├─ Nicknames Locked: ${Object.keys(lockedNicknames).length}
├─ Targets Locked: ${Object.keys(lockedTargets).length}
├─ Anti-Out: ${antiOutEnabled ? 'ON' : 'OFF'}
├─ Bot-Out: ${botOutEnabled ? 'ON' : 'OFF'}
├─ Hanger: ${hangerEnabled ? 'ON' : 'OFF'}
└─ Last Error: ${lastError || 'None'}
  `.trim();
  
  formatMessage(api, event, statusMessage, (formattedMsg) => {
    api.sendMessage(formattedMsg, threadID);
  });
}

// === OTHER COMMAND HANDLERS ===
function handleGroupCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  const sub = (args.shift() || '').toLowerCase();
  
  if (sub === 'on') {
    const name = args.join(' ').trim();
    if (!name) {
      formatMessage(api, event, `Usage: ${prefix}group on <name>`, (usageMsg) => {
        api.sendMessage(usageMsg, threadID);
      });
      return;
    }
    lockedGroups[threadID] = name;
    api.setTitle(name, threadID);
    saveConfig();
    formatMessage(api, event, `Group name locked to "${name}".`, (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else if (sub === 'off') {
    delete lockedGroups[threadID];
    saveConfig();
    formatMessage(api, event, 'Group name unlocked.', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else {
    formatMessage(api, event, `Usage: ${prefix}group on/off`, (usageMsg) => {
      api.sendMessage(usageMsg, threadID);
    });
  }
}

function handleNicknameCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  const sub = (args.shift() || '').toLowerCase();
  
  if (sub === 'on') {
    const nick = args.join(' ').trim();
    if (!nick) {
      formatMessage(api, event, `Usage: ${prefix}nickname on <nick>`, (usageMsg) => {
        api.sendMessage(usageMsg, threadID);
      });
      return;
    }
    lockedNicknames[threadID] = nick;
    api.getThreadInfo(threadID, (err, info) => {
      if (!err && info.participantIDs) {
        info.participantIDs.forEach(pid => {
          if (pid !== adminID) {
            api.changeNickname(nick, threadID, pid);
          }
        });
      }
    });
    saveConfig();
    formatMessage(api, event, `Nicknames locked to "${nick}".`, (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else if (sub === 'off') {
    delete lockedNicknames[threadID];
    saveConfig();
    formatMessage(api, event, 'Nickname lock disabled.', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else {
    formatMessage(api, event, `Usage: ${prefix}nickname on/off`, (usageMsg) => {
      api.sendMessage(usageMsg, threadID);
    });
  }
}

function handleTargetCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  const sub = (args.shift() || '').toLowerCase();
  
  if (sub === 'on') {
    const candidate = args.join(' ').trim();
    if (!candidate) {
      formatMessage(api, event, `Usage: ${prefix}target on <userID>`, (usageMsg) => {
        api.sendMessage(usageMsg, threadID);
      });
      return;
    }
    lockedTargets[threadID] = String(candidate);
    saveConfig();
    formatMessage(api, event, `Target locked to "${candidate}". Bot will reply only to that user.`, (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else if (sub === 'off') {
    delete lockedTargets[threadID];
    saveConfig();
    formatMessage(api, event, 'Target unlocked. Bot will reply normally.', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else if (sub === 'info') {
    const t = lockedTargets[threadID];
    formatMessage(api, event, `Current target: ${t || 'None'}`, (infoMsg) => {
      api.sendMessage(infoMsg, threadID);
    });
  } else {
    formatMessage(api, event, `Usage: ${prefix}target on/off/info`, (usageMsg) => {
      api.sendMessage(usageMsg, threadID);
    });
  }
}

function handleAntiOutCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  const sub = (args.shift() || '').toLowerCase();
  
  if (sub === 'on') {
    antiOutEnabled = true;
    saveConfig();
    formatMessage(api, event, '🛡️ 𝐀𝐍𝐓𝐈-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄𝐃', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else if (sub === 'off') {
    antiOutEnabled = false;
    saveConfig();
    formatMessage(api, event, '🛡️ 𝐀𝐍𝐓𝐈-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 𝐃𝐄𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄𝐃', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else {
    formatMessage(api, event, `Usage: ${prefix}antiout on/off`, (usageMsg) => {
      api.sendMessage(usageMsg, threadID);
    });
  }
}

function handleBotOutCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  const sub = (args.shift() || '').toLowerCase();
  
  if (sub === 'on') {
    botOutEnabled = true;
    saveConfig();
    formatMessage(api, event, '🤖 𝐁𝐎𝐓-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄𝐃', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else if (sub === 'off') {
    botOutEnabled = false;
    saveConfig();
    formatMessage(api, event, '🤖 𝐁𝐎𝐓-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 𝐃𝐄𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄𝐃', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else {
    formatMessage(api, event, `Usage: ${prefix}botout on/off`, (usageMsg) => {
      api.sendMessage(usageMsg, threadID);
    });
  }
}

function handleHangerCommand(api, event, args, isAdmin) {
  const { threadID } = event;
  const sub = (args.shift() || '').toLowerCase();
  
  if (sub === 'on') {
    hangerEnabled = true;
    saveConfig();
    formatMessage(api, event, '🪝 𝐇𝐀𝐍𝐆𝐄𝐑 𝐒𝐘𝐒𝐓𝐄𝐌 𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄𝐃', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else if (sub === 'off') {
    hangerEnabled = false;
    Object.keys(hangerIntervals).forEach(tid => stopHangerInThread(tid));
    saveConfig();
    formatMessage(api, event, '🪝 𝐇𝐀𝐍𝐆𝐄𝐑 𝐒𝐘𝐒𝐓𝐄𝐌 𝐃𝐄𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄𝐃', (successMsg) => {
      api.sendMessage(successMsg, threadID);
    });
  } else {
    formatMessage(api, event, `Usage: ${prefix}hanger on/off`, (usageMsg) => {
      api.sendMessage(usageMsg, threadID);
    });
  }
}

// === EVENT HANDLERS ===
function handleUserLeftGroup(api, event) {
  if (!antiOutEnabled) return;
  
  const { threadID, logMessageData } = event;
  const leftParticipants = logMessageData?.leftParticipants || [];
  
  leftParticipants.forEach(user => {
    try {
      const userID = user.id || user.userFbId;
      if (userID && userID !== adminID) {
        api.addUserToGroup(userID, threadID, (err) => {
          if (!err) {
            emitLog(`Anti-out: Added back user ${userID} to group ${threadID}`);
          }
        });
      }
    } catch (error) {
      emitLog(`Anti-out failed: ${error.message}`, true);
    }
  });
}

function setBotNicknamesInGroups() {
  if (!botAPI) return;
  try {
    api.getThreadList(100, null, ['GROUP'], (err, threads) => {
      if (!err && threads) {
        const botID = api.getCurrentUserID();
        threads.forEach(thread => {
          api.getThreadInfo(thread.threadID, (err, info) => {
            if (!err && info.nicknames && info.nicknames[botID] !== botNickname) {
              api.changeNickname(botNickname, thread.threadID, botID);
            }
          });
        });
      }
    });
  } catch (e) {
    emitLog('Nickname set error: ' + e.message, true);
  }
}

function handleThreadNameChange(api, event) {
  const { threadID, authorID } = event;
  const newTitle = event.logMessageData?.name;
  if (lockedGroups[threadID] && authorID !== adminID && newTitle !== lockedGroups[threadID]) {
    api.setTitle(lockedGroups[threadID], threadID);
    api.getUserInfo(authorID, (err, ret) => {
      if (!err && ret[authorID]) {
        const name = ret[authorID].name;
        api.sendMessage({ body: `@${name} group name locked!`, mentions: [{ tag: name, id: authorID }] }, threadID);
      }
    });
  }
}

function handleNicknameChange(api, event) {
  const { threadID, authorID, logMessageData } = event;
  const botID = api.getCurrentUserID();
  
  if (!logMessageData) return;
  
  const participantID = logMessageData.participant_id;
  const newNickname = logMessageData.nickname;
  
  if (participantID === botID && authorID !== adminID && newNickname !== botNickname) {
    api.changeNickname(botNickname, threadID, botID);
  }
  if (lockedNicknames[threadID] && authorID !== adminID && newNickname !== lockedNicknames[threadID]) {
    api.changeNickname(lockedNicknames[threadID], threadID, participantID);
  }
}

function handleBotAddedToGroup(api, event) {
  const { threadID, logMessageData } = event;
  const botID = api.getCurrentUserID();
  if (logMessageData?.addedParticipants?.some(p => String(p.userFbId) === String(botID))) {
    api.changeNickname(botNickname, threadID, botID);
    api.sendMessage(`Hello! I'm online. Use ${prefix}help for commands.`, threadID);
    emitLog(`Bot added to new group: ${threadID}`);
  }
}

// === DASHBOARD ROUTES ===
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/configure', (req, res) => {
  try {
    const cookies = typeof req.body.cookies === 'string' ? JSON.parse(req.body.cookies) : req.body.cookies;
    prefix = req.body.prefix || prefix;
    adminID = req.body.adminID || adminID;
    
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid cookies format' });
    }
    if (!adminID) {
      return res.status(400).json({ success: false, error: 'Admin ID required' });
    }
    
    currentCookies = cookies;
    saveConfig();
    
    emitLog('🔄 Starting bot with new configuration...');
    initializeBot(currentCookies, prefix, adminID);
    
    res.json({ success: true, message: 'Bot configuration updated and starting...' });
  } catch (e) {
    emitLog('Config error: ' + e.message, true);
    res.status(400).json({ success: false, error: 'Invalid data: ' + e.message });
  }
});

app.post('/restart', (req, res) => {
  if (!currentCookies) {
    return res.status(400).json({ success: false, error: 'No cookies configured' });
  }
  
  emitLog('🔄 Manual restart requested...');
  initializeBot(currentCookies, prefix, adminID);
  res.json({ success: true, message: 'Bot restarting...' });
});

app.post('/stop', (req, res) => {
  stopBotListening();
  updateBotStatus('STOPPED');
  emitLog('Bot stopped via dashboard');
  res.json({ success: true, message: 'Bot stopped successfully' });
});

app.get('/status', (req, res) => {
  res.json({
    status: botStatus,
    userInfo: botUserInfo,
    adminID,
    prefix,
    error: lastError,
    isListening: isListening,
    stats: {
      lockedGroups: Object.keys(lockedGroups).length,
      lockedNicknames: Object.keys(lockedNicknames).length,
      lockedTargets: Object.keys(lockedTargets).length
    }
  });
});

// === AUTO LOAD CONFIG ===
try {
  if (fs.existsSync('config.json')) {
    const loaded = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    if (loaded.botNickname) botNickname = loaded.botNickname;
    if (loaded.prefix) prefix = loaded.prefix;
    if (loaded.adminID) adminID = loaded.adminID;
    if (loaded.lockedGroups) lockedGroups = loaded.lockedGroups;
    if (loaded.lockedNicknames) lockedNicknames = loaded.lockedNicknames;
    if (loaded.lockedTargets) lockedTargets = loaded.lockedTargets;
    if (typeof loaded.antiOutEnabled === 'boolean') antiOutEnabled = loaded.antiOutEnabled;
    if (typeof loaded.botOutEnabled === 'boolean') botOutEnabled = loaded.botOutEnabled;
    if (typeof loaded.hangerEnabled === 'boolean') hangerEnabled = loaded.hangerEnabled;
    if (Array.isArray(loaded.cookies) && loaded.cookies.length) {
      currentCookies = loaded.cookies;
      emitLog('Found saved cookies; auto-starting bot.');
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 2000);
    } else {
      emitLog('No cookies found. Please configure via dashboard.');
      updateBotStatus('CONFIG_NEEDED');
    }
  } else {
    emitLog('No config.json found. Please configure via dashboard.');
    updateBotStatus('CONFIG_NEEDED');
  }
} catch (e) {
  emitLog('Config load error: ' + e.message, true);
  updateBotStatus('ERROR');
}

// === SERVER START ===
const PORT = process.env.PORT || 20018;
server.listen(PORT, () => {
  emitLog(`🚀 Server running on port ${PORT}`);
  emitLog(`📊 Dashboard available at: http://localhost:${PORT}`);
});

io.on('connection', (socket) => {
  emitLog('📱 Dashboard connected');
  socket.emit('bot_status', { 
    status: botStatus, 
    userInfo: botUserInfo,
    error: lastError,
    isListening: isListening
  });
  
  // Send recent logs
  setTimeout(() => {
    socket.emit('botlog', `[${new Date().toLocaleTimeString()}] ✅ Welcome to Bot Dashboard`);
    socket.emit('botlog', `[${new Date().toLocaleTimeString()}] ℹ️  Current Status: ${botStatus}`);
    socket.emit('botlog', `[${new Date().toLocaleTimeString()}] 🔊 Listening: ${isListening ? 'ACTIVE' : 'INACTIVE'}`);
  }, 100);
});
