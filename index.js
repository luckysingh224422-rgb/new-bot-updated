// index.js - FIXED FOR 404 ERROR
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
  emitLog(`Bot status: ${status}`);
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
  // Clear all hanger intervals
  Object.keys(hangerIntervals).forEach(threadID => {
    clearInterval(hangerIntervals[threadID]);
    delete hangerIntervals[threadID];
  });
  
  isListening = false;
  botAPI = null;
  emitLog('Bot cleanup completed');
}

// === BOT INIT (FIXED FOR 404) ===
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

  // Enhanced login options for 404 fix
  const loginOptions = {
    appState: currentCookies,
    forceLogin: true,
    logLevel: 'silent',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  };

  // Login with enhanced error handling
  login(loginOptions, (err, api) => {
    if (err) {
      let errorMsg = `Login failed: ${err.error || err.message || err}`;
      
      // Handle 404 and other specific errors
      if (err.error && err.error.includes('404')) {
        errorMsg = '❌ Facebook API changed. Cookies expired or invalid. Please get fresh cookies.';
      } else if (err.error === 'Error retrieving userID. This can be caused by a lot of things, including getting blocked by Facebook for logging in from an unknown location. Try logging in with a browser to verify your account.') {
        errorMsg = '❌ Account verification required. Please login to Facebook in browser first.';
      } else if (err.error === 'Not logged in.') {
        errorMsg = '❌ Session expired. Please update cookies.';
      } else if (err.toString().includes('wrong') || err.toString().includes('invalid')) {
        errorMsg = '❌ Invalid cookies format. Please check cookies.';
      }
      
      emitLog(errorMsg, true);
      updateBotStatus('ERROR');
      
      // Don't auto-retry on critical errors
      if (!errorMsg.includes('Cookies expired') && !errorMsg.includes('verification required')) {
        emitLog('Retrying in 20 seconds...');
        setTimeout(() => initializeBot(currentCookies, prefix, adminID), 20000);
      }
      return;
    }

    emitLog('✅ Bot logged in successfully!');
    botAPI = api;
    isListening = true;
    
    // Set API options for stability
    api.setOptions({ 
      selfListen: false,
      listenEvents: true, 
      updatePresence: false,
      logLevel: 'silent'
    });

    // Get bot user info
    try {
      const botID = api.getCurrentUserID();
      emitLog(`Bot ID: ${botID}`);
      
      api.getUserInfo(botID, (err, ret) => {
        if (err || !ret[botID]) {
          emitLog('⚠️ Could not fetch bot user details, but continuing...', true);
          updateBotStatus('ONLINE');
          startEnhancedListening(api);
          return;
        }

        const userInfo = {
          name: ret[botID].name,
          id: botID,
          profilePic: ret[botID].thumbSrc
        };
        botUserInfo = userInfo;
        updateBotStatus('ONLINE', userInfo);
        emitLog(`🤖 Bot: ${userInfo.name}`);
        
        startEnhancedListening(api);
      });
    } catch (e) {
      emitLog('Error getting user info: ' + e.message, true);
      updateBotStatus('ONLINE');
      startEnhancedListening(api);
    }
  });
}

// === ENHANCED LISTENER (404 FIX) ===
function startEnhancedListening(api) {
  if (!isListening) {
    emitLog('Listener stopped by user');
    return;
  }

  emitLog('👂 Starting enhanced listener...');
  
  let listenerActive = true;
  let errorCount = 0;
  const maxErrors = 5;
  
  // Enhanced message handler with error tracking
  const messageHandler = (error, message) => {
    if (!listenerActive) return;
    
    if (error) {
      errorCount++;
      
      // Handle specific errors
      if (error.error && error.error.includes('404')) {
        emitLog('❌ Facebook API 404 error - Cookies might be expired', true);
        listenerActive = false;
        updateBotStatus('ERROR');
        return;
      }
      
      if (error === 'Not logged in.') {
        emitLog('❌ Session expired - Relogin required', true);
        listenerActive = false;
        updateBotStatus('ERROR');
        return;
      }
      
      emitLog(`❌ Listener error (${errorCount}/${maxErrors}): ${error.error || error}`, true);
      
      if (errorCount >= maxErrors) {
        emitLog('❌ Too many errors, stopping listener', true);
        listenerActive = false;
        updateBotStatus('ERROR');
        return;
      }
      
      // Continue listening despite errors
      return;
    }

    // Reset error count on successful message
    errorCount = 0;

    if (!message) return;

    try {
      // Handle different message types
      if (message.type === 'message' || message.type === 'message_reply') {
        handleEnhancedMessage(api, message);
      }
      // Handle events
      else if (message.type === 'event' && message.logMessageType) {
        handleEnhancedEvent(api, message);
      }
    } catch (e) {
      emitLog(`❌ Message handler error: ${e.message}`, true);
    }
  };

  // Start listening with error handling
  try {
    api.listen((err, event) => {
      messageHandler(err, event);
    });
    
    emitLog('✅ Enhanced listener started successfully');
    updateBotStatus('LISTENING', botUserInfo);
    
  } catch (e) {
    emitLog('❌ Failed to start listener: ' + e.message, true);
    updateBotStatus('ERROR');
  }
}

// === RECONNECT SYSTEM ===
function reconnectAndListen() {
  if (reconnectAttempt >= 2) {
    emitLog('❌ Max reconnect attempts reached. Please check cookies.', true);
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
  }, 15000);
}

// === ENHANCED MESSAGE HANDLER ===
function handleEnhancedMessage(api, event) {
  const { threadID, senderID, body } = event;
  if (!body) return;
  
  const msg = body.toLowerCase();
  const botID = api.getCurrentUserID();
  
  // Ignore bot's own messages
  if (senderID === botID) return;

  // Log incoming message
  emitLog(`📩 ${senderID}: ${body.substring(0, 30)}...`);

  // Target lock check
  const target = lockedTargets[threadID];
  const isAdmin = senderID === adminID;
  const isCommand = body.startsWith(prefix);

  if (target && senderID !== target && !(isAdmin && isCommand)) {
    if (isCommand && !isAdmin) {
      try {
        api.sendMessage({ body: '❌ No permission while target locked.' }, threadID);
      } catch (e) {
        emitLog('Send message error: ' + e.message, true);
      }
    }
    return;
  }

  // Anti-spam
  const now = Date.now();
  if (lastMessageTime[threadID] && now - lastMessageTime[threadID] < 2000) return;
  lastMessageTime[threadID] = now;

  // Handle admin commands
  if (isCommand && isAdmin) {
    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    emitLog(`⚡ Admin command: ${command}`);

    try {
      switch (command) {
        case 'group':
          handleSimpleGroupCommand(api, event, args);
          break;
        case 'nickname':
          handleSimpleNicknameCommand(api, event, args);
          break;
        case 'target':
          handleSimpleTargetCommand(api, event, args);
          break;
        case 'antiout':
          handleSimpleToggleCommand(api, event, args, 'antiOutEnabled', 'Anti-out');
          break;
        case 'botout':
          handleSimpleToggleCommand(api, event, args, 'botOutEnabled', 'Bot-out');
          break;
        case 'hanger':
          handleSimpleToggleCommand(api, event, args, 'hangerEnabled', 'Hanger');
          break;
        case 'status':
          handleSimpleStatusCommand(api, event);
          break;
        case 'stop':
          handleSimpleStopCommand(api, event);
          break;
        case 'help':
          sendSimpleHelp(api, event);
          break;
        case 'test':
          api.sendMessage('✅ Bot is working!', threadID);
          break;
        default:
          sendSimpleHelp(api, event);
          break;
      }
    } catch (e) {
      emitLog(`Command error: ${e.message}`, true);
      api.sendMessage('❌ Command failed', threadID);
    }
    return;
  } else if (isCommand && !isAdmin) {
    try {
      api.sendMessage('❌ Admin only commands.', threadID);
    } catch (e) {
      // Ignore send errors
    }
    return;
  }

  // Handle special admin phrases
  if (isAdmin) {
    if (msg.includes('bot left')) {
      try {
        api.sendMessage('👋 Leaving group...', threadID, () => {
          api.removeUserFromGroup(botID, threadID);
        });
      } catch (e) {
        emitLog('Leave group error: ' + e.message, true);
      }
      return;
    }
    
    if (msg.includes('hanger on')) {
      stopHangerInThread(threadID);
      try {
        api.sendMessage('🪝 Hanger started!', threadID);
        hangerIntervals[threadID] = setInterval(() => {
          try {
            sendHangerMessage(api, threadID);
          } catch (e) {
            emitLog('Hanger message error: ' + e.message, true);
          }
        }, 20000);
      } catch (e) {
        emitLog('Hanger start error: ' + e.message, true);
      }
      return;
    }
    
    if (msg.includes('hanger off')) {
      stopHangerInThread(threadID);
      try {
        api.sendMessage('🪝 Hanger stopped!', threadID);
      } catch (e) {
        // Ignore send errors
      }
      return;
    }
  }

  // Auto reply with low probability to avoid spam
  if (Math.random() < 0.1) { // 10% chance
    const randomReply = mastiReplies[Math.floor(Math.random() * mastiReplies.length)];
    
    try {
      // Simple message without mentions to avoid errors
      api.sendMessage(randomReply + signature, threadID);
    } catch (e) {
      emitLog('Auto-reply error: ' + e.message, true);
    }
  }
}

// === SIMPLE COMMAND HANDLERS ===
function handleSimpleGroupCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on' && args.length > 1) {
    const name = args.slice(1).join(' ');
    lockedGroups[threadID] = name;
    try {
      api.setTitle(name, threadID);
    } catch (e) {
      // Ignore title set errors
    }
    saveConfig();
    api.sendMessage(`✅ Group locked: ${name}`, threadID);
  } else if (sub === 'off') {
    delete lockedGroups[threadID];
    saveConfig();
    api.sendMessage('✅ Group unlocked', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}group on <name> OR ${prefix}group off`, threadID);
  }
}

function handleSimpleNicknameCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on' && args.length > 1) {
    const nick = args.slice(1).join(' ');
    lockedNicknames[threadID] = nick;
    saveConfig();
    api.sendMessage(`✅ Nicknames locked: ${nick}`, threadID);
  } else if (sub === 'off') {
    delete lockedNicknames[threadID];
    saveConfig();
    api.sendMessage('✅ Nicknames unlocked', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}nickname on <nick> OR ${prefix}nickname off`, threadID);
  }
}

function handleSimpleTargetCommand(api, event, args) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on' && args.length > 1) {
    const targetID = args[1];
    lockedTargets[threadID] = targetID;
    saveConfig();
    api.sendMessage(`✅ Target locked: ${targetID}`, threadID);
  } else if (sub === 'off') {
    delete lockedTargets[threadID];
    saveConfig();
    api.sendMessage('✅ Target unlocked', threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}target on <userID> OR ${prefix}target off`, threadID);
  }
}

function handleSimpleToggleCommand(api, event, args, setting, name) {
  const { threadID } = event;
  const sub = args[0];
  
  if (sub === 'on') {
    global[setting] = true;
    saveConfig();
    api.sendMessage(`✅ ${name} activated`, threadID);
  } else if (sub === 'off') {
    global[setting] = false;
    saveConfig();
    api.sendMessage(`✅ ${name} deactivated`, threadID);
  } else {
    api.sendMessage(`Usage: ${prefix}${name.toLowerCase()} on/off`, threadID);
  }
}

function handleSimpleStatusCommand(api, event) {
  const { threadID } = event;
  const statusMessage = `
🤖 BOT STATUS:
• Status: ${botStatus}
• Admin: ${adminID ? '✅' : '❌'}
• Groups: ${Object.keys(lockedGroups).length}
• Targets: ${Object.keys(lockedTargets).length}
• Errors: ${lastError ? '❌' : '✅'}
  `.trim();
  
  api.sendMessage(statusMessage, threadID);
}

function handleSimpleStopCommand(api, event) {
  const { threadID } = event;
  api.sendMessage('🛑 Stopping bot...', threadID, () => {
    cleanupBot();
    updateBotStatus('STOPPED');
    emitLog('Bot stopped by admin');
  });
}

function sendSimpleHelp(api, event) {
  const { threadID } = event;
  const helpText = `
🤖 BOT COMMANDS:
${prefix}group on/off <name>
${prefix}nickname on/off <nick>  
${prefix}target on/off <userID>
${prefix}antiout on/off
${prefix}botout on/off
${prefix}hanger on/off
${prefix}status
${prefix}stop
${prefix}test
  `.trim();
  
  api.sendMessage(helpText, threadID);
}

// === HANGER MESSAGE ===
function sendHangerMessage(api, threadID) {
  try {
    const hangerMessage = {
      body: '𝔸𝕃𝕃 ℍ𝔼𝕃ℙ𝔼ℝ𝕊 𝕂𝕀 𝕄𝔸𝔸 ℂℍ𝕆𝔻ℕ𝔼 𝕎𝔸𝕃𝔸 𝟡𝟡ℍ𝟡ℕ ℍ𝟛ℝ𝟛 (•◡•)\n❤️ FEEL KRO APNE BAAP KO 💚'
    };
    api.sendMessage(hangerMessage, threadID);
  } catch (error) {
    // Ignore hanger errors
  }
}

function stopHangerInThread(threadID) {
  if (hangerIntervals[threadID]) {
    clearInterval(hangerIntervals[threadID]);
    delete hangerIntervals[threadID];
  }
}

// === EVENT HANDLERS ===
function handleEnhancedEvent(api, event) {
  const logMessageType = event.logMessageType;
  
  switch (logMessageType) {
    case 'log:thread-name':
      handleThreadChange(api, event);
      break;
    case 'log:user-nickname':
      handleNickChange(api, event);
      break;
    case 'log:subscribe':
      handleBotAdded(api, event);
      break;
    case 'log:unsubscribe':
      handleUserLeft(api, event);
      break;
  }
}

function handleThreadChange(api, event) {
  const { threadID, authorID } = event;
  const newTitle = event.logMessageData?.name;
  if (lockedGroups[threadID] && authorID !== adminID && newTitle !== lockedGroups[threadID]) {
    try {
      api.setTitle(lockedGroups[threadID], threadID);
    } catch (e) {
      // Ignore title errors
    }
  }
}

function handleNickChange(api, event) {
  const { threadID, authorID, logMessageData } = event;
  const botID = api.getCurrentUserID();
  
  if (!logMessageData) return;
  
  const participantID = logMessageData.participant_id;
  const newNickname = logMessageData.nickname;
  
  if (participantID === botID && authorID !== adminID && newNickname !== botNickname) {
    try {
      api.changeNickname(botNickname, threadID, botID);
    } catch (e) {
      // Ignore nickname errors
    }
  }
}

function handleBotAdded(api, event) {
  const { threadID, logMessageData } = event;
  const botID = api.getCurrentUserID();
  if (logMessageData?.addedParticipants?.some(p => String(p.userFbId) === String(botID))) {
    try {
      api.sendMessage(`✅ Bot added! Use ${prefix}help`, threadID);
    } catch (e) {
      // Ignore send errors
    }
  }
}

function handleUserLeft(api, event) {
  if (!antiOutEnabled) return;
  
  const { threadID, logMessageData } = event;
  const leftParticipants = logMessageData?.leftParticipants || [];
  
  leftParticipants.forEach(user => {
    try {
      const userID = user.id || user.userFbId;
      if (userID && userID !== adminID) {
        api.addUserToGroup(userID, threadID);
      }
    } catch (error) {
      // Ignore add user errors
    }
  });
}

// === DASHBOARD ROUTES ===
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/configure', (req, res) => {
  try {
    let cookies = req.body.cookies;
    
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
      return res.status(400).json({ success: false, error: 'Valid cookies array required' });
    }
    if (!adminID) {
      return res.status(400).json({ success: false, error: 'Admin ID required' });
    }
    
    currentCookies = cookies;
    saveConfig();
    
    emitLog('🔄 Starting bot with new cookies...');
    initializeBot(currentCookies, prefix, adminID);
    
    res.json({ success: true, message: 'Bot starting with new configuration...' });
  } catch (e) {
    emitLog('Config error: ' + e.message, true);
    res.status(400).json({ success: false, error: 'Configuration failed: ' + e.message });
  }
});

app.post('/restart', (req, res) => {
  if (!currentCookies) {
    return res.status(400).json({ success: false, error: 'No cookies configured' });
  }
  
  emitLog('🔄 Manual restart...');
  initializeBot(currentCookies, prefix, adminID);
  res.json({ success: true, message: 'Bot restarting...' });
});

app.post('/stop', (req, res) => {
  cleanupBot();
  updateBotStatus('STOPPED');
  emitLog('Bot stopped via dashboard');
  res.json({ success: true, message: 'Bot stopped' });
});

app.get('/status', (req, res) => {
  res.json({
    status: botStatus,
    userInfo: botUserInfo,
    adminID,
    prefix,
    error: lastError,
    isListening: isListening
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
      emitLog('Found saved cookies - auto-starting in 5 seconds...');
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 5000);
    } else {
      emitLog('No cookies found. Configure via dashboard.');
      updateBotStatus('CONFIG_NEEDED');
    }
  } else {
    emitLog('No config file. Please configure bot.');
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
  emitLog(`📊 Dashboard: http://localhost:${PORT}`);
  emitLog('💡 FOR 404 FIX: Get fresh cookies from Facebook');
});

io.on('connection', (socket) => {
  emitLog('📱 Dashboard connected');
  socket.emit('bot_status', { 
    status: botStatus, 
    userInfo: botUserInfo,
    error: lastError
  });
});
