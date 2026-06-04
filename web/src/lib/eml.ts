/** EML metadata extraction — pure, dependency-free, unit-tested.
 *
 *  Handles the two things naive header regexes miss:
 *   1. FOLDED headers (RFC 5322 §2.2.3): continuation lines start with
 *      whitespace and belong to the previous header.
 *   2. ENCODED-WORDS (RFC 2047): =?charset?B|Q?data?= atoms in Subject/From,
 *      base64 ("B") or quoted-printable-ish ("Q", where _ = space).
 */

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return s;
    }
  }
}

function decodeEncodedWord(charset: string, enc: string, data: string): string {
  const upper = enc.toUpperCase();
  if (upper === "B") {
    try {
      const bin = atob(data.replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return decodeBytes(bytes, charset);
    } catch {
      return data;
    }
  }
  if (upper === "Q") {
    const out: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (c === "_") out.push(0x20);
      else if (c === "=" && i + 2 < data.length + 1) {
        const hex = data.slice(i + 1, i + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          out.push(parseInt(hex, 16));
          i += 2;
        } else out.push(c.charCodeAt(0));
      } else out.push(c.charCodeAt(0));
    }
    return decodeBytes(new Uint8Array(out), charset);
  }
  return data;
}

/** Decode all RFC 2047 encoded-words in a header value; adjacent encoded
 *  words separated only by whitespace are joined without the space. */
export function decodeRfc2047(value: string): string {
  // Join adjacent encoded-words (whitespace between them is not rendered).
  const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_m, charset: string, enc: string, data: string) =>
      decodeEncodedWord(charset.split("*")[0], enc, data)
  );
}

/** Unfold RFC 5322 folded headers: CRLF/LF followed by WSP is a fold. */
export function unfoldHeaders(headerBlock: string): string {
  return headerBlock.replace(/\r?\n[ \t]+/g, " ");
}

export function parseEmlMetadata(text: string): {
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
} {
  const rawBlock = text.split(/\r?\n\r?\n/)[0] ?? text.slice(0, 8000);
  const headerBlock = unfoldHeaders(rawBlock);
  const get = (name: string): string | undefined => {
    const m = headerBlock.match(new RegExp("^" + name + ":\\s*(.+)$", "im"));
    return m ? decodeRfc2047(m[1].trim()) : undefined;
  };
  return { subject: get("Subject"), from: get("From"), to: get("To"), date: get("Date") };
}
