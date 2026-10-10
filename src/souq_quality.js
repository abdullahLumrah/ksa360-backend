function isMoverPackerListing(title, description = '') {
  const heading = String(title || '').toLowerCase();
  const text = `${heading} ${String(description || '').toLowerCase()}`;
  if (
    /\b(with packing|packing box(?:es)?|moving sale|doll house|carrier belt)\b/.test(heading)
  ) {
    return false;
  }
  return (
    /\bmovers?\b/.test(text) ||
    /\bpackers?\b/.test(text) ||
    /\b(house|home|office|villa|apartment|compound|furniture)\s+(shifting|moving|packing)\b/.test(
      text,
    ) ||
    /\b(shifting|packing)\s+(home|house|office|villa|apartment|compound)\b/.test(text) ||
    /\b(moving|shifting)\s+(company|service|team|campany)\b/.test(text) ||
    /\bpacking\s*(?:&|and)?\s*moving\b/.test(text) ||
    /\bgoods\s+shifting\b/.test(text) ||
    /\bhouse\s*shift/.test(text) ||
    (/\b(loading|unloading)\b/.test(text) && /\b(shifting|movers?|goods|furniture)\b/.test(text))
  );
}

module.exports = { isMoverPackerListing };
