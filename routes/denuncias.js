const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

/* ── Multer ─────────────────────────────────────────── */
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|txt)$/i.test(file.originalname);
    cb(null, ok);
  },
});

/* ── Código único ───────────────────────────────────── */
async function codigoUnico() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo, existe = true;
  while (existe) {
    codigo = Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    const r = await pool.query(
      'SELECT id FROM denuncias WHERE codigo_seguimiento = $1', [codigo]
    );
    existe = r.rows.length > 0;
  }
  return codigo;
}

/* ── GET /api/denuncias ─────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*,
              t.nombre    AS tipo_nombre,
              t.icono     AS tipo_icono,
              t.color_hex AS tipo_color,
              a.nombre    AS autoridad_nombre,
              a.sigla     AS autoridad_sigla,
              (SELECT COUNT(*) FROM denuncia_fotos f         WHERE f.denuncia_id = d.id) AS fotos_count,
              (SELECT COUNT(*) FROM denuncia_actualizaciones u WHERE u.denuncia_id = d.id) AS actualizaciones_count
       FROM denuncias d
       LEFT JOIN tipos_denuncia t ON d.tipo_id    = t.id
       LEFT JOIN autoridades    a ON d.autoridad_id = a.id
       ORDER BY d.fecha DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('GET /denuncias:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener denuncias.' });
  }
});

/* ── GET /api/denuncias/seguimiento/:codigo ─────────── */
router.get('/seguimiento/:codigo', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*,
              t.nombre    AS tipo_nombre,
              t.color_hex AS tipo_color,
              t.icono     AS tipo_icono,
              a.nombre    AS autoridad_nombre,
              a.sigla     AS autoridad_sigla
       FROM denuncias d
       LEFT JOIN tipos_denuncia t ON d.tipo_id     = t.id
       LEFT JOIN autoridades    a ON d.autoridad_id = a.id
       WHERE d.codigo_seguimiento = $1`,
      [req.params.codigo.toUpperCase().trim()]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, error: 'Código no encontrado.' });

    const acts = await pool.query(
      'SELECT * FROM denuncia_actualizaciones WHERE denuncia_id = $1 ORDER BY fecha DESC',
      [result.rows[0].id]
    );
    res.json({ success: true, data: { ...result.rows[0], actualizaciones: acts.rows } });
  } catch (err) {
    console.error('GET /seguimiento:', err.message);
    res.status(500).json({ success: false, error: 'Error al consultar.' });
  }
});

/* ── POST /api/denuncias ────────────────────────────── */
// Columnas reales de la BD:
// id, tipo_id, autoridad_id, descripcion, latitud, longitud,
// fecha, fecha_actualizacion, estado, estado_enrutamiento,
// estado_anterior, codigo_seguimiento, nombre_denunciante,
// contacto_denunciante, email_denunciante, urgencia
router.post('/', upload.array('evidencias[]', 5), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      tipo_id, autoridad_id, descripcion, urgencia,
      latitud, longitud, fecha,
      nombre_denunciante, contacto_denunciante, email_denunciante,
    } = req.body;

    if (!descripcion || descripcion.trim().length < 20) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: 'Descripción mínimo 20 caracteres.' });
    }

    // Resolver autoridad desde tipos_denuncia si no viene en el body
    let autId = autoridad_id ? parseInt(autoridad_id) : null;
    if (!autId && tipo_id) {
      const t = await client.query(
        'SELECT autoridad_id FROM tipos_denuncia WHERE id = $1', [parseInt(tipo_id)]
      );
      if (t.rows.length) autId = t.rows[0].autoridad_id;
    }

    const codigo_seguimiento = await codigoUnico();
    const fechaInc = fecha && fecha.trim() ? fecha.trim() : new Date().toISOString().slice(0, 10);

    const ins = await client.query(
      `INSERT INTO denuncias
         (tipo_id, autoridad_id, descripcion, urgencia,
          estado, estado_enrutamiento,
          codigo_seguimiento,
          nombre_denunciante, contacto_denunciante, email_denunciante,
          latitud, longitud, fecha)
       VALUES ($1,$2,$3,$4,'pendiente','pendiente',$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        tipo_id  ? parseInt(tipo_id) : null,
        autId    || null,
        descripcion.trim(),
        urgencia || 'media',
        codigo_seguimiento,
        nombre_denunciante   || null,
        contacto_denunciante || null,
        email_denunciante    || null,
        latitud  ? parseFloat(latitud)  : null,
        longitud ? parseFloat(longitud) : null,
        fechaInc,
      ]
    );

    const denuncia_id = ins.rows[0].id;
    const archivos_subidos = [];

    // Guardar evidencias en denuncia_fotos
    for (const file of (req.files || [])) {
      await client.query(
        'INSERT INTO denuncia_fotos (denuncia_id, foto_path) VALUES ($1, $2)',
        [denuncia_id, `/uploads/${file.filename}`]
      );
      archivos_subidos.push(file.originalname);
    }

    // Primera entrada en historial
    await client.query(
      `INSERT INTO denuncia_actualizaciones
         (denuncia_id, descripcion, responsable, estado_nuevo)
       VALUES ($1, 'Denuncia recibida y registrada en el sistema.', 'Sistema', 'pendiente')`,
      [denuncia_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      mensaje: 'Denuncia registrada.',
      id: denuncia_id,
      codigo_seguimiento,
      archivos_subidos,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /denuncias error:', err.message);
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
    res.status(500).json({ success: false, mensaje: 'Error al registrar. Intenta de nuevo.' });
  } finally {
    client.release();
  }
});

module.exports = router;