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
let loginTimeout = null;

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

// === CLEANUP FUNCTION ===
function cleanupBot() {
  if (loginTimeout) {
    clearTimeout(loginTimeout);
    loginTimeout = null;
  }
  
  // Clear all hanger intervals
  Object.keys(hangerIntervals).forEach(threadID => {
    clearInterval(hangerIntervals[threadID]);
    delete hangerIntervals[threadID];
  });
  
  isListening = false;
  emitLog('Bot cleanup completed');
}

// === BOT INIT (COMPLETELY FIXED) ===
function initializeBot(cookies, prefixArg, adminArg) {
  // Cleanup previous instance
  cleanupBot();
  
  emitLog('🚀 Initializing bot...');
  updateBotStatus('CONNECTING');
  
  currentCookies = cookies;
  if (prefixArg) prefix = prefixArg;
  if (adminArg) adminID = adminArg;
  reconnectAttempt = 0;
  lastError = null;

  // Add timeout for login
  loginTimeout = setTimeout(() => {
    if (botStatus === 'CONNECTING') {
      emitLog('❌ Login timeout - taking too long to connect', true);
      updateBotStatus('ERROR');
      cleanupBot();
    }
  }, 30000); // 30 second timeout

  // Login with better error handling
  try {
    login({ appState: currentCookies }, (err, api) => {
      clearTimeout(loginTimeout);
      
      if (err) {
        let errorMsg = `Login failed: ${err.message}`;
        
        // Handle specific errors
        if (err.error === 'Error retrieving userID. This can be caused by a lot of things, including getting blocked by Facebook for logging in from an unknown location. Try logging in with a browser to verify your account.') {
          errorMsg = '❌ Account verification required. Please login to Facebook in browser first.';
        } else if (err.error === 'Not logged in.') {
          errorMsg = '❌ Session expired. Please update cookies.';
        } else if (err.toString().includes('wrong') || err.toString().includes('invalid')) {
          errorMsg = '❌ Invalid cookies. Please get fresh cookies.';
        }
        
        emitLog(errorMsg, true);
        updateBotStatus('ERROR');
        cleanupBot();
        
        // Don't auto-retry on critical errors
        if (!errorMsg.includes('Invalid cookies') && !errorMsg.includes('verification required')) {
          emitLog('Retrying in 15 seconds...');
          setTimeout(() => initializeBot(currentCookies, prefix, adminID), 15000);
        }
        return;
      }

      emitLog('✅ Bot logged in successfully!');
      botAPI = api;
      isListening = true;
      
      // Set API options for better stability
      api.setOptions({ 
        selfListen: false, // Set to false to avoid message loops
        listenEvents: true, 
        updatePresence: false,
        forceLogin: false, // Set to false to avoid forced login issues
        logLevel: 'error',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });

      // Get bot user info with callback
      const botID = api.getCurrentUserID();
      emitLog(`Bot ID: ${botID}`);
      
      api.getUserInfo(botID, (err, ret) => {
        if (err || !ret[botID]) {
          emitLog('⚠️ Could not fetch bot user details, but continuing...', true);
          updateBotStatus('ONLINE');
          startListening(api);
          return;
        }

        const userInfo = {
          name: ret[botID].name,
          id: botID,
          profilePic: ret[botID].thumbSrc
        };
        botUserInfo = userInfo;
        updateBotStatus('ONLINE', userInfo);
        emitLog(`🤖 Bot identity: ${userInfo.name} (${userInfo.id})`);
        
        // Start listening after getting user info
        startListening(api);
      });

    });
  } catch (e) {
    clearTimeout(loginTimeout);
    emitLog('❌ Critical login error: ' + e.message, true);
    updateBotStatus('ERROR');
    cleanupBot();
  }
}

// === LISTENER (SIMPLIFIED AND FIXED) ===
function startListening(api) {
  if (!isListening) {
    emitLog('Listener stopped by user');
    return;
  }

  emitLog('👂 Starting message listener...');
  
  let listenerActive = true;
  
  // Simple message handler
  const messageHandler = (error, message) => {
    if (!listenerActive) return;
    
    if (error) {
      if (error === 'Not logged in.') {
        emitLog('❌ Session expired, need to relogin', true);
        updateBotStatus('ERROR');
        listenerActive = false;
        return;
      }
      emitLog(`❌ Listener error: ${error}`, true);
      listenerActive = false;
      reconnectAndListen();
      return;
    }

    if (!message) return;

    try {
      // Handle message
      if (message.type === 'message' || message.type === 'message_reply') {
        handleMessage(api, message);
      }
      // Handle events
      else if (message.type === 'event' && message.logMessageType) {
        handleEvent(api, message);
      }
    } catch (e) {
      emitLog(`❌ Message handler error: ${e.message}`, true);
    }
  };

  // Start listening
  try {
    api.listen((err, event) => {
      messageHandler(err, event);
    });
    
    emitLog('✅ Listener started successfully');
    updateBotStatus('LISTENING', botUserInfo);
    
  } catch (e) {
    emitLog('❌ Failed to start listener: ' + e.message, true);
    updateBotStatus('ERROR');
  }
}

// === RECONNECT SYSTEM ===
function reconnectAndListen() {
  if (reconnectAttempt >= 3) {
    emitLog('❌ Max reconnect attempts reached. Please check cookies and restart.', true);
    updateBotStatus('ERROR');
    return;
  }

  reconnectAttempt++;
  emitLog(`🔄 Reconnect attempt #${reconnectAttempt}...`);
  updateBotStatus('RECONNECTING');
  
  setTimeout(() => {
    if (currentCookies) {
      initializeBot(currentCookies, prefix, adminID);
    } else {
      emitLog('❌ No cookies available for reconnection', true);
      updateBotStatus('ERROR');
    }
  }, 10000); // Wait 10 seconds before reconnect
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

// === SIMPLIFIED FORMAT MESSAGE ===
function formatMessage(senderName, mainText, senderID) {
  return {
    body: `@${senderName} ${mainText}\n\n— 💕𝑴𝑹 𝑨𝑨𝑯𝑨𝑵 💕\n------------------------------`,
    mentions: [{ tag: `@${senderName}`, id: senderID }]
  };
}

// === HANGER MESSAGE FUNCTION ===
function sendHangerMessage(api, threadID) {
  try {
    const hangerMessage = {
      body: '𝔸𝕃𝕃 ℍ𝔼𝕃ℙ𝔼ℝ𝕊 𝕂𝕀 𝕄𝔸𝔸 ℂℍ𝕆𝔻ℕ𝔼 𝕎𝔸𝕃𝔸 𝟡𝟡ℍ𝟡ℕ ℍ𝟛ℝ𝟛 (•◡•)\n❤️ FEEL KRO APNE BAAP KO 💚\n｡ 🎀 𝒜𝒜𝐻𝒜𝒩 𝐼𝒩𝒳𝐼𝒟𝐸 🎀 ｡'
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

// === SIMPLIFIED MESSAGE HANDLER ===
function handleMessage(api, event) {
  const { threadID, senderID, body } = event;
  if (!body) return;
  
  const msg = body.toLowerCase();
  const botID = api.getCurrentUserID();
  
  // Ignore messages from the bot itself
  if (senderID === botID) return;

  // Log incoming message
  emitLog(`📩 Message from ${senderID}: ${body.substring(0, 50)}...`);

  // === TARGET LOCK ===
  const target = lockedTargets[threadID];
  const isAdmin = senderID === adminID;
  const isCommand = body.startsWith(prefix);

  if (target && senderID !== target && !(isAdmin && isCommand)) {
    if (isCommand && !isAdmin) {
      api.sendMessage({ body: 'You don\'t have permission to use commands while target is locked.' }, threadID);
    }
    return;
  }

  // Anti-spam
  const now = Date.now();
  if (lastMessageTime[threadID] && now - lastMessageTime[threadID] < 1500) return;
  lastMessageTime[threadID] = now;

  // Handle commands
  if (isCommand && isAdmin) {
    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    emitLog(`⚡ Admin command: ${command}`);

    // Simple command routing
    switch (command) {
      case 'group':
        handleGroupCommand(api, event, args);
        break;
      case 'nickname':
        handleNicknameCommand(api, event, args);
        break;
      case 'target':
        handleTargetCommand(api, event, args);
        break;
      case 'antiout':
        handleAntiOutCommand(api, event, args);
        break;
      case 'botout':
        handleBotOutCommand(api, event, args);
        break;
      case 'hanger':
        handleHangerCommand(api, event, args);
        break;
      case 'status':
        handleStatusCommand(api, event, args);
        break;
      case 'stop':
        handleStopCommand(api, event, args);
        break;
      case 'help':
        sendHelpMessage(api, event);
        break;
      default:
        sendHelpMessage(api, event);
        break;
    }
    return;
  } else if (isCommand && !isAdmin) {
    api.sendMessage({ body: '❌ Permission denied: admin only commands.' }, threadID);
    return;
  }

  // Handle special phrases
  if (isAdmin) {
    if (msg.includes('bot left')) {
      api.sendMessage('👋 Bot leaving group...', threadID, () => {
        api.removeUserFromGroup(botID, threadID);
      });
      return;
    }
    
    if (msg.includes('hanger on')) {
      stopHangerInThread(threadID);
      api.sendMessage('🪝 Hanger started!', threadID);
      hangerIntervals[threadID] = setInterval(() => {
        sendHangerMessage(api, threadID);
      }, 20000);
      return;
    }
    
    if (msg.includes('hanger off')) {
      stopHangerInThread(threadID);
      api.sendMessage('🪝 Hanger stopped!', threadID);
      return;
    }
  }

  // Auto reply with 20% chance
  if (Math.random() < 0.2) {
    const randomReply = mastiReplies[Math.floor(Math.random() * mastiReplies.length)];
    
    // Get sender name for mention
    api.getUserInfo(senderID, (err, ret) => {
      const senderName = (ret && ret[senderID] && ret[senderID].name) ? ret[senderID].name : 'User';
      const formattedMsg = formatMessage(senderName, randomReply, senderID);
      api.sendMessage(formattedMsg, threadID);
    });
  }
}

// === HELP MESSAGE ===
function sendHelpMessage(api, event) {
  const { threadID, senderID } = event;
  
  const helpText = `
🤖 BOT COMMANDS:

🔹 ${prefix}group on/off <name> - Lock group name
🔹 ${prefix}nickname on/off <nick> - Lock nicknames  
🔹 ${prefix}target on/off <userID> - Target specific user
🔹 ${prefix}antiout on/off - Anti-out system
🔹 ${prefix}botout on/off - Bot auto-rejoin
🔹 ${prefix}hanger on/off - Auto message system
🔹 ${prefix}status - Check bot status
🔹 ${prefix}stop - Stop bot
🔹 ${prefix}help - This message

💬 Auto Features:
• Auto replies to messages
• "hanger on/off" - Toggle spam mode
• "bot left" - Make bot leave group
  `.trim();

  api.sendMessage(helpText, threadID);
}

// === STOP COMMAND ===
function handleStopCommand(api, event, args) {
  const { threadID } = event;
  api.sendMessage('🛑 Bot stopping...', threadID, () => {
    cleanupBot();
    updateBotStatus('STOPPED');
    emitLog('Bot stopped by admin command');
  });
}

// === STATUS COMMAND ===
function handleStatusCommand(api, event, args) {
  const { threadID } = event;
  const statusMessage = `
🤖 BOT STATUS:
• Status: ${botStatus}
• Listening: ${isListening ? '✅ YES' : '❌ NO'} 
• Admin: ${adminID ? '✅ Configured' : '❌ Not Set'}
• Prefix: ${prefix}
• Groups Locked: ${Object.keys(lockedGroups).length}
• Nicknames Locked: ${Object.keys(lockedNicknames).length}
• Targets Locked: ${Object.keys(lockedTargets).length}
• Errors: ${lastError ? '❌ ' + lastError.substring(0, 50) + '...' : '✅ None'}
  `.trim();
  
  api.sendMessage(statusMessage, threadID);
}

// === SIMPLIFIED COMMAND HANDLERS ===
function handleGroupCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on' && args.length > 1) {
    const name = args.slice(1).join(' ');
    lockedGroups[threadID] = name;
    api.setTitle(name, threadID);
    saveConfig();
    api.sendMessage(`✅ Group name locked to: ${name}`, threadID);
  } else if (sub === 'off') {
    delete lockedGroups[threadID];
    saveConfig();
    api.sendMessage('✅ Group name unlocked', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}group on <name> OR ${prefix}group off`, threadID);
  }
}

function handleNicknameCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on' && args.length > 1) {
    const nick = args.slice(1).join(' ');
    lockedNicknames[threadID] = nick;
    saveConfig();
    api.sendMessage(`✅ Nicknames locked to: ${nick}`, threadID);
  } else if (sub === 'off') {
    delete lockedNicknames[threadID];
    saveConfig();
    api.sendMessage('✅ Nickname lock disabled', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}nickname on <nick> OR ${prefix}nickname off`, threadID);
  }
}

function handleTargetCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on' && args.length > 1) {
    const targetID = args[1];
    lockedTargets[threadID] = targetID;
    saveConfig();
    api.sendMessage(`✅ Target locked to: ${targetID}`, threadID);
  } else if (sub === 'off') {
    delete lockedTargets[threadID];
    saveConfig();
    api.sendMessage('✅ Target unlocked', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}target on <userID> OR ${prefix}target off`, threadID);
  }
}

function handleAntiOutCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on') {
    antiOutEnabled = true;
    saveConfig();
    api.sendMessage('✅ Anti-out system activated', threadID);
  } else if (sub === 'off') {
    antiOutEnabled = false;
    saveConfig();
    api.sendMessage('✅ Anti-out system deactivated', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}antiout on OR ${prefix}antiout off`, threadID);
  }
}

function handleBotOutCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on') {
    botOutEnabled = true;
    saveConfig();
    api.sendMessage('✅ Bot-out system activated', threadID);
  } else if (sub === 'off') {
    botOutEnabled = false;
    saveConfig();
    api.sendMessage('✅ Bot-out system deactivated', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}botout on OR ${prefix}botout off`, threadID);
  }
}

function handleHangerCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on') {
    hangerEnabled = true;
    saveConfig();
    api.sendMessage('✅ Hanger system activated - use "hanger on" in chat to start', threadID);
  } else if (sub === 'off') {
    hangerEnabled = false;
    Object.keys(hangerIntervals).forEach(tid => stopHangerInThread(tid));
    saveConfig();
    api.sendMessage('✅ Hanger system deactivated', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}hanger on OR ${prefix}hanger off`, threadID);
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
        api.addUserToGroup(userID, threadID);
        emitLog(`Anti-out: Added back user ${userID}`);
      }
    } catch (error) {
      emitLog(`Anti-out failed: ${error.message}`, true);
    }
  });
}

function handleThreadNameChange(api, event) {
  const { threadID, authorID } = event;
  const newTitle = event.logMessageData?.name;
  if (lockedGroups[threadID] && authorID !== adminID && newTitle !== lockedGroups[threadID]) {
    api.setTitle(lockedGroups[threadID], threadID);
    api.sendMessage('Group name locked back!', threadID);
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
    api.sendMessage(`✅ Bot added! Use ${prefix}help for commands.`, threadID);
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
    let cookies = req.body.cookies;
    
    // Parse cookies if they're a string
    if (typeof cookies === 'string') {
      try {
        cookies = JSON.parse(cookies);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid JSON in cookies' });
      }
    }
    
    prefix = req.body.prefix || prefix;
    adminID = req.body.adminID || adminID;
    
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({ success: false, error: 'Cookies must be a non-empty array' });
    }
    if (!adminID) {
      return res.status(400).json({ success: false, error: 'Admin ID is required' });
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
  res.json({ success: false, error: 'Bot restarting...' });
});

app.post('/stop', (req, res) => {
  cleanupBot();
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
      emitLog('Found saved cookies; auto-starting bot in 3 seconds...');
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 3000);
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
  emitLog('💡 To get Facebook cookies:');
  emitLog('1. Login to Facebook in browser');
  emitLog('2. Press F12 → Application tab');
  emitLog('3. Go to Cookies → https://facebook.com');
  emitLog('4. Copy all cookies as JSON array');
});

io.on('connection', (socket) => {
  emitLog('📱 Dashboard connected');
  socket.emit('bot_status', { 
    status: botStatus, 
    userInfo: botUserInfo,
    error: lastError,
    isListening: isListening
  });
  
  // Send welcome message
  socket.emit('botlog', `[${new Date().toLocaleTimeString()}] ✅ Welcome to Bot Dashboard`);
  socket.emit('botlog', `[${new Date().toLocaleTimeString()}] 📍 Status: ${botStatus}`);
});
