/** USB card reader with Czech QWERTZ: digit keys send +escrzyaie instead of 0-9. */

const CZ_CHAR_TO_DIGIT: Record<string, string> = {
  "+": "1",
  "\u011B": "2",
  "\u0161": "3",
  "\u010D": "4",
  "\u0159": "5",
  "\u017E": "6",
  "\u00FD": "7",
  "\u00E1": "8",
  "\u00ED": "9",
  "\u00E9": "0",
};

export function normalizeCzechKeyboardReaderNumeric(value: string): string {
  if (!value) return value;
  const s = value.normalize("NFC");
  let out = "";
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
      continue;
    }
    const lower = ch.toLowerCase();
    const mapped = CZ_CHAR_TO_DIGIT[ch] ?? CZ_CHAR_TO_DIGIT[lower];
    out += mapped ?? ch;
  }
  return out;
}
