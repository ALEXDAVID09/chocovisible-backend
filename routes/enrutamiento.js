const express = require('express');
const axios = require('axios');
const pool = require('../db');

const router = express.Router();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';
const MAIL_FROM = process.env.MAIL_FROM;
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'ChocoVisible';
const MAIL_ADMIN_COPIA = process.env.MAIL_ADMIN_COPIA;

function limpiar(texto = '') {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

router.post('/enrutar', async (req, res) => {
  const client = await pool.connect();

  try {
    const { denuncia_id, notas_enrutamiento = '' } = req.body;

    if (!denuncia_id) {
      return res.status(400).json({
        success: false,
        error: 'ID de denuncia inválido.',
      });
    }

    if (!BREVO_API_KEY || !MAIL_FROM) {
      return res.status(500).json({
        success: false,
        error: 'Faltan BREVO_API_KEY o MAIL_FROM en el archivo .env',
      });
    }

    const result = await client.query(
      `
      SELECT 
        d.*,
        t.nombre AS tipo_nombre,
        t.color_hex AS tipo_color,
        t.icono AS tipo_icono,
        a.nombre AS autoridad_nombre,
        a.sigla AS autoridad_sigla,
        a.email AS autoridad_email
      FROM denuncias d
      LEFT JOIN tipos_denuncia t ON d.tipo_id = t.id
      LEFT JOIN autoridades a ON d.autoridad_id = a.id
      WHERE d.id = $1
      LIMIT 1
      `,
      [denuncia_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Denuncia no encontrada.',
      });
    }

    const d = result.rows[0];

    if (!d.autoridad_email) {
      return res.status(400).json({
        success: false,
        error: 'La autoridad asignada no tiene correo registrado.',
      });
    }

    const codigo = limpiar(d.codigo_seguimiento);
    const tipo = limpiar(d.tipo_nombre || 'Sin tipo');
    const autoridad = limpiar(d.autoridad_nombre || 'Autoridad');
    const sigla = limpiar(d.autoridad_sigla || 'ENTIDAD');
    const urgencia = limpiar(String(d.urgencia || 'media').toUpperCase());
    const descripcion = limpiar(d.descripcion || '').replace(/\n/g, '<br>');
    const fecha = d.fecha
      ? new Date(d.fecha).toLocaleString('es-CO')
      : new Date().toLocaleString('es-CO');

    let ubicacionHtml = '';

    if (d.latitud && d.longitud) {
      const maps = `https://www.google.com/maps?q=${d.latitud},${d.longitud}`;
      ubicacionHtml = `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#374151;">Coordenadas GPS</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;color:#111827;">
            ${d.latitud}, ${d.longitud}
            &nbsp;<a href="${maps}" style="color:#1A73D6;font-size:12px;">📍 Ver en Google Maps</a>
          </td>
        </tr>
      `;
    }

    let denuncianteHtml = '';

    if (d.nombre_denunciante) {
      denuncianteHtml += `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#374151;">Nombre</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;color:#111827;">${limpiar(d.nombre_denunciante)}</td>
        </tr>
      `;
    }

    if (d.email_denunciante) {
      denuncianteHtml += `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#374151;">Email</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;color:#111827;">
            <a href="mailto:${limpiar(d.email_denunciante)}" style="color:#1A73D6;">${limpiar(d.email_denunciante)}</a>
          </td>
        </tr>
      `;
    }

    if (d.contacto_denunciante) {
      denuncianteHtml += `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#374151;">Teléfono</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;color:#111827;">${limpiar(d.contacto_denunciante)}</td>
        </tr>
      `;
    }

    const notasHtml = notas_enrutamiento
      ? `
        <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:14px 16px;margin-top:20px;">
          <strong style="color:#92400E;">📋 Notas del administrador:</strong><br>
          <span style="color:#78350F;">${limpiar(notas_enrutamiento)}</span>
        </div>
      `
      : '';

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#F6F8FA;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    
    <div style="background:linear-gradient(135deg,#0C3460,#248C4A);padding:28px 32px;">
      <div style="color:#6EE7A0;font-size:24px;font-weight:800;">ChocoVisible</div>
      <div style="color:rgba(255,255,255,.75);font-size:13px;margin-top:4px;">
        Sistema de Denuncia Ciudadana · Departamento del Chocó
      </div>
    </div>

    <div style="background:#F0F8F5;border-bottom:3px solid #1A6636;padding:18px 32px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#6B7280;margin-bottom:6px;">
        Nueva denuncia enrutada a su entidad
      </div>
      <div style="font-size:20px;font-weight:800;color:#111827;">${tipo}</div>
      <div style="font-size:13px;color:#374151;margin-top:3px;">
        Destinatario: <strong>${autoridad} (${sigla})</strong>
      </div>
    </div>

    <div style="padding:24px 32px;">
      <table style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;font-size:14px;">
        <tr style="background:#F9FAFB;">
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#374151;width:160px;">Código</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;">
            <span style="font-family:monospace;font-size:15px;font-weight:700;color:#0C3460;background:#EFF6FF;padding:3px 10px;border-radius:6px;">
              ${codigo}
            </span>
          </td>
        </tr>

        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#374151;">Fecha</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;color:#111827;">${fecha}</td>
        </tr>

        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#374151;">Urgencia</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E2E8F0;color:#111827;">${urgencia}</td>
        </tr>

        ${ubicacionHtml}
        ${denuncianteHtml}

        <tr>
          <td style="padding:14px 16px;font-weight:600;color:#374151;vertical-align:top;">Descripción</td>
          <td style="padding:14px 16px;color:#111827;line-height:1.8;">${descripcion}</td>
        </tr>
      </table>

      ${notasHtml}

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px 18px;margin-top:20px;">
        <strong style="color:#1E40AF;font-size:14px;">📌 Acción requerida</strong><br>
        <span style="color:#1E3A8A;font-size:13.5px;line-height:1.7;">
          Esta denuncia ha sido enrutada a su entidad por el sistema ChocoVisible.
          Por favor tome las acciones correspondientes.
        </span>
      </div>
    </div>

    <div style="background:#F6F8FA;border-top:1px solid #E2E8F0;padding:18px 32px;text-align:center;">
      <p style="font-size:12px;color:#9CA3AF;margin:0;">
        Mensaje generado automáticamente por ChocoVisible · No responda a este correo
      </p>
    </div>

  </div>
</body>
</html>
`;

    const payload = {
      sender: {
        name: MAIL_FROM_NAME,
        email: MAIL_FROM,
      },
      to: [
        {
          email: d.autoridad_email,
          name: d.autoridad_nombre || sigla,
        },
      ],
      subject: `[${sigla}] Denuncia ${codigo} · ${tipo} · Urgencia ${urgencia}`,
      htmlContent,
      textContent: `Denuncia ${codigo} (${tipo}) enrutada a ${autoridad}. Urgencia: ${urgencia}.`,
    };

    if (MAIL_ADMIN_COPIA) {
      payload.cc = [
        {
          email: MAIL_ADMIN_COPIA,
          name: 'ChocoVisible Admin',
        },
      ];
    }

    const brevo = await axios.post(BREVO_API_URL, payload, {
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
    });

    await client.query('BEGIN');

    await client.query(
      `
      UPDATE denuncias
      SET estado_enrutamiento = 'notificada',
          fecha_actualizacion = NOW()
      WHERE id = $1
      `,
      [denuncia_id]
    );

    await client.query(
      `
      INSERT INTO denuncia_actualizaciones
      (denuncia_id, descripcion, responsable, estado_nuevo)
      VALUES ($1, $2, 'Administrador', 'notificada')
      `,
      [
        denuncia_id,
        `Denuncia enrutada por correo a ${d.autoridad_nombre || sigla}.`,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      mensaje: `Correo enviado correctamente a ${d.autoridad_email}`,
      brevo_status: brevo.status,
    });

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}

    console.error('Error enrutando denuncia:', error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error:
        error.response?.data?.message ||
        error.message ||
        'Error al enviar correo.',
    });
  } finally {
    client.release();
  }
});

module.exports = router;