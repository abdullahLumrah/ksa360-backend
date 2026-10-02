const CITIES = [
  { name: 'Riyadh', lat: 24.7136, lng: 46.6753 },
  { name: 'Diriyah', lat: 24.7333, lng: 46.5728 },
  { name: 'Al Kharj', lat: 24.1556, lng: 47.312 },
  { name: 'Jeddah', lat: 21.5433, lng: 39.1728 },
  { name: 'Makkah', lat: 21.3891, lng: 39.8579 },
  { name: 'Taif', lat: 21.2703, lng: 40.4158 },
  { name: 'Madinah', lat: 24.5247, lng: 39.5692 },
  { name: 'Yanbu', lat: 24.0896, lng: 38.0618 },
  { name: 'Dammam', lat: 26.4207, lng: 50.0888 },
  { name: 'Khobar', lat: 26.2172, lng: 50.1971 },
  { name: 'Dhahran', lat: 26.2361, lng: 50.065 },
  { name: 'Jubail', lat: 27.0046, lng: 49.6225 },
  { name: 'Qatif', lat: 26.565, lng: 49.996 },
  { name: 'Hofuf (Al Ahsa)', lat: 25.3647, lng: 49.5856 },
  { name: 'Buraidah', lat: 26.326, lng: 43.975 },
  { name: 'Abha', lat: 18.2164, lng: 42.5053 },
  { name: 'Khamis Mushait', lat: 18.3064, lng: 42.7297 },
  { name: 'Jazan', lat: 16.8892, lng: 42.5511 },
  { name: 'Najran', lat: 17.4924, lng: 44.1277 },
  { name: 'Tabuk', lat: 28.3838, lng: 36.555 },
  { name: 'Hail', lat: 27.5114, lng: 41.7208 },
  { name: 'Al Baha', lat: 20.0129, lng: 41.4677 },
];

const ALIASES = {
  الرياض: 'Riyadh',
  riyadh: 'Riyadh',
  جدة: 'Jeddah',
  جده: 'Jeddah',
  jeddah: 'Jeddah',
  مكة: 'Makkah',
  'مكة المكرمة': 'Makkah',
  makkah: 'Makkah',
  mecca: 'Makkah',
  المدينة: 'Madinah',
  'المدينة المنورة': 'Madinah',
  madinah: 'Madinah',
  medina: 'Madinah',
  الدمام: 'Dammam',
  dammam: 'Dammam',
  الخبر: 'Khobar',
  khobar: 'Khobar',
  'al khobar': 'Khobar',
  الظهران: 'Dhahran',
  dhahran: 'Dhahran',
  الدرعية: 'Diriyah',
  diriyah: 'Diriyah',
  الجبيل: 'Jubail',
  jubail: 'Jubail',
  ينبع: 'Yanbu',
  yanbu: 'Yanbu',
  الطائف: 'Taif',
  taif: 'Taif',
  أبها: 'Abha',
  ابها: 'Abha',
  abha: 'Abha',
  تبوك: 'Tabuk',
  tabuk: 'Tabuk',
  حائل: 'Hail',
  hail: 'Hail',
};

function km(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) *
      Math.cos(lat2 * p) *
      (1 - Math.cos((lng2 - lng1) * p))) /
      2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function nearestCity(lat, lng) {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const city of CITIES) {
    const d = km(lat, lng, city.lat, city.lng);
    if (d < bestD) {
      bestD = d;
      best = city;
    }
  }
  return best.name;
}

function canonicalCity(raw, lat, lng) {
  const key = String(raw || '').trim().toLowerCase();
  if (key && ALIASES[key]) return ALIASES[key];
  if (key) {
    const hit = CITIES.find((c) => c.name.toLowerCase() === key);
    if (hit) return hit.name;
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return nearestCity(lat, lng);
  }
  return '';
}

module.exports = { CITIES, km, nearestCity, canonicalCity };
