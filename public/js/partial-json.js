// Reads JSON that is still being written (an AI answer mid-stream) and returns whatever
// is there so far: finished values, plus the unfinished string at the end, cut where it stops.
// Only what the AI features need: objects, arrays and strings (numbers and literals are skipped).
export function partialJSON(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const str = () => {
    i++; // opening quote
    let out = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '"') { i++; return out; }
      if (c === '\\') {
        const n = src[i + 1];
        if (n === undefined) break;
        if (n === 'u') {
          const hex = src.slice(i + 2, i + 6);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[n] ?? n;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    i = src.length;
    return out;
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === '"') return str();
    if (c === '{') {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (i >= src.length) return o;
        if (src[i] === '}') { i++; return o; }
        if (src[i] === ',') { i++; continue; }
        if (src[i] !== '"') return o;
        const k = str();
        ws();
        if (src[i] !== ':') return o;
        i++;
        ws();
        if (i >= src.length) return o;
        o[k] = value();
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (i >= src.length) return a;
        if (src[i] === ']') { i++; return a; }
        if (src[i] === ',') { i++; continue; }
        a.push(value());
      }
    }
    // number / true / false / null: skip to the next delimiter
    const start = i;
    while (i < src.length && !/[,}\]\s]/.test(src[i])) i++;
    try { return JSON.parse(src.slice(start, i)); } catch { return undefined; }
  };
  // Some models wrap JSON in prose or a code fence; start at the first brace.
  i = Math.max(0, src.indexOf('{'));
  return src.includes('{') ? value() : {};
}
