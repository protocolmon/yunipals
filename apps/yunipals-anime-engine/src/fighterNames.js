/** Normalize legacy species prefixes in battle labels, preserving their casing. */
export function animeFighterName(value) {
  return value.replace(/\buni(?=[a-z])/gi, (prefix) => {
    if (prefix === prefix.toUpperCase()) return "YUNI";
    return prefix[0] === prefix[0].toUpperCase() ? "Yuni" : "yuni";
  });
}
