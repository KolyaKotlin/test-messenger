const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  user: 'messengeruser',
  host: 'localhost',
  database: 'messenger',
  password: '12345',
  port: 5432,
});

const JWT_SECRET = 'your_super_secret_key_change_this_in_production';

// Список валидных ключей регистрации (можно заменить на проверку в БД)
const VALID_KEYS = [
  'DEMO1234ABCD5678',
  'TEST5678EFGH1234',
  'KEY9876WXYZ5432'
];

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        is_group BOOLEAN DEFAULT FALSE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_participants (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(chat_id, user_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        username VARCHAR(50),
        text TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT NOW(),
        edited BOOLEAN DEFAULT FALSE,
        edited_at TIMESTAMP
      );
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

initDB();

// ============= AUTH ENDPOINTS =============

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, key } = req.body;

    if (!username || !email || !password || !key) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    // Проверка длины ключа
    if (key.length !== 16) {
      return res.status(400).json({ error: 'Ключ должен содержать 16 символов' });
    }

    // Проверка валидности ключа
    if (!VALID_KEYS.includes(key)) {
      return res.status(400).json({ error: 'Неверный ключ регистрации' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, hashedPassword]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ error: 'Username или email уже существует' });
    } else {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const loginField = email || username;

    if (!loginField || !password) {
      return res.status(400).json({ error: 'Email/username и пароль обязательны' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $1',
      [loginField]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверные данные' });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Неверные данные' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============= USER ENDPOINTS =============

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username FROM users ORDER BY username ASC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ============= CHAT ENDPOINTS =============

app.post('/api/chats/private', async (req, res) => {
  try {
    const { userId, otherUserId } = req.body;

    if (!userId || !otherUserId) {
      return res.status(400).json({ error: 'User IDs are required' });
    }

    // Проверка существующего чата
    const existingChat = await pool.query(`
      SELECT c.id, c.name, c.is_group, c.created_at
      FROM chats c
      WHERE c.is_group = FALSE
      AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = $1)
      AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = $2)
      AND (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) = 2
    `, [userId, otherUserId]);

    if (existingChat.rows.length > 0) {
      return res.json({
        chat: existingChat.rows[0],
        existed: true
      });
    }

    const chatResult = await pool.query(
      'INSERT INTO chats (is_group, created_by) VALUES (FALSE, $1) RETURNING *',
      [userId]
    );

    const chat = chatResult.rows[0];

    await pool.query(
      'INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)',
      [chat.id, userId, otherUserId]
    );

    res.json({ chat, existed: false });

  } catch (error) {
    console.error('Error creating private chat:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

app.post('/api/chats/group', async (req, res) => {
  try {
    const { userId, name, participants } = req.body;

    if (!userId || !name || !participants || participants.length === 0) {
      return res.status(400).json({ error: 'Name and participants are required' });
    }

    const chatResult = await pool.query(
      'INSERT INTO chats (name, is_group, created_by) VALUES ($1, TRUE, $2) RETURNING *',
      [name, userId]
    );

    const chat = chatResult.rows[0];

    const allParticipants = [userId, ...participants.filter(p => p !== userId)];

    const values = allParticipants.map((_, i) => `($1, $${i + 2})`).join(', ');
    await pool.query(
      `INSERT INTO chat_participants (chat_id, user_id) VALUES ${values}`,
      [chat.id, ...allParticipants]
    );

    res.json({ chat });

  } catch (error) {
    console.error('Error creating group chat:', error);
    res.status(500).json({ error: 'Failed to create group chat' });
  }
});

app.get('/api/chats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`
      SELECT
        c.id,
        c.name,
        c.is_group,
        c.created_at,
        ARRAY_AGG(DISTINCT jsonb_build_object('id', u.id, 'username', u.username)) as participants,
        (SELECT jsonb_build_object(
          'text', m.text,
          'username', m.username,
          'timestamp', m.timestamp
        ) FROM messages m WHERE m.chat_id = c.id ORDER BY m.timestamp DESC LIMIT 1) as last_message
      FROM chats c
      INNER JOIN chat_participants cp ON c.id = cp.chat_id
      INNER JOIN users u ON cp.user_id = u.id
      WHERE c.id IN (
        SELECT chat_id FROM chat_participants WHERE user_id = $1
      )
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [userId]);

    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;

    const result = await pool.query(
      'SELECT * FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC',
      [chatId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Редактирование сообщения
app.put('/api/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text, userId } = req.body;

    const message = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);

    if (message.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query(
      'UPDATE messages SET text = $1, edited = TRUE, edited_at = NOW() WHERE id = $2',
      [text, messageId]
    );

    res.json({ success: true });

  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Удаление сообщения у всех
app.delete('/api/messages/:messageId/all', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    const message = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);

    if (message.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);

    res.json({ success: true });

  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

app.post('/api/chats/:chatId/participants', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;

    await pool.query(
      'INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [chatId, userId]
    );

    res.json({ success: true });

  } catch (error) {
    console.error('Error adding participant:', error);
    res.status(500).json({ error: 'Failed to add participant' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ============= WEBSOCKET =============

let connectedUsers = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('authenticate', async (data) => {
    try {
      const { token } = data;
      const decoded = jwt.verify(token, JWT_SECRET);

      socket.userId = decoded.id;
      socket.username = decoded.username;

      connectedUsers[socket.id] = {
        id: decoded.id,
        username: decoded.username,
        socketId: socket.id
      };

      io.emit('users', Object.values(connectedUsers));

      console.log('User authenticated:', decoded.username);

    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('auth_error', { error: 'Invalid token' });
    }
  });

  socket.on('join_chat', (data) => {
    const { chatId } = data;
    socket.join(`chat_${chatId}`);
    console.log(`User ${socket.username} joined chat ${chatId}`);
  });

  socket.on('leave_chat', (data) => {
    const { chatId } = data;
    socket.leave(`chat_${chatId}`);
    console.log(`User ${socket.username} left chat ${chatId}`);
  });

  socket.on('message', async (data) => {
    try {
      if (!socket.userId) {
        socket.emit('error', { error: 'Not authenticated' });
        return;
      }

      const { chatId, text } = data;

      if (!chatId || !text) {
        socket.emit('error', { error: 'Chat ID and text are required' });
        return;
      }

      const participant = await pool.query(
        'SELECT * FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
        [chatId, socket.userId]
      );

      if (participant.rows.length === 0) {
        socket.emit('error', { error: 'You are not a participant of this chat' });
        return;
      }

      const result = await pool.query(
        'INSERT INTO messages (chat_id, user_id, username, text) VALUES ($1, $2, $3, $4) RETURNING *',
        [chatId, socket.userId, socket.username, text]
      );

      const message = result.rows[0];

      io.to(`chat_${chatId}`).emit('message', {
        id: message.id,
        chatId: message.chat_id,
        userId: message.user_id,
        username: message.username,
        text: message.text,
        timestamp: message.timestamp,
        edited: message.edited
      });

      console.log(`Message from ${socket.username} in chat ${chatId}:`, text);

    } catch (error) {
      console.error('Message error:', error);
      socket.emit('error', { error: 'Failed to send message' });
    }
  });

  // Редактирование сообщения
  socket.on('edit_message', async (data) => {
    const { messageId, text, chatId } = data;

    try {
      await pool.query(
        'UPDATE messages SET text = $1, edited = TRUE, edited_at = NOW() WHERE id = $2 AND user_id = $3',
        [text, messageId, socket.userId]
      );

      io.to(`chat_${chatId}`).emit('message_edited', {
        messageId,
        text,
        edited: true
      });

    } catch (error) {
      console.error('Edit message error:', error);
    }
  });

  // Удаление сообщения у всех
  socket.on('delete_message_all', async (data) => {
    const { messageId, chatId } = data;

    try {
      await pool.query('DELETE FROM messages WHERE id = $1 AND user_id = $2', [messageId, socket.userId]);

      io.to(`chat_${chatId}`).emit('message_deleted', { messageId });

    } catch (error) {
      console.error('Delete message error:', error);
    }
  });

  // ========== TYPING INDICATOR ==========

  socket.on('typing_start', (data) => {
    const { chatId, userId, username } = data;
    socket.to(`chat_${chatId}`).emit('typing_start', { chatId, userId, username });
  });

  socket.on('typing_stop', (data) => {
    const { chatId, userId } = data;
    socket.to(`chat_${chatId}`).emit('typing_stop', { chatId, userId });
  });

  // ========== VOICE/VIDEO CALLS ==========

  socket.on('call_initiate', (data) => {
    const { targetUserId, offer } = data;

    const targetSocketId = Object.keys(connectedUsers).find(
      socketId => connectedUsers[socketId].id === targetUserId
    );

    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming_call', {
        callerId: socket.userId,
        callerName: socket.username,
        offer
      });
      console.log(`📞 Call from ${socket.username} to user ${targetUserId}`);
    } else {
      socket.emit('call_error', { error: 'User is offline' });
    }
  });

  socket.on('call_answer', (data) => {
    const { callerId, answer } = data;

    const callerSocketId = Object.keys(connectedUsers).find(
        id => connectedUsers[id].id === callerId
    );

    if (callerSocketId) {
        io.to(callerSocketId).emit('call_answered', {
            answer: answer,
            answererId: socket.userId
        });

        console.log(`📞 Call answered: ${socket.userId} → ${callerId}`);
    }
});

  socket.on('call_reject', (data) => {
    const { callerId } = data;

    const callerSocketId = Object.keys(connectedUsers).find(
      socketId => connectedUsers[socketId].id === callerId
    );

    if (callerSocketId) {
      io.to(callerSocketId).emit('call_rejected');
      console.log(`❌ Call rejected by user ${socket.userId}`);
    }
  });

  socket.on('call_end', (data) => {
    const { targetUserId } = data;

    const targetSocketId = Object.keys(connectedUsers).find(
      socketId => connectedUsers[socketId].id === targetUserId
    );

    if (targetSocketId) {
      io.to(targetSocketId).emit('call_ended');
      console.log(`📴 Call ended between ${socket.username} and user ${targetUserId}`);
    }
  });

  socket.on('ice_candidate', (data) => {
    const { targetUserId, candidate } = data;

    const targetSocketId = Object.keys(connectedUsers).find(
      socketId => connectedUsers[socketId].id === targetUserId
    );

    if (targetSocketId) {
      io.to(targetSocketId).emit('ice_candidate', {
        candidate,
        fromUserId: socket.userId
      });
    }
  });

  // ========== DISCONNECT ==========

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Уведомляем всех о завершении звонков с этим пользователем
    Object.keys(connectedUsers).forEach(socketId => {
      if (socketId !== socket.id) {
        io.to(socketId).emit('user_disconnected', {
          userId: socket.userId
        });
      }
    });

    delete connectedUsers[socket.id];
    io.emit('users', Object.values(connectedUsers));
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Server running on port ' + PORT);
});
