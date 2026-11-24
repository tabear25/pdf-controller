const BASIC: Readonly<Record<string, readonly string[]>> = {
  あ: ["a"],
  い: ["i"],
  う: ["u"],
  え: ["e"],
  お: ["o"],
  か: ["ka"],
  き: ["ki"],
  く: ["ku"],
  け: ["ke"],
  こ: ["ko"],
  さ: ["sa"],
  し: ["shi", "si"],
  す: ["su"],
  せ: ["se"],
  そ: ["so"],
  た: ["ta"],
  ち: ["chi", "ti"],
  つ: ["tsu", "tu"],
  て: ["te"],
  と: ["to"],
  な: ["na"],
  に: ["ni"],
  ぬ: ["nu"],
  ね: ["ne"],
  の: ["no"],
  は: ["ha"],
  ひ: ["hi"],
  ふ: ["fu", "hu"],
  へ: ["he"],
  ほ: ["ho"],
  ま: ["ma"],
  み: ["mi"],
  む: ["mu"],
  め: ["me"],
  も: ["mo"],
  や: ["ya"],
  ゆ: ["yu"],
  よ: ["yo"],
  ら: ["ra"],
  り: ["ri"],
  る: ["ru"],
  れ: ["re"],
  ろ: ["ro"],
  わ: ["wa"],
  ゐ: ["i", "wi"],
  ゑ: ["e", "we"],
  を: ["o", "wo"],
  が: ["ga"],
  ぎ: ["gi"],
  ぐ: ["gu"],
  げ: ["ge"],
  ご: ["go"],
  ざ: ["za"],
  じ: ["ji", "zi"],
  ず: ["zu"],
  ぜ: ["ze"],
  ぞ: ["zo"],
  だ: ["da"],
  ぢ: ["ji", "di", "zi"],
  づ: ["zu", "du"],
  で: ["de"],
  ど: ["do"],
  ば: ["ba"],
  び: ["bi"],
  ぶ: ["bu"],
  べ: ["be"],
  ぼ: ["bo"],
  ぱ: ["pa"],
  ぴ: ["pi"],
  ぷ: ["pu"],
  ぺ: ["pe"],
  ぽ: ["po"],
  ゔ: ["vu", "bu"],
  ぁ: ["a"],
  ぃ: ["i"],
  ぅ: ["u"],
  ぇ: ["e"],
  ぉ: ["o"],
};

const PALATAL: Readonly<Record<string, readonly string[]>> = {
  き: ["ky"],
  ぎ: ["gy"],
  し: ["sh", "sy"],
  じ: ["j", "jy", "zy"],
  ち: ["ch", "ty", "cy"],
  ぢ: ["j", "dy", "zy"],
  に: ["ny"],
  ひ: ["hy"],
  び: ["by"],
  ぴ: ["py"],
  み: ["my"],
  り: ["ry"],
};

const SMALL_Y: Readonly<Record<string, string>> = { ゃ: "a", ゅ: "u", ょ: "o" };
const SMALL_VOWEL: Readonly<Record<string, string>> = { ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o" };
const SEPARATOR = "[\\s.,_\\-]*";
const OPTIONAL_SEPARATOR = "[\\s.,_\\-]?";
const LETTER_BOUNDARY_BEFORE = "(?<![a-z\\u00c0-\\u024f])";
const LETTER_BOUNDARY_AFTER = "(?![a-z\\u00c0-\\u024f])";

interface Syllable {
  pattern: string;
  long: boolean;
  readonly vowel: string;
  readonly first: readonly string[];
}

function group(alternatives: readonly string[]): string {
  return alternatives.length === 1 ? alternatives[0]! : `(?:${alternatives.join("|")})`;
}

function toHiragana(text: string): string {
  return text.normalize("NFKC").replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function lengthen(syllable: Syllable): void {
  if (syllable.long) return;
  syllable.long = true;
  const base = syllable.pattern;
  if (syllable.vowel === "o") syllable.pattern = `(?:${base}(?:u|h|o)?|${trimVowel(base)}[ōô])`;
  else if (syllable.vowel === "u") syllable.pattern = `(?:${base}u?|${trimVowel(base)}[ūû])`;
  else if (syllable.vowel) syllable.pattern = `${base}${syllable.vowel}?`;
}

function trimVowel(pattern: string): string {
  if (pattern.startsWith("(?:")) {
    const inner = pattern.slice(3, -1).split("|").map((alt) => alt.slice(0, -1));
    return `(?:${inner.join("|")})`;
  }
  return pattern.slice(0, -1);
}

function syllables(kana: string): Syllable[] | null {
  const chars = [...toHiragana(kana)].filter((ch) => ch.trim().length > 0 && ch !== "・");
  const out: Syllable[] = [];
  let geminate = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1];
    if (ch === "っ") {
      geminate = true;
      continue;
    }
    const last = out[out.length - 1];
    if (ch === "ー") {
      if (last) lengthen(last);
      continue;
    }
    if (last && ((ch === "う" && (last.vowel === "o" || last.vowel === "u")) || (ch === "お" && last.vowel === "o"))) {
      lengthen(last);
      continue;
    }
    if (ch === "ん") {
      out.push({ pattern: "n", long: false, vowel: "", first: ["n"] });
      continue;
    }
    let alternatives: readonly string[] | undefined;
    if (next && SMALL_Y[next] && PALATAL[ch]) {
      alternatives = PALATAL[ch]!.map((c) => c + SMALL_Y[next]!);
      i += 1;
    } else if (next && SMALL_VOWEL[next] && BASIC[ch]) {
      alternatives = BASIC[ch]!.map((alt) => alt.slice(0, -1) + SMALL_VOWEL[next]!);
      i += 1;
    } else {
      alternatives = BASIC[ch];
    }
    if (!alternatives) return null;
    if (geminate) {
      alternatives = alternatives.flatMap((alt) => (alt.startsWith("ch") ? [`t${alt}`, `c${alt}`] : [`${alt[0]}${alt}`]));
      geminate = false;
    }
    out.push({ pattern: group(alternatives), long: false, vowel: alternatives[0]!.slice(-1), first: alternatives.map((alt) => alt[0]!) });
  }
  for (let k = 0; k < out.length - 1; k++) {
    const syllable = out[k]!;
    if (syllable.pattern !== "n") continue;
    const following = out[k + 1]!.first;
    if (following.some((c) => "bmp".includes(c))) syllable.pattern = "[nm]";
    else if (following.some((c) => "aiueoy".includes(c))) syllable.pattern = "n'?";
  }
  return out.length > 0 ? out : null;
}

export function romajiPart(kana: string, separable = false): string | null {
  const parts = syllables(kana);
  if (!parts) return null;
  return parts.map((s) => s.pattern).join(separable ? OPTIONAL_SEPARATOR : "");
}

export function romajiNamePattern(kana: string): string | null {
  const tokens = toHiragana(kana).split(/[\s・]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    const whole = romajiPart(tokens[0]!, true);
    return whole && [...tokens[0]!].length >= 2 ? `${LETTER_BOUNDARY_BEFORE}${whole}${LETTER_BOUNDARY_AFTER}` : null;
  }
  const family = romajiPart(tokens[0]!);
  const given = romajiPart(tokens.slice(1).join(""));
  if (!family || !given) return null;
  const options = [`${family}${SEPARATOR}${given}`, `${given}${SEPARATOR}${family}`];
  if ([...tokens[0]!].length >= 2) options.push(family);
  return `${LETTER_BOUNDARY_BEFORE}(?:${options.join("|")})${LETTER_BOUNDARY_AFTER}`;
}
