# Clóset Digital

PWA para digitalizar el clóset: fotos de prendas recortadas con remove.bg,
etiquetas automáticas con Google Gemini, ideas de outfits según el clima
(Open-Meteo) y probador virtual con Gemini sobre una foto de cuerpo completo.

- En vivo: https://ramiiron.github.io/closet-digital/
- Backend: Firebase `finanzas-bugueno` (colecciones `closet_items`,
  `closet_outfits` y `config/closet_app`), login con correo obligatorio.
- Las claves de API (remove.bg y Gemini) se ingresan en Ajustes dentro de la
  app y viven en `config/closet_app`, detrás del login. Nunca en el código.
- Sin las claves, la app funciona en modo manual: fotos sin recorte,
  datos a mano e ideas por reglas de color/temporada.
