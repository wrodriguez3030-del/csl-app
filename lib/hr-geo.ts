/**
 * Utilidades de geolocalización para el ponche por QR.
 * Distancia entre dos coordenadas con la fórmula de Haversine (metros).
 */

/** Distancia en METROS entre (lat1,lon1) y (lat2,lon2) — fórmula Haversine. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // radio terrestre en metros
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 100) / 100
}
