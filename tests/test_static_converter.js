const fs = require("fs");
const path = require("path");
const assert = require("assert");
const converter = require("../web/converter.js");

const root = path.resolve(__dirname, "..");

function readExample(name) {
  return fs.readFileSync(path.join(root, "Examples", name), "utf8");
}

function linesStartingWith(text, prefix) {
  return text.split(/\r?\n/).filter((line) => line.startsWith(prefix));
}

{
  const result = converter.generateXxlFromText(readExample("part1.DXF"), {
    drillDepth: 10,
    camName: "PART1",
    dateStamp: "18-JUN-2026",
  });
  assert.strictEqual(result.model.dowels.length, 12);
  assert.strictEqual(linesStartingWith(result.code, "B X=").length, 12);
  assert(result.code.includes("B X=9 Y=-20 Z=10"));
}

{
  const result = converter.generateXxlFromText(readExample("part2 dxf.DXF"), {
    thickness: 18,
    maxPassDepth: 0,
    camName: "PART2",
    dateStamp: "18-JUN-2026",
  });
  assert(result.code.includes('H DX=510 DY=210 DZ=18-IL C=0 T=16973825 R=999 *MM /"def" BX=0 BY=210 BZ=0 V=10'));
  assert(result.code.includes("XG0 X=123 Y=17 Z=20 V=2 T=1 P=0 D=25 C=1 s=0"));
  assert.strictEqual(linesStartingWith(result.code, "B X=").length, 12);
  assert(result.code.includes("B X=14 Y=-25 Z=18"));
  assert.strictEqual(result.detected.contours.length, 1);
}

{
  const result = converter.generateXxlFromText(readExample("part3.DXF"), {
    cutDepth: 20,
    drillDepth: 10,
    camName: "PART3",
    dateStamp: "18-JUN-2026",
  });
  assert.strictEqual(result.model.dowels.length, 12);
  assert.strictEqual(result.detected.contours[0].role, "internal");
  assert(result.code.includes("XG0 X=172 Y=-96.283 Z=10 V=2 T=1 P=0 D=43 C=1 s=0"));
  assert(result.code.includes("XG0 X=172 Y=-96.283 Z=20 V=2 T=1 P=0 D=43 C=1 s=0"));
}

console.log("static converter tests OK");
