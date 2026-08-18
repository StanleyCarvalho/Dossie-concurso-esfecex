function fixMojibake(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  if (!/[ÃÂ]/.test(value)) return value;

  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch (e) {
    return value;
  }
}

module.exports = { fixMojibake };
