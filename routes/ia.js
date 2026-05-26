const express = require('express');
const axios = require('axios');

const router = express.Router();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

router.post('/chat', async (req, res) => {
  try {
    const { mensaje, historial = [] } = req.body;

    if (!mensaje || !mensaje.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Mensaje vacío',
      });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Falta OPENAI_API_KEY en el archivo .env',
      });
    }

    const system = `
Eres 'Asis', el asistente virtual de ChocoVisible, un sistema ciudadano de denuncias del departamento del Chocó, Colombia. Tu misión es ayudar al ciudadano a redactar su denuncia de forma clara y completa.

Cuando el ciudadano te describa un problema o incidente, debes:
1. Responder con empatía y en español sencillo.
2. Hacer preguntas específicas para obtener: tipo de denuncia, descripción detallada, ubicación, municipio, barrio, dirección, fecha aproximada y nivel de urgencia: Alta, Media o Baja.
3. Cuando ya tengas suficiente información, incluir al FINAL de tu respuesta exactamente este bloque:

<<<DATOS_DENUNCIA>>>
{"tipo":"[tipo de denuncia]","descripcion":"[descripcion completa]","municipio":"[municipio]","barrio":"[barrio o sector]","direccion":"[dirección aproximada]","fecha":"[fecha aproximada]","urgencia":"[Alta/Media/Baja]"}
<<<FIN_DATOS>>>

Tipos de denuncia válidos:
Delito Penal, Daño Ambiental, Corrupción, Derechos Humanos, Salud Pública, Otro.

No inventes datos. Si el ciudadano no ha dado suficiente información, sigue preguntando antes de generar el bloque.
`;

    const messages = [
      { role: 'system', content: system },
      ...historial
        .filter(h => h.role && h.content)
        .map(h => ({
          role: h.role,
          content: h.content,
        })),
      { role: 'user', content: mensaje.trim() },
    ];

    const response = await axios.post(
      OPENAI_URL,
      {
        model: OPENAI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    let texto = response.data?.choices?.[0]?.message?.content || '';

    let datosDenuncia = null;

    const match = texto.match(/<<<DATOS_DENUNCIA>>>(.*?)<<<FIN_DATOS>>>/s);

    if (match) {
      try {
        datosDenuncia = JSON.parse(match[1].trim());
        texto = texto
          .replace(/<<<DATOS_DENUNCIA>>>.*?<<<FIN_DATOS>>>/s, '')
          .trim();
      } catch {
        datosDenuncia = null;
      }
    }

    const tipoMap = {
      'delito penal': 1,
      'daño ambiental': 2,
      'dano ambiental': 2,
      'problema ambiental': 2,
      'ambiental': 2,
      'corrupción': 3,
      'corrupcion': 3,
      'derechos humanos': 4,
      'salud pública': 5,
      'salud publica': 5,
      'otro': '',
    };

    if (datosDenuncia) {
      const tipoLower = String(datosDenuncia.tipo || '')
        .toLowerCase()
        .trim();

      datosDenuncia.tipo_id = tipoMap[tipoLower] || '';
      datosDenuncia.urgencia = String(datosDenuncia.urgencia || 'media')
        .toLowerCase()
        .trim();
    }

    res.json({
      success: true,
      respuesta: texto,
      datos: datosDenuncia,
      datosDenuncia,
    });

  } catch (error) {
    console.error('Error IA:', error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error?.message ||
        'Error al conectar con el asistente IA.',
    });
  }
});

module.exports = router;