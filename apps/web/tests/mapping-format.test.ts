import assert from "node:assert/strict";
import { test } from "node:test";

import { RegionCode } from "@prostapaper/contracts";

import { formatMappingValue, formatMarkLabel, formatRegion } from "#lib/mapping-format";

await test("region values use the same anatomical names and patient sides as the diagram", () => {
  assert.equal(formatMappingValue(["pzpl_mid_ls", "as_apex_rs"]), "Střed · PZpl vlevo, Apex · AFS vpravo");
  assert.equal(formatMappingValue("sv_base_rs"), "Semenný váček vpravo");
  assert.equal(formatMappingValue("urethra"), "Uretra");
  for (const code of RegionCode.options) assert.notEqual(formatMappingValue(code), code);
});

await test("choice labels omit export codes and unknown values remain visible", () => {
  assert.equal(formatMappingValue("1", [{ code: "1", label: "Ano" }]), "Ano");
  assert.equal(
    formatMappingValue("pzpl_mid_ls", [{ code: "pzpl_mid_ls", label: "pzpl_mid_ls" }]),
    "Střed · PZpl vlevo",
  );
  assert.equal(formatMappingValue("future_code", []), "future_code");
  assert.equal(
    formatMappingValue("future_code", [{ code: "future_code", label: "future_code" }]),
    "future_code",
  );
});

await test("empty values and default false remain distinguishable from positive findings", () => {
  assert.equal(formatMappingValue(null), "Neuvedeno v dokumentech");
  assert.equal(formatMappingValue([]), "Neuvedeno v dokumentech");
  assert.equal(formatMappingValue(false), "Neoznačeno (výchozí stav)");
  assert.equal(formatMappingValue(true), "Ano");
  assert.equal(formatMappingValue(0), "0");
});

await test("region and mark labels have honest fallbacks without displaying audit identifiers", () => {
  assert.equal(formatRegion("pzpm_base_rs"), "Báze · PZpm vpravo");
  assert.equal(formatRegion("unknown_region"), "unknown_region");
  assert.equal(formatMarkLabel(0), "Značka 1");
  assert.equal(formatMarkLabel(2), "Značka 3");
  assert.equal(formatMarkLabel(-1), "Značka schématu");
});
