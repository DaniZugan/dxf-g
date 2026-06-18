(function attachConverter(root) {
  const EPS = 0.01;
  const LEAD_RADIUS = 22.0;
  const DOWEL_RADIUS = 4.0;
  const DOWEL_RADIUS_TOLERANCE = 0.05;

  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }

    distanceTo(other) {
      return Math.hypot(this.x - other.x, this.y - other.y);
    }

    machine() {
      return new Point(this.x, -this.y);
    }
  }

  class Segment {
    constructor(kind, start, end, center = null, ccwDxf = true) {
      this.kind = kind;
      this.start = start;
      this.end = end;
      this.center = center;
      this.ccwDxf = ccwDxf;
    }

    reversed() {
      return new Segment(this.kind, this.end, this.start, this.center, !this.ccwDxf);
    }

    length() {
      if (this.kind === "LINE" || !this.center) {
        return this.start.distanceTo(this.end);
      }
      const r = this.center.distanceTo(this.start);
      const a0 = Math.atan2(this.start.y - this.center.y, this.start.x - this.center.x);
      const a1 = Math.atan2(this.end.y - this.center.y, this.end.x - this.center.x);
      let delta = a1 - a0;
      if (this.ccwDxf && delta < 0) delta += Math.PI * 2;
      if (!this.ccwDxf && delta > 0) delta -= Math.PI * 2;
      return Math.abs(delta) * r;
    }

    splitAt(distance) {
      if (this.kind !== "LINE") {
        throw new Error("Only line segments can be split for lead-in");
      }
      const total = this.length();
      if (total <= EPS) {
        return [this.start, this];
      }
      const t = Math.max(0, Math.min(1, distance / total));
      const point = new Point(
        this.start.x + (this.end.x - this.start.x) * t,
        this.start.y + (this.end.y - this.start.y) * t
      );
      return [point, new Segment("LINE", point, this.end)];
    }
  }

  class Circle {
    constructor(center, radius) {
      this.center = center;
      this.radius = radius;
    }
  }

  class Contour {
    constructor(segments, bbox, role) {
      this.segments = segments;
      this.bbox = bbox;
      this.role = role;
    }
  }

  function fmt(value) {
    let v = Math.abs(value) < 0.0005 ? 0 : value;
    if (Math.abs(v - Math.round(v)) < 0.0005) {
      return String(Math.round(v));
    }
    return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  function parseNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseDxfText(text) {
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i < lines.length - 1; i += 2) {
      pairs.push([lines[i].trim(), lines[i + 1].trim()]);
    }

    let inEntities = false;
    let currentType = null;
    let current = new Map();
    const circles = [];
    const segments = [];

    function values(code) {
      return current.get(code) || [];
    }

    function firstFloat(code, fallback = 0) {
      const vals = values(code);
      return vals.length ? parseNumber(vals[0], fallback) : fallback;
    }

    function flush() {
      if (currentType === "CIRCLE") {
        circles.push(new Circle(new Point(firstFloat("10"), firstFloat("20")), firstFloat("40")));
      } else if (currentType === "LINE") {
        segments.push(
          new Segment(
            "LINE",
            new Point(firstFloat("10"), firstFloat("20")),
            new Point(firstFloat("11"), firstFloat("21"))
          )
        );
      } else if (currentType === "ARC") {
        const center = new Point(firstFloat("10"), firstFloat("20"));
        const radius = firstFloat("40");
        const startAngle = (firstFloat("50") * Math.PI) / 180;
        const endAngle = (firstFloat("51") * Math.PI) / 180;
        segments.push(
          new Segment(
            "ARC",
            new Point(center.x + radius * Math.cos(startAngle), center.y + radius * Math.sin(startAngle)),
            new Point(center.x + radius * Math.cos(endAngle), center.y + radius * Math.sin(endAngle)),
            center,
            true
          )
        );
      } else if (currentType === "LWPOLYLINE") {
        const xs = values("10").map((v) => parseNumber(v));
        const ys = values("20").map((v) => parseNumber(v));
        const flags = values("70").length ? Math.trunc(parseNumber(values("70")[0])) : 0;
        const points = xs.map((x, index) => new Point(x, ys[index])).filter((point) => Number.isFinite(point.y));
        for (let i = 0; i < points.length - 1; i += 1) {
          segments.push(new Segment("LINE", points[i], points[i + 1]));
        }
        if ((flags & 1) && points.length > 1) {
          segments.push(new Segment("LINE", points[points.length - 1], points[0]));
        }
      }
      currentType = null;
      current = new Map();
    }

    for (const [code, value] of pairs) {
      if (code === "0") {
        if (value === "SECTION") {
          flush();
          currentType = null;
          current = new Map();
          continue;
        }
        if (value === "ENDSEC") {
          flush();
          inEntities = false;
          continue;
        }
        if (value === "EOF") {
          flush();
          break;
        }
        if (inEntities) {
          flush();
          if (["CIRCLE", "LINE", "ARC", "LWPOLYLINE"].includes(value)) {
            currentType = value;
            current = new Map();
          }
          continue;
        }
      }
      if (code === "2" && value === "ENTITIES") {
        inEntities = true;
        continue;
      }
      if (inEntities && currentType !== null) {
        if (!current.has(code)) current.set(code, []);
        current.get(code).push(value);
      }
    }

    flush();
    return { circles, segments };
  }

  function isDowelCircle(circle) {
    return Math.abs(circle.radius - DOWEL_RADIUS) <= DOWEL_RADIUS_TOLERANCE;
  }

  function dowelCircles(circles) {
    return circles.filter(isDowelCircle);
  }

  function bboxOfSegments(segments) {
    const points = [];
    for (const segment of segments) {
      points.push(segment.start, segment.end);
      if (segment.kind === "ARC" && segment.center) {
        const r = segment.center.distanceTo(segment.start);
        points.push(new Point(segment.center.x - r, segment.center.y - r));
        points.push(new Point(segment.center.x + r, segment.center.y + r));
      }
    }
    return [
      Math.min(...points.map((point) => point.x)),
      Math.min(...points.map((point) => point.y)),
      Math.max(...points.map((point) => point.x)),
      Math.max(...points.map((point) => point.y)),
    ];
  }

  function bboxArea(bbox) {
    return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
  }

  function pointInBBox(point, bbox, margin = 0) {
    return (
      bbox[0] - margin <= point.x &&
      point.x <= bbox[2] + margin &&
      bbox[1] - margin <= point.y &&
      point.y <= bbox[3] + margin
    );
  }

  function groupSegments(segments) {
    const groups = [];
    for (const segment of segments) {
      let placed = false;
      const endpoints = [segment.start, segment.end];
      for (const group of groups) {
        const matches = endpoints.some((endpoint) =>
          group.some((member) => [member.start, member.end].some((existing) => endpoint.distanceTo(existing) <= EPS))
        );
        if (matches) {
          group.push(segment);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([segment]);
    }

    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < groups.length; i += 1) {
        for (let j = i + 1; j < groups.length; j += 1) {
          const matches = groups[i].some((member) =>
            [member.start, member.end].some((endpoint) =>
              groups[j].some((other) =>
                [other.start, other.end].some((existing) => endpoint.distanceTo(existing) <= EPS)
              )
            )
          );
          if (matches) {
            groups[i].push(...groups.splice(j, 1)[0]);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }
    return groups;
  }

  function orderSegments(group) {
    if (!group.length) return [];
    const unused = [...group];
    const ordered = [unused.shift()];
    while (unused.length) {
      const tail = ordered[ordered.length - 1].end;
      let matchIndex = -1;
      let reverse = false;
      for (let i = 0; i < unused.length; i += 1) {
        if (tail.distanceTo(unused[i].start) <= EPS) {
          matchIndex = i;
          break;
        }
        if (tail.distanceTo(unused[i].end) <= EPS) {
          matchIndex = i;
          reverse = true;
          break;
        }
      }
      if (matchIndex < 0) {
        ordered.push(...unused);
        break;
      }
      const candidate = unused.splice(matchIndex, 1)[0];
      ordered.push(reverse ? candidate.reversed() : candidate);
    }
    return ordered;
  }

  function reversePath(path) {
    return [...path].reverse().map((segment) => segment.reversed());
  }

  function isRectLike(path) {
    if (!path.length) return false;
    return path.every((segment) => {
      if (segment.kind === "LINE") {
        const sameX = Math.abs(segment.start.x - segment.end.x) <= EPS;
        const sameY = Math.abs(segment.start.y - segment.end.y) <= EPS;
        return sameX || sameY;
      }
      return segment.kind === "ARC";
    });
  }

  function classifyContours(circles, segments) {
    const groups = groupSegments(segments).map(orderSegments).filter((group) => group.length);
    if (!groups.length) return { stockBBox: null, contours: [] };

    const bboxes = groups.map(bboxOfSegments);
    let stockIndex = 0;
    for (let i = 1; i < groups.length; i += 1) {
      if (bboxArea(bboxes[i]) > bboxArea(bboxes[stockIndex])) stockIndex = i;
    }
    const stockBBox = bboxes[stockIndex];
    const contours = [];

    groups.forEach((group, index) => {
      const bbox = bboxes[index];
      if (index === stockIndex && groups.length > 1) return;
      if (index === stockIndex && groups.length === 1 && circles.length) return;

      const area = bboxArea(bbox);
      const stockArea = bboxArea(stockBBox);
      const holesInside = circles.filter((circle) => pointInBBox(circle.center, bbox, EPS)).length;
      let role = "external";
      let contourGroup = group;
      if (stockArea && area < stockArea * 0.75 && holesInside === 0) {
        role = "internal";
        contourGroup = reversePath(group);
      }
      contours.push(new Contour([...contourGroup], bbox, role));
    });

    return { stockBBox, contours };
  }

  function snakeSortedCircles(circles) {
    const columns = new Map();
    for (const circle of circles) {
      const key = Math.round(circle.center.x * 1000);
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(circle);
    }
    const result = [];
    [...columns.keys()].sort((a, b) => a - b).forEach((key, columnIndex) => {
      const column = columns.get(key);
      column.sort((a, b) => (columnIndex % 2 ? b.center.y - a.center.y : a.center.y - b.center.y));
      result.push(...column);
    });
    return result;
  }

  function depthPasses(cutDepth, maxPassDepth) {
    if (cutDepth <= 0) return [];
    if (maxPassDepth <= 0 || cutDepth <= maxPassDepth) return [cutDepth];
    const passes = [];
    let current = maxPassDepth;
    while (current < cutDepth) {
      passes.push(current);
      current += maxPassDepth;
    }
    passes.push(cutDepth);
    return passes;
  }

  function unitVector(a, b) {
    const length = a.distanceTo(b);
    if (length <= EPS) return new Point(1, 0);
    return new Point((b.x - a.x) / length, (b.y - a.y) / length);
  }

  function leftNormal(vector) {
    return new Point(-vector.y, vector.x);
  }

  function leadPoints(cutStart, nextPoint, radius = LEAD_RADIUS) {
    const direction = unitVector(cutStart, nextPoint);
    const normal = leftNormal(direction);
    const center = new Point(cutStart.x + normal.x * radius, cutStart.y + normal.y * radius);
    const start = new Point(center.x - direction.x * radius, center.y - direction.y * radius);
    return [start, center];
  }

  function rectPath(contour) {
    const [minX, minY, maxX, maxY] = contour.bbox;
    const width = maxX - minX;
    const height = maxY - minY;
    if (contour.role === "internal") {
      const startY = minY + height * 0.68283;
      return [
        new Point(minX, startY),
        new Point(minX, maxY),
        new Point(maxX, maxY),
        new Point(maxX, minY),
        new Point(minX, minY),
        new Point(minX, startY),
      ];
    }
    const startX = minX + width * 0.28;
    return [
      new Point(startX, minY),
      new Point(maxX, minY),
      new Point(maxX, maxY),
      new Point(minX, maxY),
      new Point(minX, minY),
      new Point(startX, minY),
    ];
  }

  function rotateToLongLine(path) {
    const lineIndexes = path
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.kind === "LINE" && segment.length() > EPS)
      .map(({ index }) => index);
    if (!lineIndexes.length) return [[...path], null];
    const startIndex = lineIndexes.reduce((best, index) => (path[index].length() > path[best].length() ? index : best));
    const rotated = [...path.slice(startIndex), ...path.slice(0, startIndex)];
    const splitDistance = Math.max(LEAD_RADIUS * 2, rotated[0].length() * 0.28);
    const [splitPoint, firstSegment] = rotated[0].splitAt(splitDistance);
    rotated[0] = firstSegment;
    return [rotated, splitPoint];
  }

  function emitPoint(prefix, point, z, extra = "") {
    const machine = point.machine();
    return `${prefix} X=${fmt(machine.x)} Y=${fmt(machine.y)} Z=${fmt(z)}${extra ? ` ${extra}` : ""}`;
  }

  function emitContour(contour, z, cutterD) {
    const lines = [];
    if (isRectLike(contour.segments)) {
      const points = rectPath(contour);
      const cutStart = points[0];
      const nextPoint = points[1];
      const [leadStart, leadCenter] = leadPoints(cutStart.machine(), nextPoint.machine());
      const cutStartM = cutStart.machine();
      lines.push(`XG0 X=${fmt(leadStart.x)} Y=${fmt(leadStart.y)} Z=${fmt(z)} V=2 T=1 P=0 D=${cutterD} C=1 s=0`);
      lines.push(`XA2P X=${fmt(cutStartM.x)} Y=${fmt(cutStartM.y)} Z=${fmt(z)} I=${fmt(leadCenter.x)} J=${fmt(leadCenter.y)} G=2 V=6`);
      for (const point of points.slice(1)) {
        lines.push(emitPoint("XL2P", point, z));
      }
      const leadEnd = new Point(leadCenter.x + (leadCenter.x - leadStart.x), leadCenter.y + (leadCenter.y - leadStart.y));
      lines.push(`XA2P X=${fmt(leadEnd.x)} Y=${fmt(leadEnd.y)} Z=${fmt(z)} I=${fmt(leadCenter.x)} J=${fmt(leadCenter.y)} G=2`);
      return lines;
    }

    const [path, splitPoint] = rotateToLongLine(contour.segments);
    if (!splitPoint) return [];
    const cutStart = splitPoint;
    const nextPoint = path[0].end;
    const [leadStart, leadCenter] = leadPoints(cutStart.machine(), nextPoint.machine());
    const cutStartM = cutStart.machine();
    lines.push(`XG0 X=${fmt(leadStart.x)} Y=${fmt(leadStart.y)} Z=${fmt(z)} V=2 T=1 P=0 D=${cutterD} C=1 s=0`);
    lines.push(`XA2P X=${fmt(cutStartM.x)} Y=${fmt(cutStartM.y)} Z=${fmt(z)} I=${fmt(leadCenter.x)} J=${fmt(leadCenter.y)} G=2 V=6`);
    for (const segment of path) {
      if (segment.kind === "LINE") {
        lines.push(emitPoint("XL2P", segment.end, z));
      } else if (segment.kind === "ARC" && segment.center) {
        const end = segment.end.machine();
        const center = segment.center.machine();
        const g = segment.ccwDxf ? 2 : 3;
        lines.push(`XA2P X=${fmt(end.x)} Y=${fmt(end.y)} Z=${fmt(z)} I=${fmt(center.x)} J=${fmt(center.y)} G=${g}`);
      }
    }
    const leadEnd = new Point(leadCenter.x + (leadCenter.x - leadStart.x), leadCenter.y + (leadCenter.y - leadStart.y));
    lines.push(`XA2P X=${fmt(leadEnd.x)} Y=${fmt(leadEnd.y)} Z=${fmt(z)} I=${fmt(leadCenter.x)} J=${fmt(leadCenter.y)} G=2`);
    return lines;
  }

  function emitSection(title) {
    return [";******************************", `; ${title}`, ";******************************", "; ", "O X=0 Y=0 Z=0 F=1 ;Offset", "; "];
  }

  function dateStamp(date = new Date()) {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${String(date.getDate()).padStart(2, "0")}-${months[date.getMonth()]}-${date.getFullYear()}`;
  }

  function normalizeName(fileName) {
    return fileName.replace(/\.[^.]+$/, "").toUpperCase().replace(" DXF", "");
  }

  function buildModel(dxfText) {
    const parsed = parseDxfText(dxfText);
    const dowels = dowelCircles(parsed.circles);
    const classified = classifyContours(dowels, parsed.segments);
    return { ...parsed, dowels, stockBBox: classified.stockBBox, contours: classified.contours };
  }

  function generateXxlFromText(dxfText, options = {}) {
    const model = buildModel(dxfText);
    const externalContours = model.contours.filter((contour) => contour.role === "external");
    const internalContours = model.contours.filter((contour) => contour.role === "internal");
    const thickness = options.thickness ?? null;
    const cutDepth = options.cutDepth ?? (thickness !== null ? thickness + 2 : 20);
    const drillDepth = options.drillDepth ?? (thickness !== null ? thickness : 10);
    const maxPassDepth = options.maxPassDepth ?? 10;

    let dx = 0;
    let dy = 0;
    if (model.stockBBox && externalContours.length) {
      dx = model.stockBBox[2] - model.stockBBox[0];
      dy = model.stockBBox[3] - model.stockBBox[1];
    }
    const dz = thickness ?? 0;
    const name = options.camName || "OUTPUT";
    const today = options.dateStamp || dateStamp();

    const output = [
      `H DX=${fmt(dx)} DY=${fmt(dy)} DZ=${fmt(dz)}-IL C=0 T=16973825 R=999 *MM /"def" BX=0 BY=${fmt(dy)} BZ=0 V=10`,
      ";****************************************************************************",
      `;CAM_FileName: ${name}`,
      `;Datum XXL datoteke: ${today}`,
      ";DXF direct generator: static JavaScript",
      ";T1=REZKAR 20MM",
      ";T2=SVEDER 8MM",
      ";****************************************************************************",
      "IX=0",
      "IY=0;",
      "ROT A=0 X=0 Y=0",
      "PL X=0 Y=0 Z=0 Q=0 R=0",
      ";",
      "C=0",
      "F=1",
      ";Tilt Plane - POS 1",
      "PL X=0 Y=0 Z=0 Q=0 R=0",
    ];

    if (externalContours.length) {
      output.push(...emitSection("kontura okoli"));
      for (const contour of externalContours) {
        for (const z of depthPasses(cutDepth, maxPassDepth)) {
          output.push(...emitContour(contour, z, 25));
        }
      }
      output.push(";******************************");
    }

    if (model.dowels.length) {
      if (externalContours.length) {
        output.push(";Tilt Plane - POS 1", "PL X=0 Y=0 Z=0 Q=0 R=0");
      }
      output.push(...emitSection("luknje za moznike"));
      for (const circle of snakeSortedCircles(model.dowels)) {
        const center = circle.center.machine();
        output.push(`B X=${fmt(center.x)} Y=${fmt(center.y)} Z=${fmt(drillDepth)} V=2 S=3500 Q=0 R=1 x=0 y=0 D=2 G=1 T=2`);
      }
      output.push(";******************************");
    }

    if (internalContours.length) {
      output.push(";Tilt Plane - POS 1", "PL X=0 Y=0 Z=0 Q=0 R=0");
      output.push(...emitSection("izrez notri"));
      for (const contour of internalContours) {
        for (const z of depthPasses(cutDepth, maxPassDepth)) {
          output.push(...emitContour(contour, z, 43));
        }
      }
      output.push(";******************************");
    }

    output.push(";**********************************************************", ";END", ";**********************************************************", "F=1", "N X=0");
    return {
      code: `${output.join("\n")}\n`,
      model,
      detected: buildDetectedSummary(model, { ...options, thickness, cutDepth, drillDepth, maxPassDepth, camName: name }),
    };
  }

  function buildDetectedSummary(model, options) {
    const externalContours = model.contours.filter((contour) => contour.role === "external");
    let dx = 0;
    let dy = 0;
    if (model.stockBBox && externalContours.length) {
      dx = model.stockBBox[2] - model.stockBBox[0];
      dy = model.stockBBox[3] - model.stockBBox[1];
    }
    return {
      program: options.camName || "OUTPUT",
      header: {
        dx: fmt(dx),
        dy: fmt(dy),
        dz: fmt(options.thickness ?? 0),
        by: fmt(dy),
      },
      dowels: {
        count: model.dowels.length,
        radius: model.dowels.length ? fmt(model.dowels[0].radius) : "4",
        depth: fmt(options.drillDepth),
        tool: 2,
        speed: 3500,
      },
      contours: model.contours.map((contour) => {
        const [minX, minY, maxX, maxY] = contour.bbox;
        const isExternal = contour.role === "external";
        return {
          name: isExternal ? "zunanja kontura" : "notranji izrez",
          role: contour.role,
          width: fmt(maxX - minX),
          height: fmt(maxY - minY),
          segments: contour.segments.length,
          tool: 1,
          cutterD: isExternal ? 25 : 43,
          passes: depthPasses(options.cutDepth, options.maxPassDepth).map(fmt),
        };
      }),
    };
  }

  const api = {
    Point,
    Segment,
    Circle,
    Contour,
    fmt,
    parseDxfText,
    dowelCircles,
    classifyContours,
    depthPasses,
    generateXxlFromText,
    normalizeName,
    dateStamp,
  };

  root.DxfToXxl = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
