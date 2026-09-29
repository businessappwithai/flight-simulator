// Regression: ISSUE-009 — sea, fields and mountains washed out because sRGB vertex colours were used as linear.
// Found by /qa on 2026-09-29. Report: .gstack/qa-reports/qa-report-appwithai-org-2026-09-29.md
import {expect,test} from "bun:test";
import {linearColors} from "../apps/simulator/src/vertex-colors.ts";

test("sRGB vertex colour bytes are converted to linear before three.js lights them",()=>{
 const c=linearColors(Uint8Array.from([0,255,128,10]));
 expect(c[0]).toBe(0);expect(c[1]).toBeCloseTo(1,6);
 expect(c[2]).toBeCloseTo(0.2158,3);          // mid grey is ~22 % linear, not 50 %
 expect(c[3]).toBeCloseTo(10/255/12.92,6);    // the linear toe of the curve
 // A sea blue stays a dark saturated blue (as bytes/255 it came out pale).
 const sea=linearColors(Uint8Array.from([40,90,150]));
 expect(sea[2]!/sea[0]!).toBeGreaterThan(10);
});
