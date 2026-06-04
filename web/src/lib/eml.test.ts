import { describe, it, expect } from "vitest";
import { parseEmlMetadata, decodeRfc2047, unfoldHeaders } from "./eml";

describe("parseEmlMetadata", () => {
  it("parses plain headers", () => {
    const eml = "From: jane@sponsor.com\r\nTo: site@clinic.org\r\nSubject: CDA fully executed\r\nDate: Tue, 2 Jun 2026 09:15:00 -0500\r\n\r\nBody here";
    const m = parseEmlMetadata(eml);
    expect(m.from).toBe("jane@sponsor.com");
    expect(m.subject).toBe("CDA fully executed");
    expect(m.date).toContain("2026");
  });

  it("unfolds folded headers", () => {
    const eml = "Subject: Protocol amendment 3 —\r\n site impact assessment attached\r\nFrom: cro@partner.com\r\n\r\nbody";
    const m = parseEmlMetadata(eml);
    expect(m.subject).toBe("Protocol amendment 3 — site impact assessment attached");
  });

  it("decodes UTF-8 B (base64) encoded subjects", () => {
    // "Étude — budget révisé"
    const eml = "Subject: =?UTF-8?B?w4l0dWRlIOKAlCBidWRnZXQgcsOpdmlzw6k=?=\r\nFrom: a@b.c\r\n\r\n";
    expect(parseEmlMetadata(eml).subject).toBe("Étude — budget révisé");
  });

  it("decodes Q encoding with underscores as spaces", () => {
    const eml = "Subject: =?utf-8?Q?IRB_approval_=E2=80=94_final?=\r\n\r\n";
    expect(parseEmlMetadata(eml).subject).toBe("IRB approval — final");
  });

  it("joins adjacent encoded-words without injected spaces", () => {
    const v = "=?UTF-8?Q?Hello_?= =?UTF-8?Q?World?=";
    expect(decodeRfc2047(v)).toBe("Hello World");
  });

  it("does not read headers past the first blank line (body)", () => {
    const eml = "Subject: real\r\n\r\nFrom: forged-in-body@evil.test";
    const m = parseEmlMetadata(eml);
    expect(m.subject).toBe("real");
    expect(m.from).toBeUndefined();
  });

  it("unfoldHeaders joins tab continuations", () => {
    expect(unfoldHeaders("X: a\r\n\tb")).toBe("X: a b");
  });
});
