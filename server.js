const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://chocovisible.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Rutas ────────────────────────────────────────────────
const denunciasRoutes = require('./routes/denuncias');
const authRoutes      = require('./routes/auth');
const adminRoutes     = require('./routes/admin');
const iaRoutes = require('./routes/ia');
const enrutamientoRoutes = require('./routes/enrutamiento');
const testCorreoRoutes = require('./routes/testCorreo');

app.use('/api', testCorreoRoutes);
app.use('/api/ia', iaRoutes);
app.use('/api/enrutamiento', enrutamientoRoutes);

app.use('/api/denuncias', denunciasRoutes);
app.use('/api/auth',      authRoutes);
app.use('/api/admin',     adminRoutes);

// ── Compatibilidad con Login.jsx (/api/login.php) ────────
app.post('/api/login.php', (req, res, next) => {
  const action = req.body?.action;
  req.url = action === 'register' ? '/register' : '/login';
  authRoutes(req, res, next);
});

// ── Ruta de prueba ───────────────────────────────────────
app.get('/api/test', (req, res) => {
  res.json({ message: '✅ Backend funcionando correctamente', timestamp: new Date() });
});

// ── Iniciar servidor ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📡 API disponible en http://localhost:${PORT}/api`);
});