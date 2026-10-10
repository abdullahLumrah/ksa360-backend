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
  return '';
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
  const match = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Split glued figures like 16501 or 1600018000 back into the first real price. */
function ungluePrice(n) {
  if (!Number.isFinite(n) || n < 10000) return n;
  const digits = String(Math.round(n));
  if (digits.length >= 8 && digits.length <= 12 && digits.length % 2 === 0) {
    const half = digits.length / 2;
    const a = Number(digits.slice(0, half));
    const b = Number(digits.slice(half));
    if (a >= 400 && b >= 400 && Math.max(a, b) / Math.min(a, b) <= 8) {
      return a;
    }
  }
  return n;
}

function looksLikePhone(n) {
  const s = String(Math.round(n));
  return /^(966|05|5)\d{8,}$/.test(s) || s.length >= 10;
}

function sanitizePrice(n, { isCar = false, assumeThousands = false } = {}) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 1 || n === 12 || n === 1111111) return null;
  if (looksLikePhone(n)) return null;
  n = ungluePrice(n);
  if (assumeThousands && n < 400) n *= 1000;
  if (isCar && n >= 8e6 && n % 1000 === 0) {
    const down = n / 1000;
    if (down >= 4000 && down <= 3e6) n = down;
  }
  if (!isCar && n > 2e6) return null;
  if (isCar && n > 5e6) return null;
  return n;
}

function firstLabeledPrice(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const head = raw.match(
    /^(?:(SAR|USD|AED|SR|ر\.?\s*س)\s*)?([\d,]+(?:\.\d+)?)\s*(?:(\/\s*(?:month|year|week|day|mo|yr|munthly|monthly|yearly)|per\s+(?:month|year)))?\s*(,|$)/i,
  );
  if (head && (head[1] || head[3] || (head[4] === ',' && raw.length > head[0].length))) {
    const n = Number(String(head[2]).replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const labeled = raw.match(/(?:SAR|SR|USD|AED|ر\.?\s*س)\s*([\d,]+(?:\.\d+)?)/i);
  if (labeled) {
    const n = Number(String(labeled[1]).replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const range = raw.match(/(\d{3,6})\s*(?:-|–|to|\/)\s*(\d{3,6})/i);
  if (range) {
    const a = Number(range[1]);
    if (a > 0) return a;
  }
  const listed = raw.match(/\((\d{4,6})(?:\s*,\s*\d{4,6})+\)/);
  if (listed) {
    const a = Number(listed[1]);
    if (a > 0) return a;
  }
  return null;
}

function parsePrice(raw, extraText = '', opts = {}) {
  const isCar = Boolean(opts.isCar);
  const assumeThousands = Boolean(opts.assumeThousands);
  const fromText = firstLabeledPrice(extraText);
  if (fromText != null) {
    return sanitizePrice(fromText, { isCar, assumeThousands: false });
  }
  const fromRawLabel = firstLabeledPrice(raw);
  if (fromRawLabel != null) {
    return sanitizePrice(fromRawLabel, { isCar, assumeThousands: false });
  }
  const blob = `${extraText || ''} ${raw || ''}`;
  const kRe = /(\d+(?:\.\d+)?)\s*(?:[kK](?![mMا\w])|ألف|الف)/g;
  let kMatch;
  while ((kMatch = kRe.exec(String(blob)))) {
    const before = blob.slice(Math.max(0, kMatch.index - 18), kMatch.index);
    const after = blob.slice(kMatch.index + kMatch[0].length, kMatch.index + kMatch[0].length + 10);
    if (/(ممشي|ممشى|كم|km|كيلو)/i.test(before) || /^(?:\s*(?:km|كم|كيلو))/i.test(after)) {
      continue;
    }
    const n = Number(kMatch[1]);
    if (n > 0 && n < 1000) return sanitizePrice(n * 1000, { isCar });
    if (n >= 1000) return sanitizePrice(n, { isCar });
  }
  const n = parseNumber(raw);
  if (n == null) return null;
  return sanitizePrice(n, { isCar, assumeThousands });
}

function repairListingPrice({ title, description, categoryId, source } = {}) {
  const isCar = categoryId === 'cars';
  const assumeThousands = source === 'haraj' && isCar;
  const text = `${title || ''} ${description || ''}`;
  return parsePrice(null, text, { isCar, assumeThousands });
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

function parseExpatTitle(title, { literalSar = false, isCar = false } = {}) {
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  let price = null;
  let rest = raw;
  const priceHead = raw.match(
    /^(?:SAR|USD|AED|SR)?\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*(?:month|year|week|day|mo|yr|munthly|monthly|yearly))?\s*,\s*/i,
  );
  if (priceHead) {
    price = sanitizePrice(Number(String(priceHead[1]).replace(/,/g, '')), {
      isCar,
      assumeThousands: false,
    });
    rest = raw.slice(priceHead[0].length);
  } else {
    price = parsePrice(null, raw, { isCar, assumeThousands: false });
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
  const souqCat = String(item.souqCategory || item.categoryId || '').trim();
  const isCar = souqCat === 'cars' || souqCat === '';
  const assumeThousands = source === 'haraj' && isCar;
  const fromTitle =
    source === 'expatriates' ? parseExpatTitle(title, { isCar }) : {};
  const year = Number(item.Year || item.year || fromTitle.year || 0) || null;
  const mileage = parseMileage(item.mileage ?? item.Mileage, title);
  const price =
    parsePrice(item.price, title, { isCar, assumeThousands }) ??
    fromTitle.price ??
    null;
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
    inferBodyType(blob) ||
    'sedan';
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
  repairListingPrice,
};
