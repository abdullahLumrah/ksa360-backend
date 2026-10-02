function nameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function lookupVideo(map, name) {
  const key = nameKey(name);
  if (!key || key.length < 3) return '';
  const direct = map.get(key);
  if (direct) return direct;
  let bestKey = '';
  let bestId = '';
  for (const [saved, id] of map.entries()) {
    if (saved.length < 4 || !id) continue;
    if (key.includes(saved) || saved.includes(key)) {
      if (saved.length > bestKey.length) {
        bestKey = saved;
        bestId = id;
      }
    }
  }
  return bestId;
}

module.exports = { nameKey, lookupVideo };
