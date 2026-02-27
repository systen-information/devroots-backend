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

  // Seed default categories
  const { rows } = await db('SELECT COUNT(*) as count FROM forum_categories');
  if (parseInt(rows[0].count) === 0) {
    console.log('🌱 Seeding default forum categories...');
    const cats = [
      ['Server Development', 'تطوير السيرفرات', 'server-dev', 'Game server setup, configuration, and optimization', 'إعداد وتكوين وتحسين سيرفرات اللعبة', '⚙️', 1],
      ['Client Modding', 'تعديل العميل', 'client-mod', 'Client-side modifications, UI changes, and visual mods', 'تعديلات جانب العميل وتغييرات الواجهة والتعديلات البصرية', '🎨', 2],
      ['Database & Tools', 'قواعد البيانات والأدوات', 'db-tools', 'Database management, custom tools, and utilities', 'إدارة قواعد البيانات والأدوات المخصصة والمرافق', '🗄️', 3],
      ['Scripting & NPCs', 'البرمجة و NPCs', 'scripting', 'NPC scripting, quest creation, and game logic', 'برمجة NPCs وإنشاء المهام ومنطق اللعبة', '📜', 4],
      ['Releases & Downloads', 'الإصدارات والتنزيلات', 'releases', 'Share your completed projects and releases', 'شارك مشاريعك المكتملة وإصداراتك', '📦', 5],
      ['Help & Support', 'المساعدة والدعم', 'help', 'Get help with development issues and bugs', 'احصل على مساعدة في مشاكل التطوير والأخطاء', '🆘', 6],
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
  if (!['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ============================================================
// AUTH ROUTES
// ============================================================
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
    if (!['member', 'developer', 'moderator', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
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

// Health check
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
