// backend/routes/admin.js
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

const PER_PAGE = 15;

/* ════════════════════════════════════════════════════════
   GET /api/admin/stats
   Devuelve conteos para las tarjetas del dashboard
════════════════════════════════════════════════════════ */
router.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                                        AS total,
        COUNT(*) FILTER (WHERE estado != 'archivado')                  AS activas,
        COUNT(*) FILTER (WHERE estado = 'pendiente')                   AS pendientes,
        COUNT(*) FILTER (WHERE estado = 'en_proceso')                  AS en_proceso,
        COUNT(*) FILTER (WHERE estado = 'resuelto')                    AS resueltas,
        COUNT(*) FILTER (WHERE estado = 'archivado')                   AS archivadas
      FROM denuncias
    `);
    const row = result.rows[0];
    res.json({
      total:      parseInt(row.total),
      activas:    parseInt(row.activas),
      pendientes: parseInt(row.pendientes),
      en_proceso: parseInt(row.en_proceso),
      resueltas:  parseInt(row.resueltas),
      archivadas: parseInt(row.archivadas),
    });
  } catch (err) {
    console.error('Error en /admin/stats:', err);
    res.status(500).json({ error: 'Error al obtener estadísticas.' });
  }
});

/* ════════════════════════════════════════════════════════
   GET /api/admin/denuncias?filtro=activos&page=1&per_page=15
   Lista paginada de denuncias con joins a tipos y autoridades
════════════════════════════════════════════════════════ */
router.get('/denuncias', async (req, res) => {
  try {
    const filtro   = req.query.filtro   || 'activos';
    const page     = Math.max(1, parseInt(req.query.page)     || 1);
    const perPage  = Math.max(1, parseInt(req.query.per_page) || PER_PAGE);
    const offset   = (page - 1) * perPage;

    // Construir cláusula WHERE según filtro
    let whereClause = '';
    if      (filtro === 'activos')    whereClause = "WHERE d.estado != 'archivado'";
    else if (filtro === 'pendientes') whereClause = "WHERE d.estado = 'pendiente'";
    else if (filtro === 'proceso')    whereClause = "WHERE d.estado = 'en_proceso'";
    else if (filtro === 'resueltos')  whereClause = "WHERE d.estado = 'resuelto'";
    else if (filtro === 'archivado')  whereClause = "WHERE d.estado = 'archivado'";
    // 'todos' → sin WHERE

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM denuncias d ${whereClause}`
    );
    const total = parseInt(countResult.rows[0].count);

    const listResult = await pool.query(`
      SELECT
        d.id,
        d.codigo_seguimiento,
        d.descripcion,
        d.estado,
        d.estado_enrutamiento,
        d.estado_anterior,
        d.fecha,
        d.nombre_denunciante,
        d.email_denunciante,
        d.contacto_denunciante,
        d.latitud,
        d.longitud,
        t.nombre      AS tipo_nombre,
        t.icono       AS tipo_icono,
        t.color_hex   AS tipo_color,
        a.nombre      AS autoridad_nombre,
        a.sigla       AS autoridad_sigla,
       a.email AS autoridad_email,
        (SELECT COUNT(*) FROM denuncia_fotos   f WHERE f.denuncia_id = d.id) AS fotos_count,
        (SELECT COUNT(*) FROM denuncia_actualizaciones u WHERE u.denuncia_id = d.id) AS actualizaciones_count
      FROM denuncias d
      LEFT JOIN tipos_denuncia t ON d.tipo_id    = t.id
      LEFT JOIN autoridades    a ON d.autoridad_id = a.id
      ${whereClause}
      ORDER BY d.fecha DESC
      LIMIT $1 OFFSET $2
    `, [perPage, offset]);

    res.json({
      denuncias:        listResult.rows,
      total_registros:  total,
      total_paginas:    Math.ceil(total / perPage),
      pagina_actual:    page,
    });
  } catch (err) {
    console.error('Error en /admin/denuncias:', err);
    res.status(500).json({ error: 'Error al obtener denuncias.' });
  }
});

/* ════════════════════════════════════════════════════════
   GET /api/admin/denuncia/:id
   Detalle completo con fotos y actualizaciones
════════════════════════════════════════════════════════ */
router.get('/denuncia/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const denResult = await pool.query(`
      SELECT
        d.*,
        t.nombre      AS tipo_nombre,
        t.icono       AS tipo_icono,
        t.color_hex   AS tipo_color,
        a.nombre      AS autoridad_nombre,
        a.sigla       AS autoridad_sigla,
       a.email AS autoridad_email,
      FROM denuncias d
      LEFT JOIN tipos_denuncia t ON d.tipo_id     = t.id
      LEFT JOIN autoridades    a ON d.autoridad_id = a.id
      WHERE d.id = $1
    `, [id]);

    if (!denResult.rows.length) {
      return res.status(404).json({ error: 'Denuncia no encontrada.' });
    }

    const fotosResult = await pool.query(
      `SELECT id, foto_path AS ruta, fecha_subida FROM denuncia_fotos WHERE denuncia_id = $1 ORDER BY fecha_subida`,
      [id]
    );

    const actResult = await pool.query(
      `SELECT id, descripcion, fecha, responsable, estado_anterior, estado_nuevo
       FROM denuncia_actualizaciones WHERE denuncia_id = $1 ORDER BY fecha DESC`,
      [id]
    );

    res.json({
      ...denResult.rows[0],
      fotos:          fotosResult.rows,
      actualizaciones: actResult.rows,
    });
  } catch (err) {
    console.error('Error en /admin/denuncia/:id:', err);
    res.status(500).json({ error: 'Error al obtener denuncia.' });
  }
});

/* ════════════════════════════════════════════════════════
   POST /api/admin/actualizar-estado
   { denuncia_id, nuevo_estado, descripcion_actualizacion }
════════════════════════════════════════════════════════ */
router.post('/actualizar-estado', async (req, res) => {
  try {
    const { denuncia_id, nuevo_estado, descripcion_actualizacion } = req.body;
    if (!denuncia_id || !nuevo_estado || !descripcion_actualizacion) {
      return res.status(400).json({ error: 'Faltan campos requeridos.' });
    }

    // Obtener estado anterior
    const prev = await pool.query('SELECT estado FROM denuncias WHERE id = $1', [denuncia_id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Denuncia no encontrada.' });
    const estadoAnterior = prev.rows[0].estado;

    // Actualizar estado
    await pool.query(
      `UPDATE denuncias SET estado = $1, fecha_actualizacion = NOW() WHERE id = $2`,
      [nuevo_estado, denuncia_id]
    );

    // Registrar en historial
    await pool.query(
      `INSERT INTO denuncia_actualizaciones (denuncia_id, descripcion, responsable, estado_anterior, estado_nuevo)
       VALUES ($1, $2, $3, $4, $5)`,
      [denuncia_id, descripcion_actualizacion, 'Administrador', estadoAnterior, nuevo_estado]
    );

    res.json({ success: true, message: 'Estado actualizado correctamente.' });
  } catch (err) {
    console.error('Error en /admin/actualizar-estado:', err);
    res.status(500).json({ error: 'Error al actualizar estado.' });
  }
});

/* ════════════════════════════════════════════════════════
   POST /api/admin/archivar
   { denuncia_id, motivo_archivo }
════════════════════════════════════════════════════════ */
router.post('/archivar', async (req, res) => {
  try {
    const { denuncia_id, motivo_archivo } = req.body;
    if (!denuncia_id || !motivo_archivo) {
      return res.status(400).json({ error: 'Faltan campos requeridos.' });
    }

    const prev = await pool.query('SELECT estado FROM denuncias WHERE id = $1', [denuncia_id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Denuncia no encontrada.' });

    await pool.query(
      `UPDATE denuncias SET estado = 'archivado', estado_anterior = $1, fecha_actualizacion = NOW() WHERE id = $2`,
      [prev.rows[0].estado, denuncia_id]
    );

    await pool.query(
      `INSERT INTO denuncia_actualizaciones (denuncia_id, descripcion, responsable, estado_anterior, estado_nuevo)
       VALUES ($1, $2, $3, $4, 'archivado')`,
      [denuncia_id, `Archivado: ${motivo_archivo}`, 'Administrador', prev.rows[0].estado]
    );

    res.json({ success: true, message: 'Denuncia archivada.' });
  } catch (err) {
    console.error('Error en /admin/archivar:', err);
    res.status(500).json({ error: 'Error al archivar.' });
  }
});

/* ════════════════════════════════════════════════════════
   POST /api/admin/desarchivar
   { denuncia_id, nuevo_estado_desarchivar }
════════════════════════════════════════════════════════ */
router.post('/desarchivar', async (req, res) => {
  try {
    const { denuncia_id, nuevo_estado_desarchivar } = req.body;
    if (!denuncia_id || !nuevo_estado_desarchivar) {
      return res.status(400).json({ error: 'Faltan campos requeridos.' });
    }

    await pool.query(
      `UPDATE denuncias SET estado = $1, estado_anterior = NULL, fecha_actualizacion = NOW() WHERE id = $2`,
      [nuevo_estado_desarchivar, denuncia_id]
    );

    await pool.query(
      `INSERT INTO denuncia_actualizaciones (denuncia_id, descripcion, responsable, estado_anterior, estado_nuevo)
       VALUES ($1, $2, $3, 'archivado', $4)`,
      [denuncia_id, `Denuncia desarchivada y restaurada.`, 'Administrador', nuevo_estado_desarchivar]
    );

    res.json({ success: true, message: 'Denuncia desarchivada.' });
  } catch (err) {
    console.error('Error en /admin/desarchivar:', err);
    res.status(500).json({ error: 'Error al desarchivar.' });
  }
});

/* ════════════════════════════════════════════════════════
   POST /api/admin/eliminar
   { denuncia_id }
════════════════════════════════════════════════════════ */
router.post('/eliminar', async (req, res) => {
  try {
    const { denuncia_id } = req.body;
    if (!denuncia_id) return res.status(400).json({ error: 'Falta denuncia_id.' });

    // Eliminar dependencias primero
    await pool.query('DELETE FROM denuncia_fotos           WHERE denuncia_id = $1', [denuncia_id]);
    await pool.query('DELETE FROM denuncia_actualizaciones WHERE denuncia_id = $1', [denuncia_id]);
    await pool.query('DELETE FROM enrutamientos            WHERE denuncia_id = $1', [denuncia_id]);
    await pool.query('DELETE FROM denuncias                WHERE id          = $1', [denuncia_id]);

    res.json({ success: true, message: 'Denuncia eliminada permanentemente.' });
  } catch (err) {
    console.error('Error en /admin/eliminar:', err);
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

/* ════════════════════════════════════════════════════════
   POST /api/admin/notificar
   { denuncia_id, notas_enrutamiento }
════════════════════════════════════════════════════════ */
router.post('/notificar', async (req, res) => {
  try {
    const { denuncia_id, notas_enrutamiento } = req.body;
    if (!denuncia_id) return res.status(400).json({ error: 'Falta denuncia_id.' });

    await pool.query(
      `UPDATE denuncias SET estado_enrutamiento = 'notificada', fecha_actualizacion = NOW() WHERE id = $1`,
      [denuncia_id]
    );

    // Registrar en enrutamientos si la tabla existe
    try {
      await pool.query(
        `INSERT INTO enrutamientos (denuncia_id, notas, fecha) VALUES ($1, $2, NOW())
         ON CONFLICT DO NOTHING`,
        [denuncia_id, notas_enrutamiento || '']
      );
    } catch (_) { /* tabla puede no tener esa estructura exacta */ }

    await pool.query(
      `INSERT INTO denuncia_actualizaciones (denuncia_id, descripcion, responsable)
       VALUES ($1, $2, $3)`,
      [denuncia_id, `Denuncia notificada a la autoridad competente.${notas_enrutamiento ? ' Notas: ' + notas_enrutamiento : ''}`, 'Administrador']
    );

    res.json({ success: true, message: 'Denuncia marcada como notificada.' });
  } catch (err) {
    console.error('Error en /admin/notificar:', err);
    res.status(500).json({ error: 'Error al notificar.' });
  }
});

/* ════════════════════════════════════════════════════════
   GET /api/admin/exportar?filtro=todos
   Exporta a CSV compatible con Excel
════════════════════════════════════════════════════════ */
router.get('/exportar', async (req, res) => {
  try {
    const filtro = req.query.filtro || 'todos';

    let whereClause = '';
    if      (filtro === 'activos')    whereClause = "WHERE d.estado != 'archivado'";
    else if (filtro === 'pendiente')  whereClause = "WHERE d.estado = 'pendiente'";
    else if (filtro === 'en_proceso') whereClause = "WHERE d.estado = 'en_proceso'";
    else if (filtro === 'resuelto')   whereClause = "WHERE d.estado = 'resuelto'";
    else if (filtro === 'archivado')  whereClause = "WHERE d.estado = 'archivado'";

    const result = await pool.query(`
      SELECT
        d.codigo_seguimiento  AS "Código",
        t.nombre              AS "Tipo",
        d.nombre_denunciante  AS "Denunciante",
        d.email_denunciante   AS "Email",
        d.contacto_denunciante AS "Contacto",
        d.estado              AS "Estado",
        d.descripcion         AS "Descripción",
        d.latitud             AS "Latitud",
        d.longitud            AS "Longitud",
        TO_CHAR(d.fecha, 'DD/MM/YYYY HH24:MI') AS "Fecha",
        a.nombre              AS "Autoridad"
      FROM denuncias d
      LEFT JOIN tipos_denuncia t ON d.tipo_id     = t.id
      LEFT JOIN autoridades    a ON d.autoridad_id = a.id
      ${whereClause}
      ORDER BY d.fecha DESC
    `);

    // Generar CSV
    if (!result.rows.length) {
      return res.status(200).send('Sin datos para exportar.');
    }

    const headers = Object.keys(result.rows[0]);
    const csvRows = [
      headers.join(';'),
      ...result.rows.map(row =>
        headers.map(h => {
          const val = row[h] ?? '';
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(';')
      )
    ];

    const csv = '\uFEFF' + csvRows.join('\n'); // BOM para Excel

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="denuncias_${filtro}_${new Date().toISOString().slice(0,10)}.xls"`);
    res.send(csv);
  } catch (err) {
    console.error('Error en /admin/exportar:', err);
    res.status(500).json({ error: 'Error al exportar.' });
  }
});

/* ════════════════════════════════════════════════════════
   GET /api/admin/dashboard  (compatibilidad con versión anterior)
════════════════════════════════════════════════════════ */
router.get('/dashboard', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM denuncias');
    res.json({ success: true, total_denuncias: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error.' });
  }
});

module.exports = router;