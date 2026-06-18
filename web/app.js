(() => {
  const form = document.getElementById("convert-form");
  const fileInput = document.getElementById("file");
  const dropzone = document.getElementById("dropzone");
  const fileName = document.getElementById("file-name");
  const fileMeta = document.getElementById("file-meta");
  const statusEl = document.getElementById("status");
  const codeEl = document.getElementById("code");
  const convertBtn = document.getElementById("convert");
  const clearBtn = document.getElementById("clear");
  const copyBtn = document.getElementById("copy");
  const downloadBtn = document.getElementById("download");
  const outputName = document.getElementById("output-name");
  const nameInput = document.getElementById("name");
  const summary = document.getElementById("summary");
  const summaryFile = document.getElementById("summary-file");
  const summaryGrid = document.getElementById("summary-grid");
  const summaryList = document.getElementById("summary-list");

  let outputFilename = "output.xxl";

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", isError);
  }

  function parseOptionalNumber(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      throw new Error(`Ni veljavna stevilka: ${value}`);
    }
    return parsed;
  }

  function clearSummary() {
    summary.hidden = true;
    summaryFile.textContent = "";
    summaryGrid.replaceChildren();
    summaryList.replaceChildren();
  }

  function addSummaryItem(label, value) {
    const item = document.createElement("div");
    item.className = "summary-item";
    const labelEl = document.createElement("div");
    labelEl.className = "summary-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "summary-value";
    valueEl.textContent = value;
    item.append(labelEl, valueEl);
    summaryGrid.append(item);
  }

  function renderSummary(detected) {
    clearSummary();
    summary.hidden = false;
    summaryFile.textContent = detected.program;
    addSummaryItem("Velikost", `DX=${detected.header.dx} DY=${detected.header.dy}`);
    addSummaryItem("Glava XXL", `DZ=${detected.header.dz} BY=${detected.header.by}`);
    addSummaryItem("Mozniki", `${detected.dowels.count} x Z=${detected.dowels.depth}`);
    addSummaryItem("Konture", `${detected.contours.length}`);

    const dowelLine = document.createElement("li");
    dowelLine.textContent = `Mozniki: ${detected.dowels.count} krogov radius ${detected.dowels.radius} mm -> B ukazi, T=${detected.dowels.tool}, S=${detected.dowels.speed}, Z=${detected.dowels.depth}`;
    summaryList.append(dowelLine);

    if (!detected.contours.length) {
      const line = document.createElement("li");
      line.textContent = "Konture: ni rezkalnih kontur za izpis.";
      summaryList.append(line);
      return;
    }

    detected.contours.forEach((contour, index) => {
      const line = document.createElement("li");
      line.textContent = `${index + 1}. ${contour.name}: ${contour.width} x ${contour.height} mm, ${contour.segments} segmentov -> T=${contour.tool}, D=${contour.cutterD}, Z prehodi ${contour.passes.join(", ")}`;
      summaryList.append(line);
    });
  }

  function updateFile(file) {
    convertBtn.disabled = !file;
    if (!file) {
      fileName.textContent = "Izberi DXF datoteko";
      fileMeta.textContent = ".dxf";
      return;
    }
    fileName.textContent = file.name;
    fileMeta.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
    if (!nameInput.value.trim()) {
      nameInput.value = DxfToXxl.normalizeName(file.name);
    }
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

  clearBtn.addEventListener("click", () => {
    form.reset();
    codeEl.value = "";
    outputFilename = "output.xxl";
    outputName.textContent = "Ni kode";
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    clearSummary();
    updateFile(null);
    setStatus("Pripravljen");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) {
      setStatus("Manjka DXF datoteka", true);
      return;
    }

    try {
      setStatus("Pretvarjam ...");
      convertBtn.disabled = true;
      const data = new FormData(form);
      const text = await file.text();
      const thickness = parseOptionalNumber(data.get("thickness"));
      const cutDepth = parseOptionalNumber(data.get("cutDepth"));
      const drillDepth = parseOptionalNumber(data.get("drillDepth"));
      const maxPassDepth = parseOptionalNumber(data.get("maxPassDepth")) ?? 10;
      const camName = String(data.get("name") || "").trim() || DxfToXxl.normalizeName(file.name);
      const result = DxfToXxl.generateXxlFromText(text, {
        thickness,
        cutDepth,
        drillDepth,
        maxPassDepth,
        camName,
      });

      codeEl.value = result.code;
      outputFilename = `${file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_") || "output"}.xxl`;
      outputName.textContent = `${outputFilename} | ${result.model.dowels.length} moznikov | ${result.model.contours.length} kontur`;
      renderSummary(result.detected);
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
      setStatus("Koda pripravljena");
    } catch (error) {
      codeEl.value = "";
      copyBtn.disabled = true;
      downloadBtn.disabled = true;
      outputName.textContent = "Ni kode";
      clearSummary();
      setStatus(error.message, true);
    } finally {
      convertBtn.disabled = !fileInput.files[0];
    }
  });

  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(codeEl.value);
    setStatus("Kopirano");
  });

  downloadBtn.addEventListener("click", () => {
    const blob = new Blob([codeEl.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = outputFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Prenos pripravljen");
  });
})();
