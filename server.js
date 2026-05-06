const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { IgApiClient } = require('instagram-private-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = 3000;

// ====================================================
// ⚠️ YAHI APNA INSTAGRAM USERNAME AUR PASSWORD DAALO
// ====================================================
const IG_USERNAME = 'btw_lishy';
const IG_PASSWORD = 'Haseeb707@';
// ====================================================

let ig = null;
let loggedIn = false;
let targetUserId = null;
let previousStatus = false;
let trackingInterval = null;
let trackingTarget = null;

async function loginToInstagram() {
  try {
    ig = new IgApiClient();
    ig.state.generateDevice(IG_USERNAME);
    await ig.account.login(IG_USERNAME, IG_PASSWORD);
    loggedIn = true;
    console.log('✅ Instagram login successful!');
    return true;
  } catch (err) {
    console.error('❌ Login failed:', err.message);
    loggedIn = false;
    return false;
  }
}

async function getUserIdByUsername(username) {
  try {
    if (!ig || !loggedIn) {
      const ok = await loginToInstagram();
      if (!ok) return null;
    }
    const user = await ig.user.searchExact(username);
    console.log(`✅ Found @${username} (ID: ${user.pk})`);
    return user.pk;
  } catch (err) {
    console.error('❌ User not found:', err.message);
    return null;
  }
}

async function checkPresence(userId) {
  try {
    if (!ig || !loggedIn) return { online: false, lastActive: null };

    const response = await ig.client.send({
      url: '/api/v1/direct_v2/get_presence/',
      method: 'GET',
    });

    const data = response.user_presence && response.user_presence[userId.toString()];
    if (data) {
      const now = Date.now();
      const isActive = data.is_active;
      const lastMs = data.last_activity_at_ms;
      const isOnline = isActive || (lastMs && (now - lastMs) < 60000);
      return {
        online: Boolean(isOnline),
        lastActive: lastMs ? new Date(lastMs).toISOString() : null,
        lastActiveDisplay: lastMs ? timeAgo(lastMs) : 'N/A'
      };
    }
    return { online: false, lastActive: null, lastActiveDisplay: 'N/A' };
  } catch (err) {
    return { online: false, lastActive: null, lastActiveDisplay: 'Error' };
  }
}

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log(`🔗 Client connected: ${socket.id.substring(0, 8)}...`);

  socket.on('start-tracking', async (data) => {
    const username = data?.username?.trim().toLowerCase();
    if (!username) {
      socket.emit('error', 'Please enter a username');
      return;
    }

    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }

    trackingTarget = username;

    if (!loggedIn) await loginToInstagram();

    const userId = await getUserIdByUsername(username);
    if (!userId) {
      trackingTarget = null;
      socket.emit('error', `User @${username} not found!`);
      return;
    }

    targetUserId = userId;
    previousStatus = false;
    socket.emit('tracking-started', { username, userId, message: `✅ Now tracking @${username}` });
    console.log(`🎯 Tracking @${username}`);

    trackingInterval = setInterval(async () => {
      const status = await checkPresence(userId);

      if (status.online !== previousStatus) {
        if (status.online) {
          console.log(`🟢 @${trackingTarget} ONLINE`);
          io.emit('user-came-online', {
            username: trackingTarget,
            timestamp: new Date().toISOString(),
            message: `🎯 @${trackingTarget} is now ONLINE!`
          });
        } else {
          console.log(`🔴 @${trackingTarget} offline`);
          io.emit('user-went-offline', {
            username: trackingTarget,
            timestamp: new Date().toISOString(),
            message: `@${trackingTarget} went offline`
          });
        }
        previousStatus = status.online;
      }

      io.emit('status-update', {
        username: trackingTarget,
        online: status.online,
        lastActive: status.lastActive,
        lastActiveDisplay: status.lastActiveDisplay,
        timestamp: new Date().toISOString()
      });
    }, 15000);
  });

  socket.on('stop-tracking', () => {
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
    const target = trackingTarget;
    previousStatus = false;
    trackingTarget = null;
    targetUserId = null;
    socket.emit('tracking-stopped', { message: target ? `⏹ Stopped @${target}` : 'Stopped' });
    console.log(`⏹ Stopped tracking @${target}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected`);
  });
});

async function start() {
  console.log('🚀 Starting Instagram Tracker...');
  try {
    await loginToInstagram();
  } catch (e) {
    console.log('⚠️ Will login on first request');
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ✅ http://localhost:${PORT}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
  });
}

start();
