const MAKES = [
  ['Toyota', ['toyota', 'تويوتا']],
  ['Hyundai', ['hyundai', 'هيونداي', 'هيونداى']],
  ['Nissan', ['nissan', 'نيسان']],
  ['Lexus', ['lexus', 'لكزس', 'لكسس']],
  ['Ford', ['ford', 'فورد']],
  ['Chevrolet', ['chevrolet', 'chevy', 'شفروليه', 'شيفروليه']],
  ['Kia', ['kia', 'كيا']],
  ['Mercedes', ['mercedes', 'benz', 'مرسيدس']],
  ['BMW', ['bmw', 'بي ام', 'بي إم']],
  ['GMC', ['gmc', 'جمس']],
  ['Honda', ['honda', 'هوندا']],
  ['Mazda', ['mazda', 'مازدا']],
  ['Isuzu', ['isuzu', 'ايسوزو', 'إيسوزو']],
  ['Jeep', ['jeep', 'جيب']],
  ['Volkswagen', ['volkswagen', 'vw', 'فولكس']],
  ['Dodge', ['dodge', 'دودج']],
  ['Mitsubishi', ['mitsubishi', 'ميتسوبيشي']],
  ['Land Rover', ['land rover', 'range rover', 'rangerover', 'رنج', 'لاند روفر']],
  ['Porsche', ['porsche', 'بورش']],
  ['Audi', ['audi', 'اودي', 'أودي']],
  ['Haval', ['haval', 'هافال']],
  ['Chery', ['chery', 'شيري']],
  ['MG', ['mg', 'ام جي']],
  ['Genesis', ['genesis', 'جينيسيس']],
  ['Cadillac', ['cadillac', 'كاديلاك']],
  ['Infiniti', ['infiniti', 'انفينيتي']],
  ['BYD', ['byd']],
];

const BODY_LABELS = {
  sedan: 'Sedan',
  suv: 'SUV',
  pickup: 'Pickup',
  hatchback: 'Hatchback',
  coupe: 'Coupe',
  van: 'Van/Bus',
  classic: 'Classic',
  parts: 'Spare Parts',
  accessories: 'Accessories',
};

function normalizeBodyType(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .replace(/[\s/_-]+/g, '');
  if (!t) return '';
  if (t.includes('part') || t.includes('spare') || t.includes('قطع')) return 'parts';
  if (t.includes('access') || t.includes('كسسوار')) return 'accessories';
  if (t.includes('classic') || t.includes('كلاسيك')) return 'classic';
  if (t.includes('pick') || t.includes('truck') || t.includes('بيك') || t.includes('هايلكس') || t.includes('هيلوكس')) {
    return 'pickup';
  }
  if (t.includes('hatch') || t.includes('هاتش')) return 'hatchback';
  if (t.includes('coupe') || t.includes('كوبيه')) return 'coupe';
  if (t.includes('van') || t.includes('bus') || t.includes('فان') || t.includes('باص')) return 'van';
  if (t.includes('suv') || t.includes('جيب') || t.includes('رباعي') || t.includes('دفع')) return 'suv';
  if (t.includes('sedan') || t.includes('سيدان') || t.includes('saloon')) return 'sedan';
  return BODY_LABELS[t] ? t : '';
}

function inferBodyType(text) {
  const t = String(text || '').toLowerCase();
  const tagged = normalizeBodyType(t);
  if (tagged) return tagged;
  if (/part|spare|تشليح|قطع/.test(t)) return 'parts';
  if (
    /silverado|f-?150|f-?250|ranger|hilux|tundra|canyon|d-?max|navara|frontier|sierra|ram\b/.test(t) ||
    /truck|pickup|بيك|هايلكس|هيلوكس/.test(t)
  ) {
    return 'pickup';
  }
  if (/mustang|camaro|challenger|supra|\b86\b|coupe|كوبيه/.test(t)) return 'coupe';
  if (/carnival|staria|hiace|urvan|transit|van|bus|فان|باص/.test(t)) return 'van';
  if (
    /tahoe|suburban|expedition|explorer|edge|land cruiser|prado|patrol|fortuner|rav4|highlander|4runner|pajero|sportage|tucson|santa fe|palisade|telluride|sorento|seltos|stonic|niro|\brx\b|\bgx\b|\blx\b|\bnx\b|\bux\b|cx-|pathfinder|armada|murano|kicks|xterra|cherokee|wrangler|compass|land rover|range rover|رنج|لاند/.test(
      t,
    )
  ) {
    return 'suv';
  }
  if (/yaris|spark|polo|fiesta|accent|هاتش|picanto|i10|i20/.test(t)) return 'hatchback';
  return 'sedan';
}

function inferMake(text) {
  const blob = String(text || '').toLowerCase();
  if (!blob.trim()) return '';
  for (const [name, aliases] of MAKES) {
    if (aliases.some((alias) => blob.includes(alias))) return name;
  }
  return '';
}

function canonicalMake(raw, fallbackText = '') {
  const direct = inferMake(raw);
  if (direct) return direct;
  const trimmed = String(raw || '').trim();
  if (trimmed) return trimmed;
  return inferMake(fallbackText);
}

function bodyLabel(id) {
  return BODY_LABELS[id] || id || '';
}

function mapFuel(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const upper = value.toUpperCase();
  if (upper.includes('GAS') || upper.includes('PETROL') || value.includes('بنزين')) return 'Petrol';
  if (upper.includes('DIESEL') || value.includes('ديزل')) return 'Diesel';
  if (upper.includes('HYBRID') || value.includes('هجين')) return 'Hybrid';
  if (upper.includes('ELECTRIC') || value.includes('كهرب')) return 'Electric';
  return value;
}

function mapGear(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  if (lower.includes('auto') || value.includes('اوتم') || value.includes('أوتو')) return 'Automatic';
  if (lower.includes('man') || value.includes('عادي')) return 'Manual';
  return value;
}

function parseNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePrice(raw, extraText = '') {
  const blob = `${raw || ''} ${extraText || ''}`;
  const kMatch = blob.match(/(\d+(?:\.\d+)?)\s*[kK](?![mMا])|(\d+)\s*ألف|(\d+)\s*الف/);
  if (kMatch) {
    const n = Number(kMatch[1] || kMatch[2] || kMatch[3]);
    if (n > 0) return n * 1000;
  }
  const n = parseNumber(raw);
  if (n == null || n === 1 || n === 12) return null;
  if (n < 400) return n * 1000;
  return n;
}

function parseMileage(raw, extraText = '') {
  const fromField = parseNumber(raw);
  if (fromField != null) {
    return fromField <= 400 ? fromField * 1000 : fromField;
  }
  const km = String(extraText || '').match(/([\d,]+)\s*(?:km|كم)/i);
  if (!km) return null;
  const n = parseNumber(km[1]);
  return n == null ? null : n <= 400 ? n * 1000 : n;
}

function parseExpatTitle(title) {
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  let price = null;
  let rest = raw;
  const priceHead = raw.match(/^(SAR|USD|AED)?\s*([\d,]+)\s*,\s*/i);
  if (priceHead) {
    price = parsePrice(priceHead[2], raw);
    rest = raw.slice(priceHead[0].length);
  } else {
    price = parsePrice(null, raw);
  }
  const parts = rest.split(',').map((part) => part.trim()).filter(Boolean);
  const vehicle = parts[0] || rest;
  let year = null;
  let gear = '';
  let mileage = null;
  const leftover = [];
  for (const part of parts.slice(1)) {
    if (!year && /^(19|20)\d{2}$/.test(part)) {
      year = Number(part);
      continue;
    }
    if (!gear && /^(automatic|manual)$/i.test(part)) {
      gear = mapGear(part);
      continue;
    }
    const km = part.match(/^([\d,]+)\s*KM$/i);
    if (!mileage && km) {
      mileage = parseMileage(km[1]);
      continue;
    }
    leftover.push(part);
  }
  if (!year) {
    const found = raw.match(/\b((?:19|20)\d{2})\b/);
    if (found) year = Number(found[1]);
  }
  if (!mileage) mileage = parseMileage(null, raw);
  if (!gear) gear = mapGear(raw.match(/\b(automatic|manual|auto)\b/i)?.[0] || '');
  return {
    price,
    year,
    mileage,
    transmission: gear,
    vehicle,
    description: leftover.join(', ') || raw,
  };
}

function listingSpecs(source, item) {
  const title = String(item.title || '').trim();
  const fromTitle = source === 'expatriates' ? parseExpatTitle(title) : {};
  const year = Number(item.Year || item.year || fromTitle.year || 0) || null;
  const mileage = parseMileage(item.mileage ?? item.Mileage, title);
  const price = parsePrice(item.price, title) ?? fromTitle.price ?? null;
  return {
    year,
    mileage: mileage ?? fromTitle.mileage ?? null,
    fuel: mapFuel(item.fuel),
    transmission: mapGear(item.gear || item.transmission || fromTitle.transmission),
    price,
    model: String(item.model || item.Model || fromTitle.vehicle || '').trim(),
    description: fromTitle.description || '',
  };
}

function classifyCar({ title = '', subtitle = '', description = '', attributes = {}, subcategoryId = '', make = '', bodyType = '' } = {}) {
  const attrs = attributes && typeof attributes === 'object' ? { ...attributes } : {};
  const blob = [title, subtitle, description, attrs.make, attrs.model, attrs.bodyType, make, bodyType, subcategoryId]
    .filter(Boolean)
    .join(' ');
  const resolvedMake = canonicalMake(make || attrs.make, blob);
  const resolvedBody =
    normalizeBodyType(bodyType) ||
    normalizeBodyType(subcategoryId) ||
    normalizeBodyType(attrs.bodyType) ||
    inferBodyType(blob);
  attrs.make = resolvedMake;
  attrs.bodyType = bodyLabel(resolvedBody);
  if (attrs.model == null) attrs.model = '';
  return {
    make: resolvedMake,
    bodyType: resolvedBody,
    subcategoryId: resolvedBody,
    attributes: attrs,
  };
}

module.exports = {
  inferMake,
  inferBodyType,
  normalizeBodyType,
  canonicalMake,
  bodyLabel,
  classifyCar,
  listingSpecs,
  mapFuel,
  mapGear,
  parsePrice,
  parseMileage,
};
