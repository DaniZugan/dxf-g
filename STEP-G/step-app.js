const fileInput = document.getElementById("file");
const dropzone = document.getElementById("dropzone");
const fileName = document.getElementById("file-name");
const fileMeta = document.getElementById("file-meta");
const analyzeButton = document.getElementById("analyze");
const clearButton = document.getElementById("clear");
const statusEl = document.getElementById("status");
const dimensionsEl = document.getElementById("dimensions");
const dimensionGrid = document.getElementById("dimension-grid");
const facesEl = document.getElementById("faces");
const faceList = document.getElementById("face-list");
const rawEl = document.getElementById("raw");
const rawOutput = document.getElementById("raw-output");
const faceToleranceInput = document.getElementById("face-tolerance");
const minRadiusInput = document.getElementById("min-radius");
const maxRadiusInput = document.getElementById("max-radius");

let currentFile = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function fmt(value) {
  if (!Number.isFinite(value)) return "-";
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  if (Math.abs(normalized - Math.round(normalized)) < 0.0005) return String(Math.round(normalized));
  return normalized.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function parseNumberInput(input, fallback) {
  const value = Number.parseFloat(input.value.replace(",", "."));
  return Number.isFinite(value) ? value : fallback;
}

function updateFile(file) {
  currentFile = file || null;
  analyzeButton.disabled = !currentFile;
  if (!currentFile) {
    fileName.textContent = "Izberi STEP/STP datoteko";
    fileMeta.textContent = "Datoteka ostane v browserju.";
    return;
  }
  fileName.textContent = currentFile.name;
  fileMeta.textContent = `${Math.max(1, Math.round(currentFile.size / 1024))} KB`;
}

function clearResults() {
  dimensionsEl.hidden = true;
  facesEl.hidden = true;
  rawEl.hidden = true;
  dimensionGrid.replaceChildren();
  faceList.replaceChildren();
  rawOutput.textContent = "";
}

fileInput.addEventListener("change", () => updateFile(fileInput.files[0]));

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.dataset.active = "true";
});

dropzone.addEventListener("dragleave", () => {
  dropzone.dataset.active = "false";
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.dataset.active = "false";
  if (event.dataTransfer.files.length) {
    fileInput.files = event.dataTransfer.files;
    updateFile(fileInput.files[0]);
  }
});

clearButton.addEventListener("click", () => {
  fileInput.value = "";
  updateFile(null);
  clearResults();
  setStatus("Pripravljen");
});

analyzeButton.addEventListener("click", async () => {
  if (!currentFile) return;
  try {
    setStatus("Analiziram STEP ...");
    clearResults();
    const text = await currentFile.text();
    const model = analyzeStep(text, {
      faceTolerance: parseNumberInput(faceToleranceInput, 0.25),
      minRadius: parseNumberInput(minRadiusInput, 1),
      maxRadius: parseNumberInput(maxRadiusInput, 25),
    });
    renderAnalysis(model);
    setStatus("Analiza pripravljena");
  } catch (error) {
    setStatus(error.message, true);
  }
});

function analyzeStep(text, options) {
  const records = parseStepRecords(text);
  const points = parseCartesianPoints(records);
  const directions = parseDirections(records);
  const axisPlacements = parseAxisPlacements(records, points, directions);
  const cylinders = parseCylinders(records, axisPlacements)
    .filter((cylinder) => cylinder.radius >= options.minRadius && cylinder.radius <= options.maxRadius);

  if (points.length < 2) throw new Error("V STEP datoteki nisem nasel dovolj CARTESIAN_POINT koordinat.");

  const bbox = boundingBox(points.map((point) => point.coords));
  const axisMap = buildAxisMap(bbox);
  const normalizedCylinders = cylinders.map((cylinder) => normalizeCylinder(cylinder, axisMap));
  const faces = buildFaces(axisMap);
  assignHolesToFaces(faces, normalizedCylinders, options.faceTolerance);

  return {
    records: records.size,
    pointCount: points.length,
    cylinderCount: cylinders.length,
    bbox,
    axisMap,
    dimensions: {
      dx: axisMap.cnc.X.length,
      dy: axisMap.cnc.Y.length,
      dz: axisMap.cnc.Z.length,
      bx: 0,
      by: axisMap.cnc.Y.length,
      bz: 0,
    },
    faces,
    unassignedHoles: normalizedCylinders.filter((hole) => !hole.faceId),
  };
}

function parseStepRecords(text) {
  const records = new Map();
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const recordRegex = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\);/g;
  let match;
  while ((match = recordRegex.exec(withoutComments)) !== null) {
    records.set(`#${match[1]}`, {
      id: `#${match[1]}`,
      type: match[2],
      args: match[3].replace(/\s+/g, " ").trim(),
    });
  }
  return records;
}

function parseCartesianPoints(records) {
  const points = [];
  for (const record of records.values()) {
    if (record.type !== "CARTESIAN_POINT") continue;
    const coords = parseTupleNumbers(record.args);
    if (coords.length >= 3) points.push({ id: record.id, coords: coords.slice(-3) });
  }
  return points;
}

function parseDirections(records) {
  const directions = new Map();
  for (const record of records.values()) {
    if (record.type !== "DIRECTION") continue;
    const coords = parseTupleNumbers(record.args);
    if (coords.length >= 3) directions.set(record.id, normalizeVector(coords.slice(-3)));
  }
  return directions;
}

function parseAxisPlacements(records, points, directions) {
  const pointMap = new Map(points.map((point) => [point.id, point.coords]));
  const placements = new Map();
  for (const record of records.values()) {
    if (record.type !== "AXIS2_PLACEMENT_3D") continue;
    const refs = [...record.args.matchAll(/#\d+/g)].map((match) => match[0]);
    const location = pointMap.get(refs[0]);
    const axis = directions.get(refs[1]) || [0, 0, 1];
    if (location) placements.set(record.id, { location, axis });
  }
  return placements;
}

function parseCylinders(records, axisPlacements) {
  const cylinders = [];
  for (const record of records.values()) {
    if (record.type !== "CYLINDRICAL_SURFACE") continue;
    const refs = [...record.args.matchAll(/#\d+/g)].map((match) => match[0]);
    const placement = refs.map((ref) => axisPlacements.get(ref)).find(Boolean);
    const numbers = parseTupleNumbers(record.args);
    const radius = numbers[numbers.length - 1];
    if (placement && Number.isFinite(radius)) {
      cylinders.push({
        id: record.id,
        radius,
        diameter: radius * 2,
        location: placement.location,
        axis: placement.axis,
      });
    }
  }
  return uniqueCylinders(cylinders);
}

function parseTupleNumbers(text) {
  const matches = text.match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/g);
  return matches ? matches.map(Number) : [];
}

function normalizeVector(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return vector.map((value) => value / length);
}

function boundingBox(coordsList) {
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const coords of coordsList) {
    for (let i = 0; i < 3; i += 1) {
      mins[i] = Math.min(mins[i], coords[i]);
      maxs[i] = Math.max(maxs[i], coords[i]);
    }
  }
  return { min: mins, max: maxs, lengths: maxs.map((value, index) => value - mins[index]) };
}

function buildAxisMap(bbox) {
  const axes = ["STEP X", "STEP Y", "STEP Z"].map((name, index) => ({
    name,
    index,
    min: bbox.min[index],
    max: bbox.max[index],
    length: bbox.lengths[index],
  }));
  const sorted = [...axes].sort((a, b) => b.length - a.length);
  return { axes, cnc: { X: sorted[0], Y: sorted[1], Z: sorted[2] } };
}

function normalizeCylinder(cylinder, axisMap) {
  const cncLocation = {
    X: cylinder.location[axisMap.cnc.X.index] - axisMap.cnc.X.min,
    Y: cylinder.location[axisMap.cnc.Y.index] - axisMap.cnc.Y.min,
    Z: axisMap.cnc.Z.max - cylinder.location[axisMap.cnc.Z.index],
  };
  const cncAxis = {
    X: cylinder.axis[axisMap.cnc.X.index],
    Y: cylinder.axis[axisMap.cnc.Y.index],
    Z: cylinder.axis[axisMap.cnc.Z.index],
  };
  return { ...cylinder, cncLocation, cncAxis, mainAxis: dominantAxis(cncAxis), faceId: null };
}

function dominantAxis(vector) {
  const entries = Object.entries(vector).map(([axis, value]) => ({ axis, value: Math.abs(value) }));
  entries.sort((a, b) => b.value - a.value);
  return entries[0].axis;
}

function buildFaces(axisMap) {
  return [
    makeFace(1, "zgornja ploskev", "Z", "max", axisMap),
    makeFace(2, "spodnja ploskev", "Z", "min", axisMap),
    makeFace(3, "leva ploskev", "X", "min", axisMap),
    makeFace(4, "desna ploskev", "X", "max", axisMap),
    makeFace(5, "sprednja ploskev", "Y", "min", axisMap),
    makeFace(6, "zadnja ploskev", "Y", "max", axisMap),
  ];
}

function makeFace(id, label, cncAxis, side, axisMap) {
  const mapped = axisMap.cnc[cncAxis];
  return {
    id,
    label,
    cncAxis,
    side,
    stepAxis: mapped.name,
    position: side === "min" ? mapped.min : mapped.max,
    holes: [],
  };
}

function assignHolesToFaces(faces, holes, tolerance) {
  for (const hole of holes) {
    const candidates = faces
      .filter((face) => face.cncAxis === hole.mainAxis)
      .map((face) => ({ face, distance: faceDistance(face, hole) }))
      .sort((a, b) => a.distance - b.distance);
    const best = candidates[0];
    if (best && best.distance <= tolerance) {
      hole.faceId = best.face.id;
      best.face.holes.push(hole);
    }
  }
}

function faceDistance(face, hole) {
  const index = face.stepAxis === "STEP X" ? 0 : face.stepAxis === "STEP Y" ? 1 : 2;
  return Math.abs(hole.location[index] - face.position);
}

function uniqueCylinders(cylinders) {
  const seen = new Set();
  const result = [];
  for (const cylinder of cylinders) {
    const key = [
      Math.round(cylinder.radius * 1000),
      ...cylinder.location.map((value) => Math.round(value * 1000)),
      ...cylinder.axis.map((value) => Math.round(Math.abs(value) * 1000)),
    ].join(":");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cylinder);
    }
  }
  return result;
}

function renderAnalysis(model) {
  renderDimensions(model);
  renderFaces(model);
  rawOutput.textContent = [
    `STEP zapisov: ${model.records}`,
    `Tock: ${model.pointCount}`,
    `Cilindricnih povrsin kandidatov: ${model.cylinderCount}`,
    `Neuvrscenih lukenj: ${model.unassignedHoles.length}`,
  ].join("\n");
  rawEl.hidden = false;
}

function renderDimensions(model) {
  dimensionGrid.replaceChildren();
  addMetric("DX", `${fmt(model.dimensions.dx)} mm`);
  addMetric("DY", `${fmt(model.dimensions.dy)} mm`);
  addMetric("DZ", `${fmt(model.dimensions.dz)} mm`);
  addMetric("XXL glava", `BX=0 BY=${fmt(model.dimensions.by)} BZ=0`);
  addMetric("STEP os za X", `${model.axisMap.cnc.X.name} (${fmt(model.axisMap.cnc.X.length)} mm)`);
  addMetric("STEP os za Y", `${model.axisMap.cnc.Y.name} (${fmt(model.axisMap.cnc.Y.length)} mm)`);
  addMetric("STEP os za Z", `${model.axisMap.cnc.Z.name} (${fmt(model.axisMap.cnc.Z.length)} mm)`);
  addMetric("Pravilo", "najdaljsa X, druga Y, najkrajsa Z");
  dimensionsEl.hidden = false;
}

function addMetric(label, value) {
  const item = document.createElement("div");
  item.className = "metric";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  dimensionGrid.append(item);
}

function renderFaces(model) {
  faceList.replaceChildren();
  for (const face of model.faces) {
    const card = document.createElement("article");
    card.className = "face-card";
    const title = document.createElement("div");
    title.className = "face-title";
    title.innerHTML = `<span>Ploskev ${face.id}: ${face.label}</span><span>${face.holes.length} lukenj</span>`;
    const note = document.createElement("div");
    note.className = "face-note";
    note.textContent = `${face.stepAxis}, stran ${face.side}, pozicija ${fmt(face.position)}. Luknje so kandidati iz CYLINDRICAL_SURFACE zapisov.`;
    card.append(title, note);
    if (face.holes.length) card.append(makeHoleTable(face.holes));
    faceList.append(card);
  }

  if (model.unassignedHoles.length) {
    const card = document.createElement("article");
    card.className = "face-card";
    const title = document.createElement("div");
    title.className = "face-title warning";
    title.textContent = `Neuvrscene cilindricne povrsine: ${model.unassignedHoles.length}`;
    const note = document.createElement("div");
    note.className = "face-note";
    note.textContent = "To so lahko notranji cilindri, zaokrozitve ali luknje, ki niso dovolj blizu zunanje ploskve.";
    card.append(title, note, makeHoleTable(model.unassignedHoles));
    faceList.append(card);
  }

  facesEl.hidden = false;
}

function makeHoleTable(holes) {
  const table = document.createElement("table");
  table.className = "hole-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Premer</th>
        <th>CNC X</th>
        <th>CNC Y</th>
        <th>CNC Z</th>
        <th>Os</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  for (const hole of holes) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${hole.id}</td>
      <td>${fmt(hole.diameter)}</td>
      <td>${fmt(hole.cncLocation.X)}</td>
      <td>${fmt(hole.cncLocation.Y)}</td>
      <td>${fmt(hole.cncLocation.Z)}</td>
      <td>${hole.mainAxis}</td>
    `;
    tbody.append(row);
  }
  return table;
}
