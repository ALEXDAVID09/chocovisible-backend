const express = require('express');
const axios = require('axios');

const router = express.Router();

router.get('/test-correo', async (req, res) => {
  try {
    const {
      BREVO_API_KEY,
      BREVO_API_URL,
      MAIL_FROM,
      MAIL_FROM_NAME,
      MAIL_ADMIN_COPIA,
    } = process.env;

    // Validación extendida con detalle de qué variable falta
    const variablesFaltantes = [];
    if (!BREVO_API_KEY)    variablesFaltantes.push('BREVO_API_KEY');
    if (!BREVO_API_URL)    variablesFaltantes.push('BREVO_API_URL');
    if (!MAIL_FROM)        variablesFaltantes.push('MAIL_FROM');
    if (!MAIL_ADMIN_COPIA) variablesFaltantes.push('MAIL_ADMIN_COPIA');

    if (variablesFaltantes.length > 0) {
      return res.status(500).json({
        success: false,
        error: 'Faltan variables de correo en el .env',
        variablesFaltantes,
      });
    }

    const fecha = new Date().toLocaleString('es-CO');

    const cuerpoHtml = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:500px;margin:32px auto;
                  background:#ECFDF5;border:2px solid #16A34A;border-radius:12px;padding:28px;">
        <h2 style="color:#15803D;margin:0 0 12px;">✅ ¡Funciona correctamente!</h2>
        <p style="color:#374151;margin:0 0 8px;">
          El sistema de correo de <strong>ChocoVisible</strong> está configurado con Brevo API.
        </p>
        <p style="color:#374151;margin:0 0 8px;">
          <strong>Enviado desde:</strong> ${MAIL_FROM}
        </p>
        <p style="color:#6B7280;font-size:12px;margin:16px 0 0;">
          Hora de prueba: ${fecha}
        </p>
      </div>
    `;

    const payload = {
      sender: {
        name: MAIL_FROM_NAME || 'ChocoVisible',
        email: MAIL_FROM,
      },
      to: [
        {
          email: MAIL_ADMIN_COPIA,
          name: 'ChocoVisible Notif',
        },
      ],
      subject: '✅ ChocoVisible · Prueba de correo exitosa',
      htmlContent: cuerpoHtml,
      textContent: `ChocoVisible - Prueba exitosa. Hora: ${fecha}`,
    };

    const response = await axios.post(BREVO_API_URL, payload, {
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
    });

    // Códigos de éxito aceptados: 200, 201, 202 (igual que el PHP)
    const httpCode = response.status;
    const success  = [200, 201, 202].includes(httpCode);

    return res.status(httpCode).json({
      success,
      mensaje: `Correo enviado exitosamente a ${MAIL_ADMIN_COPIA}`,
      // Si no ves el correo en bandeja, revisa Spam
      aviso: 'Si no lo ves en bandeja de entrada, revisa la carpeta Spam.',
      status: httpCode,
      data: response.data,
      // messageId devuelto por Brevo (equivalente al decode del PHP)
      messageId: response.data?.messageId ?? null,
    });

  } catch (error) {
    const httpCode  = error.response?.status  ?? 500;
    const apiData   = error.response?.data    ?? null;
    const curlError = error.message;

    console.error('Error test correo:', apiData || curlError);

    return res.status(httpCode).json({
      success: false,
      // Mismo nivel de detalle que el bloque ❌ del PHP
      httpCode,
      error: apiData || curlError,
      // Equivalente al "cURL error" del PHP
      curlError: error.code ?? null,
    });
  }
});

module.exports = router;