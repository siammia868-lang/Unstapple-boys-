/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { User, Group, Message } from './src/types.js';

const PORT = 3000;
const app = express();

// Increase request sizes for raw base64 photo uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Setup folder for uploaded files
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Local DB Path
const DB_FILE = path.join(process.cwd(), 'database_backup.json');

// Interface for DB state
interface DatabaseState {
  users: Record<string, User>;
  groups: Group[];
  messages: Record<string, Message[]>;
}

// Memory database
let db: DatabaseState = {
  users: {},
  groups: [
    {
      id: 'general',
      name: 'Boys Lounge',
      description: 'The general hangout zone for the block.',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      isDefault: true,
    },
    {
      id: 'photos',
      name: 'Photo Vault',
      description: 'Share raw photos, memes, and visual stories.',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      isDefault: true,
    },
    {
      id: 'radar',
      name: 'Radar & Travel',
      description: 'Coordinates, travel updates, and active locations.',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      isDefault: true,
    }
  ],
  messages: {
    'general': [],
    'photos': [],
    'radar': []
  }
};

// Load database backup if available
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      
      // Merge keys cleanly
      if (parsed.users) db.users = parsed.users;
      if (parsed.groups) db.groups = parsed.groups;
      if (parsed.messages) db.messages = parsed.messages;
      console.log('Database state loaded successfully from backup.');
    }
  } catch (err) {
    console.error('Failed to load database backup, resetting to default.', err);
  }
}

// Save database state to backup
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write database backup', err);
  }
}

// Active stream clients
interface StreamClient {
  uid: string;
  res: express.Response;
}
let clients: StreamClient[] = [];

// Broadcast realtime updates to connected users
function broadcast(type: string, data: any) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  clients.forEach(client => {
    try {
      client.res.write(payload);
    } catch {
      // client stale or closed
    }
  });
}

// Load database initially
loadDB();

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', clientCount: clients.length });
});

// SSE Stream Register
app.get('/api/stream', (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    res.status(400).send('Missing UID param');
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add client
  const clientObj = { uid, res };
  clients.push(clientObj);

  // Mark user as active, update their registration
  if (db.users[uid]) {
    db.users[uid].lastActive = new Date().toISOString();
    saveDB();
    broadcast('user_update', db.users[uid]);
  }

  // Send initial bootstrap payload
  const initialPayload = JSON.stringify({
    type: 'initial',
    data: {
      users: Object.values(db.users),
      groups: db.groups,
      messages: db.messages
    }
  });
  res.write(`data: ${initialPayload}\n\n`);

  // Simple ping interval to keep client connections active
  const intervalId = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // connection lost
    }
  }, 15000);

  // Connection close cleanup
  req.on('close', () => {
    clearInterval(intervalId);
    clients = clients.filter(c => c !== clientObj);
    
    // Mark user offline status or update checkout time
    if (db.users[uid]) {
      db.users[uid].lastActive = new Date().toISOString();
      saveDB();
      broadcast('user_update', db.users[uid]);
    }
  });
});

// Create/Update User profile
app.post('/api/users', (req, res) => {
  const { uid, username, photoURL, email, shareLocationEnabled, latitude, longitude, statusText } = req.body;
  if (!uid || !username) {
    res.status(400).json({ error: 'Missing uid or username' });
    return;
  }

  const existing = (db.users[uid] || {}) as any;
  const updatedUser: User = {
    uid,
    username,
    email: email || existing.email || '',
    photoURL: photoURL || existing.photoURL || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(username)}`,
    lastActive: new Date().toISOString(),
    shareLocationEnabled: shareLocationEnabled !== undefined ? shareLocationEnabled : (existing.shareLocationEnabled || false),
    latitude: latitude !== undefined ? latitude : existing.latitude,
    longitude: longitude !== undefined ? longitude : existing.longitude,
    locationSharedAt: latitude !== undefined ? new Date().toISOString() : existing.locationSharedAt,
    statusText: statusText !== undefined ? statusText : existing.statusText
  };

  db.users[uid] = updatedUser;
  saveDB();
  broadcast('user_update', updatedUser);
  res.json({ success: true, user: updatedUser });
});

// Update location manually / periodic ping
app.post('/api/users/location', (req, res) => {
  const { uid, latitude, longitude, shareLocationEnabled } = req.body;
  if (!uid || !db.users[uid]) {
    res.status(404).json({ error: 'User profile not found' });
    return;
  }

  const user = db.users[uid];
  user.lastActive = new Date().toISOString();
  
  if (shareLocationEnabled !== undefined) {
    user.shareLocationEnabled = shareLocationEnabled;
  }
  if (latitude !== undefined && longitude !== undefined) {
    user.latitude = latitude;
    user.longitude = longitude;
    user.locationSharedAt = new Date().toISOString();
  }

  db.users[uid] = user;
  saveDB();
  broadcast('user_update', user);
  res.json({ success: true, user });
});

// Create group chat room
app.post('/api/groups', (req, res) => {
  const { name, description, createdBy } = req.body;
  if (!name || !createdBy) {
    res.status(400).json({ error: 'Missing name or createdBy' });
    return;
  }

  // Guard duplicate name
  const exists = db.groups.some(g => g.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    res.status(400).json({ error: 'A room with that name already exists' });
    return;
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `group-${Date.now()}`;
  const newGroup: Group = {
    id,
    name,
    description: description || '',
    createdBy,
    createdAt: new Date().toISOString(),
    isDefault: false
  };

  db.groups.push(newGroup);
  db.messages[id] = [];
  saveDB();
  broadcast('group_created', newGroup);
  res.json({ success: true, group: newGroup });
});

// Send a new message
app.post('/api/messages', (req, res) => {
  const { groupId, text, senderId, senderName, senderPhoto, messageType, imageUrl, locationName, latitude, longitude } = req.body;
  
  if (!groupId || !senderId || !senderName || !messageType) {
    res.status(400).json({ error: 'Missing required message parameters' });
    return;
  }

  if (!db.messages[groupId]) {
    db.messages[groupId] = [];
  }

  const newMessage: Message = {
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    text: text || '',
    senderId,
    senderName,
    senderPhoto: senderPhoto || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(senderName)}`,
    createdAt: new Date().toISOString(),
    messageType,
    imageUrl,
    locationName,
    latitude,
    longitude
  };

  db.messages[groupId].push(newMessage);
  
  // Cap messages per group to last 200 items for memory stability
  if (db.messages[groupId].length > 200) {
    db.messages[groupId].shift();
  }

  // Update user last active
  if (db.users[senderId]) {
    db.users[senderId].lastActive = new Date().toISOString();
    broadcast('user_update', db.users[senderId]);
  }

  saveDB();
  broadcast('message', { groupId, message: newMessage });
  res.json({ success: true, message: newMessage });
});

// React / Unreact to a message
app.post('/api/messages/react', (req, res) => {
  const { groupId, messageId, emoji, userId } = req.body;
  if (!groupId || !messageId || !emoji || !userId) {
    res.status(400).json({ error: 'Missing required reaction parameters' });
    return;
  }

  const roomMessages = db.messages[groupId];
  if (!roomMessages) {
    res.status(404).json({ error: 'Group room not found' });
    return;
  }

  const message = roomMessages.find(m => m.id === messageId);
  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  if (!message.reactions) {
    message.reactions = {};
  }

  if (!message.reactions[emoji]) {
    message.reactions[emoji] = [];
  }

  const userIndex = message.reactions[emoji].indexOf(userId);
  if (userIndex > -1) {
    // User already reacted, toggle/remove it
    message.reactions[emoji].splice(userIndex, 1);
    if (message.reactions[emoji].length === 0) {
      delete message.reactions[emoji];
    }
  } else {
    // Add reaction
    message.reactions[emoji].push(userId);
  }

  saveDB();
  broadcast('message_reaction', { groupId, messageId, reactions: message.reactions });
  res.json({ success: true, reactions: message.reactions });
});

// Photo Base64 File Upload Handler (No Multer required, very robust for Cloud Run)
app.post('/api/upload', (req, res) => {
  const { base64, filename } = req.body;
  if (!base64 || !filename) {
    res.status(400).json({ error: 'Missing base64 payload or filename' });
    return;
  }

  try {
    // base64 contains: data:image/png;base64,.....
    const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      res.status(400).json({ error: 'Invalid base64 format' });
      return;
    }

    const imageBuffer = Buffer.from(matches[2], 'base64');
    const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const filePath = path.join(uploadsDir, safeFilename);

    fs.writeFileSync(filePath, imageBuffer);
    
    const publicUrl = `/uploads/${safeFilename}`;
    res.json({ success: true, imageUrl: publicUrl });
  } catch (err: any) {
    console.error('File write failure:', err);
    res.status(500).json({ error: 'Failed to write uploaded image' });
  }
});

// Typing indicator trigger (volatile realtime broadcast, no persist)
app.post('/api/typing', (req, res) => {
  const { groupId, username, isTyping } = req.body;
  if (!groupId || !username) {
    res.status(400).send('Missing parameters');
    return;
  }
  broadcast('typing', { groupId, username, isTyping });
  res.sendStatus(200);
});

// Initialize Vite server for asset handling
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static assets
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Unstapple Boys full-stack hub online at: http://localhost:${PORT}`);
  });
}

startServer();
