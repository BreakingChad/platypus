import { describe, it, expect } from "vitest";
import {
  autoGenerateFilename,
  buildStoragePath,
  formatFileSize,
  categoryByKey,
  docTypeByKey,
  CDISC_CATEGORIES,
  DOC_TYPES,
} from "./documents";

describe("autoGenerateFilename", () => {
  it("composes STUDY_TYPE_VER_DATE.ext", () => {
    const name = autoGenerateFilename({
      studyCode: "STU-001",
      docTypeCode: "PROT",
      version: "v2",
      uploadedAt: new Date("2026-05-27T12:00:00Z"),
      originalFilename: "Trial Protocol Final.pdf",
    });
    expect(name).toBe("STU-001_PROT_v2_20260527.pdf");
  });

  it("sanitizes unsafe characters in inputs", () => {
    const name = autoGenerateFilename({
      studyCode: "STU/001",
      docTypeCode: "PR$OT",
      version: "v2!",
      uploadedAt: new Date("2026-01-15T00:00:00Z"),
      originalFilename: "protocol.docx",
    });
    expect(name).toMatch(/^STU_001_PR_OT_v2_20260115\.docx$/);
  });

  it("falls back to .bin when there's no extension", () => {
    const name = autoGenerateFilename({
      studyCode: "STU-001",
      docTypeCode: "DOC",
      version: "v1",
      uploadedAt: new Date("2026-01-01T00:00:00Z"),
      originalFilename: "no-extension",
    });
    expect(name.endsWith(".bin")).toBe(true);
  });
});

describe("buildStoragePath", () => {
  it("encodes the org/study/doc/version convention", () => {
    expect(
      buildStoragePath({
        orgId: "11111111-1111-1111-1111-111111111111",
        studyId: "22222222-2222-2222-2222-222222222222",
        documentId: "33333333-3333-3333-3333-333333333333",
        versionId: "44444444-4444-4444-4444-444444444444",
        ext: "pdf",
      })
    ).toBe(
      "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/44444444-4444-4444-4444-444444444444.pdf"
    );
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
  });
  it("formats KB/MB/GB", () => {
    // small values get one decimal so "1.5 KB" reads naturally.
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(1024 * 1024 * 2)).toBe("2.0 MB");
    expect(formatFileSize(1024 * 1024 * 1024 * 3)).toBe("3.0 GB");
    // Two-digit values drop the decimal.
    expect(formatFileSize(1024 * 12)).toBe("12 KB");
  });
  it("uses one decimal for sub-10 values", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024 * 5.5)).toBe("5.5 MB");
  });
});

describe("catalog lookups", () => {
  it("categoryByKey + docTypeByKey return the matching entries", () => {
    expect(categoryByKey("protocol")?.label).toBe("Protocol");
    expect(categoryByKey("missing")).toBeUndefined();
    expect(docTypeByKey("icf")?.code).toBe("ICF");
    expect(docTypeByKey("missing")).toBeUndefined();
  });

  it("every doc type's defaultCategory points to a known category", () => {
    const knownCategoryKeys = new Set(CDISC_CATEGORIES.map((c) => c.key));
    for (const t of DOC_TYPES) {
      expect(knownCategoryKeys.has(t.defaultCategory)).toBe(true);
    }
  });
});
