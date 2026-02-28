// ============================================================
// DEVROOTS COMMUNITY — BACKEND SERVER
// Stack: Node.js + Express + PostgreSQL (Supabase)
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'devroots-secret-change-me';

// ============================================================
// DATABASE CONNECTION
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper to run queries
async function db(query, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result;
  } finally {
    client.release();
  }
}

// ============================================================
// DATABASE SETUP — Create Tables
// ============================================================
async function initDatabase() {
  console.log('🗄️  Setting up database tables...');

  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      google_id VARCHAR(255),
      role VARCHAR(20) DEFAULT 'member',
      avatar VARCHAR(10) DEFAULT '👤',
      bio TEXT DEFAULT '',
      reputation INTEGER DEFAULT 0,
      is_banned BOOLEAN DEFAULT FALSE,
      ban_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Add google_id column if not exists (for existing databases)
  await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255)`).catch(() => {});

  await db(`
    CREATE TABLE IF NOT EXISTS forum_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      name_ar VARCHAR(100),
      slug VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      description_ar TEXT,
      icon VARCHAR(10) DEFAULT '📁',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS threads (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES forum_categories(id),
      author_id INTEGER REFERENCES users(id),
      title VARCHAR(255) NOT NULL,
      title_ar VARCHAR(255),
      is_pinned BOOLEAN DEFAULT FALSE,
      is_locked BOOLEAN DEFAULT FALSE,
      is_deleted BOOLEAN DEFAULT FALSE,
      view_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER REFERENCES threads(id),
      author_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      content_ar TEXT,
      is_deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER REFERENCES posts(id),
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(post_id, user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) UNIQUE NOT NULL
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS thread_tags (
      thread_id INTEGER REFERENCES threads(id),
      tag_id INTEGER REFERENCES tags(id),
      PRIMARY KEY(thread_id, tag_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER REFERENCES users(id),
      title VARCHAR(255) NOT NULL,
      title_ar VARCHAR(255),
      description TEXT,
      description_ar TEXT,
      price DECIMAL(10,2) NOT NULL,
      category VARCHAR(50),
      image VARCHAR(10) DEFAULT '📦',
      file_path VARCHAR(500),
      is_approved BOOLEAN DEFAULT FALSE,
      is_deleted BOOLEAN DEFAULT FALSE,
      total_sales INTEGER DEFAULT 0,
      average_rating DECIMAL(3,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      user_id INTEGER REFERENCES users(id),
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(product_id, user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      buyer_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      amount DECIMAL(10,2) NOT NULL,
      platform_fee DECIMAL(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS user_balances (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      balance DECIMAL(10,2) DEFAULT 0,
      total_earned DECIMAL(10,2) DEFAULT 0,
      total_withdrawn DECIMAL(10,2) DEFAULT 0
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      type VARCHAR(50),
      message TEXT,
      message_ar TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      link VARCHAR(500),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES users(id),
      action VARCHAR(100),
      target_type VARCHAR(50),
      target_id INTEGER,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Direct Messages
  await db(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id),
      receiver_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Support Tickets
  await db(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      subject VARCHAR(255) NOT NULL,
      category VARCHAR(50) DEFAULT 'general',
      priority VARCHAR(20) DEFAULT 'normal',
      status VARCHAR(20) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS ticket_replies (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id),
      user_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      is_staff BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Seed default categories
  const { rows } = await db('SELECT COUNT(*) as count FROM forum_categories');
  if (parseInt(rows[0].count) === 0) {
    console.log('🌱 Seeding default forum categories...');
    const cats = [
      // Administration & News
      ['Platform Announcements', 'إعلانات المنصة', 'announcements', 'Official DevRoots news and updates', 'أخبار وتحديثات DevRoots الرسمية', '📢', 1],
      ['Rules & Welcoming', 'القوانين والترحيب', 'rules-welcome', 'Space for new members and community guidelines', 'مساحة للأعضاء الجدد وإرشادات المجتمع', '👋', 2],
      // Rappelz Development Hub
      ['Core Development', 'التطوير الأساسي', 'core-dev', 'Server files, database integration, and performance optimization', 'ملفات السيرفر وتكامل قواعد البيانات وتحسين الأداء', '⚙️', 3],
      ['Rendering & Graphics', 'الرسوميات والعرض', 'rendering', 'DX11 migration, client-side graphical edits, and shaders', 'ترحيل DX11 وتعديلات الرسوميات وتظليل العميل', '🎨', 4],
      ['Scripting & Mechanics', 'البرمجة والميكانيكا', 'scripting', 'Lua scripts, XML files, and custom in-game logic', 'سكربتات Lua وملفات XML ومنطق اللعبة المخصص', '📜', 5],
      ['User Interface (UI/UX)', 'واجهة المستخدم', 'ui-ux', 'Game interface modifications and styling', 'تعديلات واجهة اللعبة والتنسيق', '🖥️', 6],
      // Creative & 3D Design
      ['3D Modeling', 'النمذجة ثلاثية الأبعاد', '3d-modeling', 'Custom weapons, pets, and map assets', 'أسلحة مخصصة وحيوانات أليفة وأصول الخريطة', '🎭', 7],
      ['2D Design', 'التصميم ثنائي الأبعاد', '2d-design', 'Logos, icons, and promotional banners', 'شعارات وأيقونات ولافتات ترويجية', '🖼️', 8],
      // Tutorials & Support
      ['Knowledge Base', 'قاعدة المعرفة', 'knowledge-base', 'Exclusive tutorials for beginners and advanced developers', 'دروس حصرية للمبتدئين والمطورين المتقدمين', '📚', 9],
      ['Troubleshooting & Support', 'استكشاف الأخطاء والدعم', 'troubleshooting', 'Dedicated area for technical assistance and Q&A', 'منطقة مخصصة للمساعدة التقنية والأسئلة والأجوبة', '🆘', 10],
    ];
    for (const c of cats) {
      await db('INSERT INTO forum_categories (name, name_ar, slug, description, description_ar, icon, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)', c);
    }
    console.log('✅ Categories seeded');
  }

  // Create default admin account
  const adminCheck = await db("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
  if (parseInt(adminCheck.rows[0].count) === 0) {
    console.log('🔑 Creating default admin account...');
    const hash = await bcrypt.hash('admin123', 10);
    await db(
      "INSERT INTO users (username, email, password_hash, role, avatar, reputation) VALUES ($1,$2,$3,$4,$5,$6)",
      ['DragonForge', 'admin@devroots.com', hash, 'admin', '🐉', 2340]
    );
    console.log('✅ Admin created: admin@devroots.com / admin123');
  }

  console.log('✅ Database ready!');
}

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// File upload
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.zip', '.rar', '.7z', '.png', '.jpg', '.jpeg'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (!['admin', 'tech-moderator', 'arch-developer'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ============================================================
// AUTH ROUTES
// ============================================================

// Firebase Authentication
app.post('/api/auth/firebase', async (req, res) => {
  try {
    const { idToken, displayName, email, photoURL, uid } = req.body;
    if (!email || !uid) return res.status(400).json({ error: 'Firebase auth data required' });

    // Verify the Firebase token by checking with Google's public keys
    // For production, use firebase-admin SDK. For now we trust the client-verified token.
    const base64Url = idToken.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString());
    
    // Verify email matches token
    if (payload.email !== email) return res.status(401).json({ error: 'Token email mismatch' });

    // Check if user exists
    let result = await db('SELECT * FROM users WHERE email = $1', [email]);
    let user = result.rows[0];

    if (user) {
      // Existing user — update firebase uid if not set
      if (!user.google_id) {
        await db('UPDATE users SET google_id = $1 WHERE id = $2', [uid, user.id]);
      }
      if (user.is_banned) return res.status(403).json({ error: 'Account banned', reason: user.ban_reason });
    } else {
      // New user — create account
      const rawName = displayName || email.split('@')[0];
      const username = rawName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'User' + Date.now();
      const usernameCheck = await db('SELECT id FROM users WHERE username = $1', [username]);
      const finalUsername = usernameCheck.rows.length > 0 ? username + Math.floor(Math.random() * 999) : username;
      
      const avatarEmoji = ['🧑‍💻','👨‍💻','👩‍💻','🦊','🐲','🎮','⚡','🔥','💎','🌟'][Math.floor(Math.random() * 10)];
      result = await db(
        'INSERT INTO users (username, email, password_hash, google_id, avatar) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, email, role, avatar, reputation',
        [finalUsername, email, 'FIREBASE_AUTH', uid, avatarEmoji]
      );
      user = result.rows[0];
      await db('INSERT INTO user_balances (user_id) VALUES ($1)', [user.id]);
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) {
    console.error('Firebase auth error:', e);
    res.status(500).json({ error: 'Firebase authentication failed' });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });

    const existing = await db('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username or email already taken' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db(
      'INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username, email, role, avatar, reputation',
      [username, email, hash]
    );
    const user = result.rows[0];

    // Create balance record
    await db('INSERT INTO user_balances (user_id) VALUES ($1)', [user.id]);

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await db('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_banned) return res.status(403).json({ error: 'Account banned', reason: user.ban_reason });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const result = await db('SELECT id, username, email, role, avatar, bio, reputation, created_at FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// FORUM ROUTES
// ============================================================
app.get('/api/forums/categories', async (req, res) => {
  try {
    const result = await db(`
      SELECT fc.*,
        (SELECT COUNT(*) FROM threads WHERE category_id = fc.id AND is_deleted = FALSE) as thread_count,
        (SELECT COUNT(*) FROM posts p JOIN threads t ON p.thread_id = t.id WHERE t.category_id = fc.id AND p.is_deleted = FALSE) as post_count
      FROM forum_categories fc ORDER BY sort_order
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/forums/categories/:slug/threads', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const cat = await db('SELECT * FROM forum_categories WHERE slug = $1', [req.params.slug]);
    if (cat.rows.length === 0) return res.status(404).json({ error: 'Category not found' });

    const threads = await db(`
      SELECT t.*, u.username as author_name, u.avatar as author_avatar, u.role as author_role,
        (SELECT COUNT(*) FROM posts WHERE thread_id = t.id AND is_deleted = FALSE) - 1 as reply_count,
        (SELECT MAX(created_at) FROM posts WHERE thread_id = t.id) as last_post_at
      FROM threads t
      JOIN users u ON t.author_id = u.id
      WHERE t.category_id = $1 AND t.is_deleted = FALSE
      ORDER BY t.is_pinned DESC, t.updated_at DESC
      LIMIT $2 OFFSET $3
    `, [cat.rows[0].id, limit, offset]);

    const total = await db('SELECT COUNT(*) as count FROM threads WHERE category_id = $1 AND is_deleted = FALSE', [cat.rows[0].id]);

    res.json({
      category: cat.rows[0],
      threads: threads.rows,
      pagination: { page, limit, total: parseInt(total.rows[0].count) }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/forums/threads', auth, async (req, res) => {
  try {
    const { category_id, title, title_ar, content, content_ar, tags } = req.body;
    if (!category_id || !title || !content) return res.status(400).json({ error: 'Category, title, and content required' });

    const thread = await db(
      'INSERT INTO threads (category_id, author_id, title, title_ar) VALUES ($1,$2,$3,$4) RETURNING *',
      [category_id, req.user.id, title, title_ar || null]
    );

    await db(
      'INSERT INTO posts (thread_id, author_id, content, content_ar) VALUES ($1,$2,$3,$4)',
      [thread.rows[0].id, req.user.id, content, content_ar || null]
    );

    // Handle tags
    if (tags && Array.isArray(tags)) {
      for (const tagName of tags) {
        let tag = await db('SELECT id FROM tags WHERE name = $1', [tagName.toLowerCase().trim()]);
        if (tag.rows.length === 0) {
          tag = await db('INSERT INTO tags (name) VALUES ($1) RETURNING id', [tagName.toLowerCase().trim()]);
        }
        await db('INSERT INTO thread_tags (thread_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [thread.rows[0].id, tag.rows[0].id]);
      }
    }

    await db('UPDATE users SET reputation = reputation + 5 WHERE id = $1', [req.user.id]);
    res.status(201).json(thread.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

app.get('/api/forums/threads/:id', async (req, res) => {
  try {
    const thread = await db(`
      SELECT t.*, u.username as author_name, u.avatar as author_avatar, u.role as author_role,
        fc.name as category_name, fc.name_ar as category_name_ar, fc.slug as category_slug
      FROM threads t
      JOIN users u ON t.author_id = u.id
      JOIN forum_categories fc ON t.category_id = fc.id
      WHERE t.id = $1 AND t.is_deleted = FALSE
    `, [req.params.id]);

    if (thread.rows.length === 0) return res.status(404).json({ error: 'Thread not found' });

    // Increment view count
    await db('UPDATE threads SET view_count = view_count + 1 WHERE id = $1', [req.params.id]);

    const posts = await db(`
      SELECT p.*, u.username as author_name, u.avatar as author_avatar, u.role as author_role,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as like_count
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.thread_id = $1 AND p.is_deleted = FALSE
      ORDER BY p.created_at ASC
    `, [req.params.id]);

    const tags = await db(`
      SELECT t.name FROM tags t
      JOIN thread_tags tt ON t.id = tt.tag_id
      WHERE tt.thread_id = $1
    `, [req.params.id]);

    res.json({
      thread: thread.rows[0],
      posts: posts.rows,
      tags: tags.rows.map(t => t.name)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/forums/threads/:id/reply', auth, async (req, res) => {
  try {
    const { content, content_ar } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    const thread = await db('SELECT * FROM threads WHERE id = $1 AND is_deleted = FALSE', [req.params.id]);
    if (thread.rows.length === 0) return res.status(404).json({ error: 'Thread not found' });
    if (thread.rows[0].is_locked) return res.status(403).json({ error: 'Thread is locked' });

    const post = await db(
      'INSERT INTO posts (thread_id, author_id, content, content_ar) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.id, req.user.id, content, content_ar || null]
    );

    await db('UPDATE threads SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    await db('UPDATE users SET reputation = reputation + 2 WHERE id = $1', [req.user.id]);

    // Notify thread author
    if (thread.rows[0].author_id !== req.user.id) {
      await db(
        'INSERT INTO notifications (user_id, type, message, message_ar, link) VALUES ($1,$2,$3,$4,$5)',
        [thread.rows[0].author_id, 'reply', `${req.user.username} replied to your thread`, `${req.user.username} رد على موضوعك`, `/thread/${req.params.id}`]
      );
    }

    res.status(201).json(post.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to post reply' });
  }
});

app.post('/api/forums/posts/:id/like', auth, async (req, res) => {
  try {
    const existing = await db('SELECT id FROM post_likes WHERE post_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (existing.rows.length > 0) {
      await db('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      res.json({ liked: false });
    } else {
      await db('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2)', [req.params.id, req.user.id]);
      const post = await db('SELECT author_id FROM posts WHERE id = $1', [req.params.id]);
      if (post.rows[0] && post.rows[0].author_id !== req.user.id) {
        await db('UPDATE users SET reputation = reputation + 1 WHERE id = $1', [post.rows[0].author_id]);
      }
      res.json({ liked: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// SHOP ROUTES
// ============================================================
app.get('/api/shop/products', async (req, res) => {
  try {
    const category = req.query.category;
    let query = `
      SELECT p.*, u.username as seller_name, u.avatar as seller_avatar, u.reputation as seller_reputation
      FROM products p JOIN users u ON p.seller_id = u.id
      WHERE p.is_approved = TRUE AND p.is_deleted = FALSE
    `;
    const params = [];
    if (category) {
      query += ' AND p.category = $1';
      params.push(category);
    }
    query += ' ORDER BY p.created_at DESC';
    const result = await db(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/shop/products/:id', async (req, res) => {
  try {
    const product = await db(`
      SELECT p.*, u.username as seller_name, u.avatar as seller_avatar, u.reputation as seller_reputation
      FROM products p JOIN users u ON p.seller_id = u.id
      WHERE p.id = $1 AND p.is_deleted = FALSE
    `, [req.params.id]);

    if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    const reviews = await db(`
      SELECT r.*, u.username, u.avatar FROM product_reviews r
      JOIN users u ON r.user_id = u.id WHERE r.product_id = $1 ORDER BY r.created_at DESC
    `, [req.params.id]);

    res.json({ product: product.rows[0], reviews: reviews.rows });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/shop/products', auth, async (req, res) => {
  try {
    const { title, title_ar, description, description_ar, price, category } = req.body;
    if (!title || !price || !category) return res.status(400).json({ error: 'Title, price, and category required' });

    const result = await db(
      'INSERT INTO products (seller_id, title, title_ar, description, description_ar, price, category) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.id, title, title_ar || null, description, description_ar || null, price, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.post('/api/shop/products/:id/purchase', auth, async (req, res) => {
  try {
    const product = await db('SELECT * FROM products WHERE id = $1 AND is_approved = TRUE AND is_deleted = FALSE', [req.params.id]);
    if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    if (product.rows[0].seller_id === req.user.id) return res.status(400).json({ error: 'Cannot buy your own product' });

    const platformFee = product.rows[0].price * 0.10;
    const sellerAmount = product.rows[0].price - platformFee;

    await db(
      'INSERT INTO orders (buyer_id, product_id, amount, platform_fee) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.params.id, product.rows[0].price, platformFee]
    );

    await db('UPDATE products SET total_sales = total_sales + 1 WHERE id = $1', [req.params.id]);
    await db(`
      INSERT INTO user_balances (user_id, balance, total_earned) VALUES ($1,$2,$2)
      ON CONFLICT (user_id) DO UPDATE SET balance = user_balances.balance + $2, total_earned = user_balances.total_earned + $2
    `, [product.rows[0].seller_id, sellerAmount]);

    res.json({ message: 'Purchase successful' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

app.post('/api/shop/products/:id/review', auth, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

    await db(
      'INSERT INTO product_reviews (product_id, user_id, rating, comment) VALUES ($1,$2,$3,$4) ON CONFLICT (product_id, user_id) DO UPDATE SET rating = $3, comment = $4',
      [req.params.id, req.user.id, rating, comment]
    );

    const avg = await db('SELECT AVG(rating) as avg_rating FROM product_reviews WHERE product_id = $1', [req.params.id]);
    await db('UPDATE products SET average_rating = $1 WHERE id = $2', [parseFloat(avg.rows[0].avg_rating).toFixed(2), req.params.id]);

    res.json({ message: 'Review submitted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// ADMIN ROUTES
// ============================================================
app.get('/api/admin/stats', auth, adminOnly, async (req, res) => {
  try {
    const users = await db('SELECT COUNT(*) as count FROM users');
    const threads = await db('SELECT COUNT(*) as count FROM threads WHERE is_deleted = FALSE');
    const posts = await db('SELECT COUNT(*) as count FROM posts WHERE is_deleted = FALSE');
    const products = await db('SELECT COUNT(*) as count FROM products WHERE is_deleted = FALSE');
    const pending = await db('SELECT COUNT(*) as count FROM products WHERE is_approved = FALSE AND is_deleted = FALSE');
    const revenue = await db('SELECT COALESCE(SUM(platform_fee), 0) as total FROM orders');

    res.json({
      users: parseInt(users.rows[0].count),
      threads: parseInt(threads.rows[0].count),
      posts: parseInt(posts.rows[0].count),
      products: parseInt(products.rows[0].count),
      pendingApprovals: parseInt(pending.rows[0].count),
      totalRevenue: parseFloat(revenue.rows[0].total)
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  try {
    const result = await db('SELECT id, username, email, role, avatar, reputation, is_banned, ban_reason, created_at FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/users/:id/ban', auth, adminOnly, async (req, res) => {
  try {
    const { ban, reason } = req.body;
    await db('UPDATE users SET is_banned = $1, ban_reason = $2 WHERE id = $3', [ban, reason || null, req.params.id]);
    await db('INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, ban ? 'ban_user' : 'unban_user', 'user', req.params.id, reason]);
    res.json({ message: ban ? 'User banned' : 'User unbanned' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/users/:id/role', auth, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['member', 'junior-dev', 'script-master', 'systems-engineer', 'core-architect', 'arch-developer', 'creative-director', 'ui-ux-specialist', 'visual-artist', '3d-modeler', 'content-creator', 'tech-moderator', 'admin'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    await db('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    await db('INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'change_role', 'user', req.params.id, `Changed role to ${role}`]);
    res.json({ message: 'Role updated' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/products/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { approved } = req.body;
    if (approved) {
      await db('UPDATE products SET is_approved = TRUE WHERE id = $1', [req.params.id]);
    } else {
      await db('UPDATE products SET is_deleted = TRUE WHERE id = $1', [req.params.id]);
    }
    await db('INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, approved ? 'approve_product' : 'reject_product', 'product', req.params.id, null]);
    res.json({ message: approved ? 'Product approved' : 'Product rejected' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/threads/:id', auth, adminOnly, async (req, res) => {
  try {
    const { pin, lock, delete: del } = req.body;
    if (pin !== undefined) await db('UPDATE threads SET is_pinned = $1 WHERE id = $2', [pin, req.params.id]);
    if (lock !== undefined) await db('UPDATE threads SET is_locked = $1 WHERE id = $2', [lock, req.params.id]);
    if (del) await db('UPDATE threads SET is_deleted = TRUE WHERE id = $1', [req.params.id]);

    const action = del ? 'delete_thread' : pin !== undefined ? 'pin_thread' : 'lock_thread';
    await db('INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES ($1,$2,$3,$4)',
      [req.user.id, action, 'thread', req.params.id]);
    res.json({ message: 'Thread updated' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/logs', auth, adminOnly, async (req, res) => {
  try {
    const result = await db(`
      SELECT al.*, u.username as admin_name FROM admin_logs al
      JOIN users u ON al.admin_id = u.id ORDER BY al.created_at DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// OTHER ROUTES
// ============================================================
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ threads: [], products: [] });
    const search = `%${q}%`;

    const threads = await db(`
      SELECT t.*, u.username as author_name FROM threads t
      JOIN users u ON t.author_id = u.id
      WHERE (t.title ILIKE $1 OR t.title_ar ILIKE $1) AND t.is_deleted = FALSE
      LIMIT 10
    `, [search]);

    const products = await db(`
      SELECT p.*, u.username as seller_name FROM products p
      JOIN users u ON p.seller_id = u.id
      WHERE (p.title ILIKE $1 OR p.title_ar ILIKE $1) AND p.is_approved = TRUE AND p.is_deleted = FALSE
      LIMIT 10
    `, [search]);

    res.json({ threads: threads.rows, products: products.rows });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/notifications', auth, async (req, res) => {
  try {
    const result = await db('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/notifications/read', auth, async (req, res) => {
  try {
    await db('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'Notifications marked as read' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// SEED DATA — Call once to fill with sample data
// ============================================================
// Reset and re-seed categories
app.post('/api/admin/reset-categories', auth, adminOnly, async (req, res) => {
  try {
    await db('DELETE FROM posts');
    await db('DELETE FROM threads');
    await db('DELETE FROM forum_categories');
    // Re-seed
    const cats = [
      ['Platform Announcements', 'إعلانات المنصة', 'announcements', 'Official DevRoots news and updates', 'أخبار وتحديثات DevRoots الرسمية', '📢', 1],
      ['Rules & Welcoming', 'القوانين والترحيب', 'rules-welcome', 'Space for new members and community guidelines', 'مساحة للأعضاء الجدد وإرشادات المجتمع', '👋', 2],
      ['Core Development', 'التطوير الأساسي', 'core-dev', 'Server files, database integration, and performance optimization', 'ملفات السيرفر وتكامل قواعد البيانات وتحسين الأداء', '⚙️', 3],
      ['Rendering & Graphics', 'الرسوميات والعرض', 'rendering', 'DX11 migration, client-side graphical edits, and shaders', 'ترحيل DX11 وتعديلات الرسوميات وتظليل العميل', '🎨', 4],
      ['Scripting & Mechanics', 'البرمجة والميكانيكا', 'scripting', 'Lua scripts, XML files, and custom in-game logic', 'سكربتات Lua وملفات XML ومنطق اللعبة المخصص', '📜', 5],
      ['User Interface (UI/UX)', 'واجهة المستخدم', 'ui-ux', 'Game interface modifications and styling', 'تعديلات واجهة اللعبة والتنسيق', '🖥️', 6],
      ['3D Modeling', 'النمذجة ثلاثية الأبعاد', '3d-modeling', 'Custom weapons, pets, and map assets', 'أسلحة مخصصة وحيوانات أليفة وأصول الخريطة', '🎭', 7],
      ['2D Design', 'التصميم ثنائي الأبعاد', '2d-design', 'Logos, icons, and promotional banners', 'شعارات وأيقونات ولافتات ترويجية', '🖼️', 8],
      ['Knowledge Base', 'قاعدة المعرفة', 'knowledge-base', 'Exclusive tutorials for beginners and advanced developers', 'دروس حصرية للمبتدئين والمطورين المتقدمين', '📚', 9],
      ['Troubleshooting & Support', 'استكشاف الأخطاء والدعم', 'troubleshooting', 'Dedicated area for technical assistance and Q&A', 'منطقة مخصصة للمساعدة التقنية والأسئلة والأجوبة', '🆘', 10],
    ];
    for (const c of cats) {
      await db('INSERT INTO forum_categories (name, name_ar, slug, description, description_ar, icon, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)', c);
    }
    res.json({ message: 'Categories reset with 10 new categories' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/seed', auth, adminOnly, async (req, res) => {
  try {
    // Check if already seeded
    const userCount = await db('SELECT COUNT(*) as count FROM users');
    if (parseInt(userCount.rows[0].count) > 5) {
      return res.json({ message: 'Already seeded', skipped: true });
    }

    console.log('🌱 Seeding sample data...');

    // Create sample users
    const sampleUsers = [
      ['NexusCraft', 'nexus@devroots.com', 'arch-developer', '🧙', 'Full-stack dev specializing in Rappelz server emulation. Building custom content since 2018.', 1850],
      ['ByteForge', 'byte@devroots.com', 'core-architect', '⚒️', 'Database expert and server stability specialist. Performance optimization guru.', 1420],
      ['ShadowScript', 'shadow@devroots.com', 'script-master', '🦊', 'NPC scripting enthusiast. Quest designer and Lua expert.', 2100],
      ['RuneMaster', 'rune@devroots.com', 'systems-engineer', '🔮', 'Integration specialist. Linking Electron apps with the web platform.', 980],
      ['PhoenixDev', 'phoenix@devroots.com', 'junior-dev', '🐦', 'New to Rappelz development. Learning server setup and configuration.', 340],
      ['CrystalByte', 'crystal@devroots.com', 'ui-ux-specialist', '💎', 'UI/UX designer focused on React interfaces and game menus.', 1650],
      ['StormCoder', 'storm@devroots.com', 'visual-artist', '⚡', 'Logo designer and banner artist. Creating visual identity for servers.', 520],
      ['IronClad', 'iron@devroots.com', 'tech-moderator', '🛡️', 'Veteran moderator helping new developers in the community.', 3200],
      ['ArtisanX', 'artisan@devroots.com', '3d-modeler', '🎭', 'Specialized in weapons, armor, and map terrain 3D models.', 1100],
      ['NovaWriter', 'nova@devroots.com', 'content-creator', '📝', 'Technical writer creating tutorials and documentation.', 870],
      ['VisionForge', 'vision@devroots.com', 'creative-director', '🎬', 'Overall artistic vision lead for game and website design.', 1950],
    ];

    const userIds = [];
    const hash = await bcrypt.hash('password123', 10);
    for (const [username, email, role, avatar, bio, rep] of sampleUsers) {
      const existing = await db('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        userIds.push(existing.rows[0].id);
        continue;
      }
      const r = await db(
        'INSERT INTO users (username, email, password_hash, role, avatar, bio, reputation) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [username, email, hash, role, avatar, bio, rep]
      );
      userIds.push(r.rows[0].id);
      await db('INSERT INTO user_balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [r.rows[0].id]);
    }

    // Get admin user
    const adminUser = await db("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const adminId = adminUser.rows[0]?.id || userIds[0];

    // Get categories
    const cats = await db('SELECT id, slug FROM forum_categories ORDER BY sort_order');
    const catMap = {};
    for (const c of cats.rows) catMap[c.slug] = c.id;

    // Create sample threads and posts
    const sampleThreads = [
      { cat: 'announcements', author: adminId, title: 'Welcome to DevRoots — The Rappelz Developer Community', titleAr: 'مرحباً بكم في DevRoots — مجتمع مطوري رابلز',
        content: "Welcome to DevRoots! This is the official platform for Rappelz private server development.\n\nHere you'll find:\n- Core development discussions\n- 3D modeling resources\n- Scripting tutorials\n- UI/UX design help\n\nPlease read the Rules & Welcoming section before posting.\n\nHappy developing!",
        contentAr: "مرحباً بكم في DevRoots! هذه المنصة الرسمية لتطوير سيرفرات رابلز الخاصة.\n\nستجدون هنا:\n- نقاشات التطوير الأساسي\n- موارد النمذجة ثلاثية الأبعاد\n- دروس البرمجة\n- مساعدة تصميم الواجهات\n\nيرجى قراءة قسم القوانين والترحيب قبل النشر.\n\nتطوير سعيد!",
        pinned: true, tags: ['welcome', 'official'] },
      { cat: 'rules-welcome', author: adminId, title: 'Community Rules & Guidelines', titleAr: 'قوانين وإرشادات المجتمع',
        content: "Community Rules:\n\n1. Be respectful to all members regardless of skill level\n2. No sharing of copyrighted Rappelz official content\n3. Credit original authors when sharing modified work\n4. Use English or Arabic — both are welcome\n5. No spam or self-promotion outside the Shop\n6. Report bugs responsibly\n7. Help others when you can\n\nViolations may result in warnings or bans.",
        pinned: true, tags: ['rules', 'guidelines'] },

      { cat: 'core-dev', author: userIds[0], title: 'Complete Guide: Setting Up EP9.5 Server from Scratch', titleAr: 'دليل كامل: إعداد سيرفر EP9.5 من الصفر',
        content: "Welcome to the definitive guide for setting up your own Rappelz EP9.5 server.\n\nPrerequisites:\n- Windows Server 2019+ or Ubuntu 22.04\n- MySQL 8.0 or MariaDB 10.6\n- .NET Framework 4.8\n- Minimum 8GB RAM, 4 cores\n\nStep 1: Database Setup\nFirst, create your database schema.\n\nStep 2: Server Configuration\nEdit your server.ini with your network settings.\n\nStep 3: Client Patching\nPatch your client data to match the server version.\n\nI'll update this guide regularly!",
        pinned: true, tags: ['guide', 'ep9.5', 'setup'] },
      { cat: 'core-dev', author: userIds[1], title: 'Database Performance Optimization for 500+ Players', titleAr: 'تحسين أداء قاعدة البيانات لأكثر من 500 لاعب',
        content: "After running a 500-player server for 3 years, here are my optimization tips:\n\n1. Connection pooling with ProxySQL\n2. Query caching for frequently accessed data\n3. Index optimization on player tables\n4. Read replicas for non-critical queries\n5. Redis for session management\n\nBenchmarks and full config included below.",
        tags: ['database', 'performance', 'optimization'] },

      { cat: 'rendering', author: userIds[3], title: 'DX11 Migration Progress Report — Month 3', titleAr: 'تقرير تقدم ترحيل DX11 — الشهر الثالث',
        content: "Progress update on the DX9 to DX11 migration project:\n\nCompleted:\n- Shader compilation pipeline\n- Basic terrain rendering\n- Character model loading\n\nIn Progress:\n- Particle effects system\n- Shadow mapping\n- Water reflections\n\nWe need help with the particle system. Any graphics programmers interested?",
        tags: ['dx11', 'graphics', 'migration'] },

      { cat: 'scripting', author: userIds[2], title: 'NPC Scripting Tutorial Series — Part 1: Basics', titleAr: 'سلسلة دروس برمجة NPC — الجزء 1: الأساسيات',
        content: "Starting a comprehensive NPC scripting tutorial series!\n\nPart 1 covers:\n- Understanding the NPC script structure\n- Basic dialog trees\n- Item shop NPCs\n- Quest givers (simple fetch quests)\n- Teleport NPCs\n\nEach example includes the full script with line-by-line explanations.",
        pinned: true, tags: ['tutorial', 'npc', 'scripting'] },
      { cat: 'scripting', author: userIds[2], title: 'Custom Boss AI — Making Fights Interesting', titleAr: 'ذكاء اصطناعي مخصص للبوس — جعل المعارك ممتعة',
        content: "Generic boss fights are boring. Here's how to create dynamic encounters.\n\nPhase-based system:\n- Phase 1 (100-70% HP): Normal attacks\n- Phase 2 (70-40% HP): New skills unlock\n- Phase 3 (40-0% HP): Enrage mode\n\nExample script for a 3-phase dragon boss included.",
        tags: ['boss', 'ai', 'advanced'] },

      { cat: 'ui-ux', author: userIds[5], title: 'Custom UI Framework — Make Your Own Interface', titleAr: 'إطار واجهة مخصص — صمم واجهتك الخاصة',
        content: "I've built a modular UI framework for the Rappelz client interface.\n\nFeatures:\n- Drag-and-drop UI editor\n- Custom color themes\n- Resizable windows\n- XML-based layout system\n- Hot-reload support\n\nDocumentation and source code on GitHub.",
        tags: ['ui', 'framework', 'modding'] },

      { cat: '3d-modeling', author: userIds[8], title: 'Custom Weapon Models Pack — 20+ Swords & Axes', titleAr: 'حزمة نماذج أسلحة مخصصة — 20+ سيوف وفؤوس',
        content: "Releasing my custom weapon pack with 20+ hand-crafted models.\n\nIncludes:\n- 10 unique sword designs\n- 5 axe variants\n- 3 staff models\n- 2 bow designs\n\nAll models are game-ready with UV mapping and textures. Blender source files included.",
        tags: ['3d', 'weapons', 'release'] },

      { cat: '2d-design', author: userIds[6], title: 'DevRoots Logo Design Process & Assets', titleAr: 'عملية تصميم شعار DevRoots والأصول',
        content: "Sharing the design process behind the DevRoots brand identity.\n\nDesign principles:\n- Tree represents organic growth\n- Circuit roots represent technology\n- Green + Amber color palette\n\nFree to use for community projects. Source files (SVG, AI, PNG) available.",
        tags: ['logo', 'branding', 'design'] },

      { cat: 'knowledge-base', author: userIds[9], title: 'Beginner Guide: Your First Week in Rappelz Development', titleAr: 'دليل المبتدئين: أسبوعك الأول في تطوير رابلز',
        content: "New to Rappelz development? Here's your roadmap:\n\nDay 1-2: Set up your development environment\nDay 3-4: Understand the server architecture\nDay 5: Make your first NPC edit\nDay 6: Create a simple quest\nDay 7: Deploy a test server\n\nEach day has step-by-step instructions with screenshots.",
        pinned: true, tags: ['beginner', 'guide', 'tutorial'] },

      { cat: 'troubleshooting', author: userIds[4], title: 'Server crashes when more than 50 players online', titleAr: 'السيرفر يتوقف عند وجود أكثر من 50 لاعب',
        content: "My server consistently crashes when player count exceeds 50.\n\nSpecs: 16GB RAM, 8-core CPU, SSD\nOS: Ubuntu 22.04\nError logs show memory allocation failures.\n\nI've tried increasing swap space and adjusting thread pool size but no luck.\n\nAnyone experienced this? What was your solution?",
        tags: ['crash', 'performance', 'help'] },
    ];

      { cat: 'knowledge-base', author: userIds[7], title: '[Release] EP9.5 Full Server Package — Ready to Deploy', titleAr: '[إصدار] حزمة سيرفر EP9.5 كاملة — جاهزة للنشر',
        content: "Releasing my complete EP9.5 server package for the community.\n\nIncludes:\n- Pre-configured server binaries\n- Complete database with all items/skills/maps\n- Launcher with auto-updater\n- Basic anti-cheat module\n- Setup documentation\n- Docker compose file for easy deployment\n\nTested on Windows Server 2022 and Ubuntu 22.04.\n\nPlease credit if you use this as a base for your server.\n\nReport issues in the Help section.",
        tags: ['ep9.5', 'server-files', 'release'] },
      { cat: 'core-dev', author: userIds[1], title: '[Release] Custom Launcher with Discord Integration', titleAr: '[إصدار] لانشر مخصص مع تكامل ديسكورد',
        content: "New custom launcher release!\n\nFeatures:\n- Modern dark UI with server branding\n- Discord Rich Presence\n- Auto-patch system with progress bar\n- Server status indicator\n- News feed from your website\n- Multi-language support\n\nBuilt with Electron. Fully customizable.\n\nSource code available on GitHub.",
        tags: ['launcher', 'discord', 'electron'] },

      { cat: 'troubleshooting', author: userIds[4], title: 'Server crashes when more than 50 players online', titleAr: 'السيرفر يتوقف عند وجود أكثر من 50 لاعب',
        content: "Hi everyone, I'm new to server development and having a critical issue.\n\nMy server runs fine with under 50 players, but consistently crashes when we hit 50+.\n\nError log shows:\n[FATAL] Memory allocation failed - heap size exceeded\n\nServer specs:\n- Windows 10 (not server edition)\n- 8GB RAM\n- i5-10400\n- MySQL on same machine\n\nI've set the heap size to 4GB but it still crashes. Any help appreciated!",
        tags: ['crash', 'memory', 'help-needed'] },
      { cat: 'troubleshooting', author: userIds[6], title: 'How to compile client from source?', titleAr: 'كيف أقوم بتجميع العميل من المصدر؟',
        content: "I have the client source code but I'm struggling to compile it.\n\nGetting these errors:\n- Missing DirectX SDK headers\n- Linker errors for boost libraries\n- Unknown pragma warnings\n\nI'm using Visual Studio 2022 on Windows 11.\n\nHas anyone successfully compiled the client recently? What SDK versions do I need?\n\nThanks in advance!",
        tags: ['compile', 'client', 'help-needed'] },
    ];

    // Insert threads and their initial posts
    for (const th of sampleThreads) {
      const catId = catMap[th.cat];
      if (!catId) continue;

      const thread = await db(
        'INSERT INTO threads (category_id, author_id, title, title_ar, is_pinned) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [catId, th.author, th.title, th.titleAr || null, th.pinned || false]
      );

      await db(
        'INSERT INTO posts (thread_id, author_id, content, content_ar) VALUES ($1,$2,$3,$4)',
        [thread.rows[0].id, th.author, th.content, th.contentAr || null]
      );

      // Add tags
      if (th.tags) {
        for (const tagName of th.tags) {
          let tag = await db('SELECT id FROM tags WHERE name = $1', [tagName]);
          if (tag.rows.length === 0) {
            tag = await db('INSERT INTO tags (name) VALUES ($1) RETURNING id', [tagName]);
          }
          await db('INSERT INTO thread_tags (thread_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [thread.rows[0].id, tag.rows[0].id]);
        }
      }
    }

    // Add replies to some threads
    const allThreads = await db('SELECT id, author_id FROM threads ORDER BY id LIMIT 14');
    const replies = [
      { content: "Great guide! This saved me hours of troubleshooting. One question - do I need to configure the firewall rules separately for the auth server?", author: userIds[4] },
      { content: "Thanks for this! I followed the steps and got my server running on the first try. The database section was especially clear.", author: userIds[6] },
      { content: "Pro tip: use MariaDB instead of MySQL for better performance with Rappelz. I've benchmarked both and MariaDB handles concurrent connections 20% faster.", author: userIds[7] },
      { content: "I had the same timeout issue. The fix was to add connection pooling at the application level, not just the database level. Check your server's connection handling code.", author: userIds[3] },
      { content: "Have you tried increasing the worker thread count? Default is usually 4, but for 500+ players you need at least 8.", author: userIds[0] },
      { content: "The textures look amazing! Any plans for weapon textures in v3.1?", author: userIds[4] },
      { content: "Incredible work on the UI framework! I'm using it on my server and players love the customizable interface.", author: userIds[7] },
      { content: "This monitoring tool is exactly what I needed. The Discord alerts have caught two potential crashes before they happened.", author: userIds[0] },
      { content: "Looking forward to Part 2! Your tutorial style is very beginner-friendly.", author: userIds[4] },
      { content: "The boss AI system is brilliant. I adapted it for a custom dungeon and my players are having a blast.", author: userIds[7] },
      { content: "Thanks for releasing this! Running it on Docker made setup incredibly easy.", author: userIds[6] },
      { content: "You're running on Windows 10 — that's your problem. Windows 10 has a connection limit. Switch to Windows Server or Linux.", author: userIds[7] },
      { content: "For compilation, you need DirectX SDK June 2010 specifically. Newer versions won't work. Also use Boost 1.72.", author: userIds[0] },
    ];

    for (let i = 0; i < Math.min(replies.length, allThreads.rows.length); i++) {
      const th = allThreads.rows[i];
      await db(
        'INSERT INTO posts (thread_id, author_id, content) VALUES ($1,$2,$3)',
        [th.id, replies[i].author, replies[i].content]
      );
      await db('UPDATE threads SET updated_at = NOW() WHERE id = $1', [th.id]);
    }

    // Add some post likes
    const allPosts = await db('SELECT id FROM posts LIMIT 20');
    for (const post of allPosts.rows) {
      const likers = userIds.sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * 4) + 1);
      for (const liker of likers) {
        await db('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [post.id, liker]);
      }
    }

    // Create sample products
    const sampleProducts = [
      { seller: userIds[1], title: 'HD Texture Pack v3.0', titleAr: 'حزمة نسيج عالية الدقة v3.0', desc: 'Complete texture overhaul for Rappelz EP9.5. All terrain, character, and effect textures remastered in HD.', descAr: 'إعادة تصميم كاملة للنسيج لـ Rappelz EP9.5. جميع نسيج التضاريس والشخصيات والتأثيرات بدقة عالية.', price: 14.99, cat: 'Textures', img: '🎨', approved: true },
      { seller: userIds[3], title: 'ServerMonitor Pro', titleAr: 'مراقب السيرفر برو', desc: 'Real-time web dashboard for monitoring your Rappelz server. Player stats, performance graphs, automated alerts.', descAr: 'لوحة مراقبة ويب في الوقت الحقيقي لسيرفر رابلز. إحصائيات اللاعبين، رسوم الأداء، تنبيهات تلقائية.', price: 24.99, cat: 'Tools', img: '📊', approved: true },
      { seller: userIds[0], title: 'EP9.5 Server Files + Database', titleAr: 'ملفات سيرفر EP9.5 + قاعدة البيانات', desc: 'Complete, tested EP9.5 server package with pre-configured database. Docker support included.', descAr: 'حزمة سيرفر EP9.5 كاملة ومختبرة مع قاعدة بيانات مسبقة التكوين. يتضمن دعم Docker.', price: 0, cat: 'Server Files', img: '📦', approved: true },
      { seller: userIds[5], title: 'UI Framework Kit', titleAr: 'مجموعة إطار الواجهة', desc: 'Modular UI framework for completely redesigning the Rappelz client interface. Drag-and-drop editor included.', descAr: 'إطار واجهة معياري لإعادة تصميم واجهة عميل رابلز بالكامل. يتضمن محرر السحب والإفلات.', price: 19.99, cat: 'Mods', img: '🖥️', approved: true },
      { seller: userIds[2], title: 'NPC Script Collection', titleAr: 'مجموعة سكربتات NPC', desc: '50+ ready-to-use NPC scripts: shops, quest givers, teleporters, event NPCs, custom bosses.', descAr: '50+ سكربت NPC جاهز للاستخدام: متاجر، مانحي مهام، ناقلات، NPCs أحداث، بوسات مخصصة.', price: 9.99, cat: 'Scripts', img: '📜', approved: true },
      { seller: userIds[1], title: 'Custom Launcher v2', titleAr: 'لانشر مخصص v2', desc: 'Modern Electron-based launcher with Discord integration, auto-patcher, and server status.', descAr: 'لانشر حديث مبني على Electron مع تكامل Discord وتحديث تلقائي وحالة السيرفر.', price: 29.99, cat: 'Tools', img: '🚀', approved: true },
      { seller: userIds[7], title: 'Anti-Cheat Module', titleAr: 'وحدة مكافحة الغش', desc: 'Server-side anti-cheat system detecting speed hacks, teleport hacks, item duplication, and memory editing.', descAr: 'نظام مكافحة غش من جانب السيرفر يكتشف اختراقات السرعة والتنقل ونسخ العناصر وتعديل الذاكرة.', price: 39.99, cat: 'Security', img: '🛡️', approved: true },
      { seller: userIds[6], title: 'Database Backup Tool', titleAr: 'أداة النسخ الاحتياطي لقاعدة البيانات', desc: 'Automated backup system with incremental backups, compression, cloud upload, and failure alerts.', descAr: 'نظام نسخ احتياطي تلقائي مع نسخ تزايدي وضغط ورفع سحابي وتنبيهات الفشل.', price: 4.99, cat: 'Tools', img: '💾', approved: true },
      { seller: userIds[4], title: 'Beginner Server Guide eBook', titleAr: 'كتاب إلكتروني دليل السيرفر للمبتدئين', desc: '120-page PDF guide covering everything from server setup to player management. Perfect for beginners.', descAr: 'دليل PDF من 120 صفحة يغطي كل شيء من إعداد السيرفر إلى إدارة اللاعبين. مثالي للمبتدئين.', price: 7.99, cat: 'Guides', img: '📖', approved: false },
    ];

    for (const p of sampleProducts) {
      await db(
        'INSERT INTO products (seller_id, title, title_ar, description, description_ar, price, category, image, is_approved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [p.seller, p.title, p.titleAr, p.desc, p.descAr, p.price, p.cat, p.img, p.approved]
      );
    }

    // Add some product reviews
    const approvedProducts = await db('SELECT id FROM products WHERE is_approved = TRUE LIMIT 7');
    const reviewTexts = [
      [5, "Excellent quality! Well worth the price."],
      [4, "Good tool, works as described. Documentation could be better."],
      [5, "This saved me weeks of work. Highly recommended!"],
      [3, "Decent but had some compatibility issues with EP9.4."],
      [5, "Perfect for beginners. Very well documented."],
      [4, "Great value. The Discord integration works flawlessly."],
    ];

    for (let i = 0; i < Math.min(approvedProducts.rows.length, 6); i++) {
      const prod = approvedProducts.rows[i];
      const reviewerIdx = (i + 2) % userIds.length;
      await db(
        'INSERT INTO product_reviews (product_id, user_id, rating, comment) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [prod.id, userIds[reviewerIdx], reviewTexts[i][0], reviewTexts[i][1]]
      );
      await db('UPDATE products SET average_rating = $1, total_sales = $2 WHERE id = $3',
        [reviewTexts[i][0], Math.floor(Math.random() * 50) + 5, prod.id]);
    }

    console.log('✅ Sample data seeded!');
    res.json({ message: 'Sample data created successfully', users: sampleUsers.length, threads: sampleThreads.length, products: sampleProducts.length });
  } catch (e) {
    console.error('Seed error:', e);
    res.status(500).json({ error: 'Seeding failed: ' + e.message });
  }
});

// Health check
// ============================================================
// DIRECT MESSAGES
// ============================================================

// Get conversations list (unique users you've chatted with)
app.get('/api/messages/conversations', auth, async (req, res) => {
  try {
    const result = await db(`
      SELECT DISTINCT ON (other_id) other_id, other_name, other_avatar, other_role, last_msg, last_time, unread_count
      FROM (
        SELECT 
          CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END as other_id,
          CASE WHEN m.sender_id = $1 THEN r.username ELSE s.username END as other_name,
          CASE WHEN m.sender_id = $1 THEN r.avatar ELSE s.avatar END as other_avatar,
          CASE WHEN m.sender_id = $1 THEN r.role ELSE s.role END as other_role,
          m.content as last_msg,
          m.created_at as last_time,
          CASE WHEN m.receiver_id = $1 AND m.is_read = FALSE THEN 1 ELSE 0 END as unread_count
        FROM messages m
        JOIN users s ON m.sender_id = s.id
        JOIN users r ON m.receiver_id = r.id
        WHERE m.sender_id = $1 OR m.receiver_id = $1
        ORDER BY CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END, m.created_at DESC
      ) sub
      ORDER BY other_id, last_time DESC
    `, [req.user.id]);
    
    // Get real unread counts
    const convos = [];
    for (const row of result.rows) {
      const unread = await db('SELECT COUNT(*) as count FROM messages WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE', [row.other_id, req.user.id]);
      convos.push({ ...row, unread_count: parseInt(unread.rows[0].count) });
    }
    convos.sort((a, b) => new Date(b.last_time) - new Date(a.last_time));
    res.json(convos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get messages with a specific user
app.get('/api/messages/:userId', auth, async (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    // Mark messages as read
    await db('UPDATE messages SET is_read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE', [otherId, req.user.id]);
    
    const result = await db(`
      SELECT m.*, s.username as sender_name, s.avatar as sender_avatar, s.role as sender_role
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      LIMIT 100
    `, [req.user.id, otherId]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send a message
app.post('/api/messages/:userId', auth, async (req, res) => {
  try {
    const receiverId = parseInt(req.params.userId);
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
    
    // Check receiver exists
    const receiver = await db('SELECT id, username FROM users WHERE id = $1', [receiverId]);
    if (receiver.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const result = await db(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, receiverId, content.trim()]
    );
    
    // Create notification for receiver
    await db('INSERT INTO notifications (user_id, type, message, message_ar) VALUES ($1, $2, $3, $4)',
      [receiverId, 'message', `New message from ${req.user.username}`, `رسالة جديدة من ${req.user.username}`]);
    
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get unread message count
app.get('/api/messages-unread', auth, async (req, res) => {
  try {
    const result = await db('SELECT COUNT(*) as count FROM messages WHERE receiver_id = $1 AND is_read = FALSE', [req.user.id]);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (e) { res.json({ count: 0 }); }
});

// Search users to start a conversation
app.get('/api/users/search', auth, async (req, res) => {
  try {
    const q = req.query.q || '';
    if (q.length < 2) return res.json([]);
    const result = await db(
      "SELECT id, username, avatar, role FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 10",
      [`%${q}%`, req.user.id]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// SUPPORT TICKETS
// ============================================================

// Create a ticket
app.post('/api/tickets', auth, async (req, res) => {
  try {
    const { subject, category, priority, content } = req.body;
    if (!subject || !content) return res.status(400).json({ error: 'Subject and description required' });
    
    const ticket = await db(
      'INSERT INTO tickets (user_id, subject, category, priority) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, subject, category || 'general', priority || 'normal']
    );
    
    // Add first message as ticket reply
    await db('INSERT INTO ticket_replies (ticket_id, user_id, content, is_staff) VALUES ($1, $2, $3, FALSE)',
      [ticket.rows[0].id, req.user.id, content]);
    
    res.status(201).json(ticket.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get my tickets (or all tickets for admin)
app.get('/api/tickets', auth, async (req, res) => {
  try {
    const isAdmin = ['admin', 'tech-moderator', 'arch-developer'].includes(req.user.role);
    const query = isAdmin
      ? `SELECT t.*, u.username, u.avatar, u.role as user_role,
           (SELECT COUNT(*) FROM ticket_replies tr WHERE tr.ticket_id = t.id) as reply_count
         FROM tickets t JOIN users u ON t.user_id = u.id ORDER BY 
         CASE WHEN t.status = 'open' THEN 0 WHEN t.status = 'in-progress' THEN 1 ELSE 2 END, t.updated_at DESC`
      : `SELECT t.*, u.username, u.avatar,
           (SELECT COUNT(*) FROM ticket_replies tr WHERE tr.ticket_id = t.id) as reply_count
         FROM tickets t JOIN users u ON t.user_id = u.id WHERE t.user_id = $1 ORDER BY t.updated_at DESC`;
    
    const result = isAdmin ? await db(query) : await db(query, [req.user.id]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get single ticket with replies
app.get('/api/tickets/:id', auth, async (req, res) => {
  try {
    const ticket = await db(
      `SELECT t.*, u.username, u.avatar, u.role as user_role FROM tickets t JOIN users u ON t.user_id = u.id WHERE t.id = $1`,
      [req.params.id]
    );
    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    
    const isAdmin = ['admin', 'tech-moderator', 'arch-developer'].includes(req.user.role);
    if (!isAdmin && ticket.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    
    const replies = await db(
      `SELECT tr.*, u.username, u.avatar, u.role FROM ticket_replies tr JOIN users u ON tr.user_id = u.id WHERE tr.ticket_id = $1 ORDER BY tr.created_at ASC`,
      [req.params.id]
    );
    
    res.json({ ticket: ticket.rows[0], replies: replies.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reply to a ticket
app.post('/api/tickets/:id/reply', auth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Reply cannot be empty' });
    
    const ticket = await db('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    
    const isAdmin = ['admin', 'tech-moderator', 'arch-developer'].includes(req.user.role);
    if (!isAdmin && ticket.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    
    const reply = await db(
      'INSERT INTO ticket_replies (ticket_id, user_id, content, is_staff) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, req.user.id, content, isAdmin]
    );
    
    // Update ticket timestamp and status
    const newStatus = isAdmin ? 'in-progress' : ticket.rows[0].status;
    await db('UPDATE tickets SET updated_at = NOW(), status = $1 WHERE id = $2', [newStatus, req.params.id]);
    
    // Notify the other party
    const notifyUserId = isAdmin ? ticket.rows[0].user_id : null;
    if (notifyUserId) {
      await db('INSERT INTO notifications (user_id, type, message, message_ar) VALUES ($1, $2, $3, $4)',
        [notifyUserId, 'ticket', `Staff replied to your ticket: ${ticket.rows[0].subject}`, `رد الدعم على تذكرتك: ${ticket.rows[0].subject}`]);
    }
    
    res.status(201).json(reply.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update ticket status (admin only)
app.put('/api/tickets/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'in-progress', 'resolved', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await db('UPDATE tickets SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
    
    const ticket = await db('SELECT user_id, subject FROM tickets WHERE id = $1', [req.params.id]);
    if (ticket.rows[0]) {
      await db('INSERT INTO notifications (user_id, type, message, message_ar) VALUES ($1, $2, $3, $4)',
        [ticket.rows[0].user_id, 'ticket', `Ticket "${ticket.rows[0].subject}" status: ${status}`, `حالة التذكرة "${ticket.rows[0].subject}": ${status}`]);
    }
    
    res.json({ message: 'Status updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public stats (no auth required)
app.get('/api/stats/public', async (req, res) => {
  try {
    const users = await db('SELECT COUNT(*) as count FROM users');
    const threads = await db('SELECT COUNT(*) as count FROM threads WHERE is_deleted = FALSE');
    const posts = await db('SELECT COUNT(*) as count FROM posts WHERE is_deleted = FALSE');
    const products = await db('SELECT COUNT(*) as count FROM products WHERE is_approved = TRUE AND is_deleted = FALSE');
    res.json({
      developers: parseInt(users.rows[0].count),
      discussions: parseInt(threads.rows[0].count),
      projectsShared: parseInt(products.rows[0].count),
      posts: parseInt(posts.rows[0].count)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'DevRoots API', timestamp: new Date().toISOString() });
});

// ============================================================
// START SERVER
// ============================================================
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`\n🌿 DevRoots API running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
    });
  } catch (e) {
    console.error('❌ Failed to start:', e.message);
    process.exit(1);
  }
}

start();
