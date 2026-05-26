const express    = require('express');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const pool       = require('../db');
const router     = express.Router();

const MAX_INTENTOS  = 5;
const BLOQUEO_MINS  = 5;

// ── POST /api/auth/register ──────────────────────────────
router.post('/register', async (req, res) => {
  const { nombreCompleto, username, telefono, email, password } = req.body;

  if (!nombreCompleto || !username || !email || !password)
    return res.json({ success: false, error: 'Campos obligatorios faltantes.' });

  if (password.length < 8)
    return res.json({ success: false, error: 'La contraseña debe tener al menos 8 caracteres.' });

  try {
    const existe = await pool.query(
      'SELECT id FROM administradores WHERE username=$1 OR email=$2',
      [username, email]
    );
    if (existe.rows.length > 0)
      return res.json({ success: false, error: 'Usuario o email ya registrado.' });

    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO administradores
         (nombre_completo, username, telefono, email, password_hash, rol, estado)
       VALUES ($1,$2,$3,$4,$5,'Admin','Activo')`,
      [nombreCompleto, username, telefono || null, email, hash]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Register error:', err);
    res.json({ success: false, error: 'Error interno del servidor.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.headers['user-agent'] || '';

  if (!username || !password)
    return res.json({ success: false, error: 'Campos requeridos.' });

  try {
    const result = await pool.query(
      'SELECT * FROM administradores WHERE username=$1',
      [username]
    );

    if (result.rows.length === 0)
      return res.json({ success: false, error: 'Credenciales incorrectas.' });

    const admin = result.rows[0];

    // Verificar bloqueo en BD
    if (admin.bloqueado_hasta && new Date(admin.bloqueado_hasta) > new Date()) {
      const mins = Math.ceil((new Date(admin.bloqueado_hasta) - new Date()) / 60000);
      return res.json({
        success: false,
        error: `Cuenta bloqueada. Espere ${mins} minuto(s).`,
      });
    }

    if (admin.estado !== 'Activo')
      return res.json({ success: false, error: 'Cuenta inactiva. Contacte al administrador.' });

    const match = await bcrypt.compare(password, admin.password_hash);

    if (!match) {
      const nuevosIntentos = (admin.intentos_login || 0) + 1;
      const bloqueado = nuevosIntentos >= MAX_INTENTOS
        ? new Date(Date.now() + BLOQUEO_MINS * 60 * 1000)
        : null;

      await pool.query(
        `UPDATE administradores
         SET intentos_login=$1, bloqueado_hasta=$2
         WHERE id=$3`,
        [nuevosIntentos, bloqueado, admin.id]
      );

      const restantes = MAX_INTENTOS - nuevosIntentos;
      const msg = bloqueado
        ? `Demasiados intentos. Cuenta bloqueada por ${BLOQUEO_MINS} minutos.`
        : `Credenciales incorrectas. Le quedan ${restantes} intento(s).`;

      return res.json({ success: false, error: msg });
    }

    // Login exitoso — resetear intentos, guardar acceso
    await pool.query(
      `UPDATE administradores
       SET intentos_login=0, bloqueado_hasta=NULL, ultimo_acceso=NOW()
       WHERE id=$1`,
      [admin.id]
    );

    // Guardar sesión en admin_sesiones
    const token = crypto.randomBytes(64).toString('hex');
    const expira = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8h

    await pool.query(
      `INSERT INTO admin_sesiones
         (admin_id, session_token, ip_address, user_agent, fecha_expira)
       VALUES ($1,$2,$3,$4,$5)`,
      [admin.id, token, ip, ua, expira]
    );

    // JWT adicional para el frontend
    const jwtToken = jwt.sign(
      { id: admin.id, username: admin.username, rol: admin.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      username: admin.username,
      nombre: admin.nombre_completo,
      rol: admin.rol,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.json({ success: false, error: 'Error interno del servidor.' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────
router.post('/logout', async (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    // Invalidar sesión en BD (opcional, si buscas por JWT decoded id)
    res.clearCookie('token');
  }
  res.json({ success: true });
});

module.exports = router;