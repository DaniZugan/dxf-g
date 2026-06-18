#!/usr/bin/env python3
"""Local web UI for converting DXF files to XXL CNC code."""

from __future__ import annotations

import argparse
import html
import json
import tempfile
import warnings
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

warnings.filterwarnings("ignore", category=DeprecationWarning)
import cgi

from dxf_to_xxl import classify_contours, depth_passes, dowel_circles, fmt, generate_xxl, parse_dxf


APP_HTML = """<!doctype html>
<html lang="sl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DXF to XXL</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --ink: #16202a;
      --muted: #687382;
      --line: #d9e0e7;
      --accent: #16695d;
      --accent-strong: #0d4d45;
      --danger: #b42318;
      --code-bg: #101820;
      --code-ink: #eef6f4;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 28px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }

    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 720;
      letter-spacing: 0;
    }

    .status {
      min-height: 28px;
      padding: 5px 10px;
      border: 1px solid var(--line);
      color: var(--muted);
      background: #f9fbfc;
      font-size: 13px;
    }

    main {
      display: grid;
      grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
      gap: 0;
      min-height: 0;
    }

    aside {
      border-right: 1px solid var(--line);
      background: var(--panel);
      padding: 22px;
      overflow: auto;
    }

    .output {
      display: grid;
      grid-template-rows: auto auto 1fr;
      min-width: 0;
      min-height: 0;
      padding: 22px;
      gap: 14px;
    }

    .dropzone {
      display: grid;
      align-items: center;
      min-height: 138px;
      padding: 18px;
      border: 2px dashed #aab6c2;
      background: #fbfcfd;
      cursor: pointer;
    }

    .dropzone[data-active="true"] {
      border-color: var(--accent);
      background: #eef7f4;
    }

    .file-name {
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .file-meta {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
    }

    input[type="file"] {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      opacity: 0;
      pointer-events: none;
    }

    .fields {
      display: grid;
      gap: 14px;
      margin-top: 20px;
    }

    label {
      display: grid;
      gap: 7px;
      font-size: 13px;
      font-weight: 680;
    }

    input,
    select,
    textarea,
    button {
      font: inherit;
    }

    input,
    select {
      width: 100%;
      min-height: 42px;
      border: 1px solid #cbd5df;
      background: #ffffff;
      color: var(--ink);
      padding: 8px 10px;
      border-radius: 6px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .actions,
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .actions {
      margin-top: 20px;
    }

    button {
      min-height: 40px;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 8px 13px;
      cursor: pointer;
      font-weight: 720;
      background: #e8edf1;
      color: var(--ink);
    }

    button.primary {
      background: var(--accent);
      color: #ffffff;
    }

    button.primary:hover {
      background: var(--accent-strong);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .toolbar {
      justify-content: space-between;
      gap: 12px;
    }

    .filename-output {
      min-width: 0;
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .summary {
      display: grid;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      padding: 12px;
    }

    .summary[hidden] {
      display: none;
    }

    .summary-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-weight: 760;
      font-size: 14px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(110px, 1fr));
      gap: 8px;
    }

    .summary-item {
      border: 1px solid #e2e8ee;
      border-radius: 6px;
      padding: 8px;
      background: #fbfcfd;
      min-width: 0;
    }

    .summary-label {
      color: var(--muted);
      font-size: 12px;
    }

    .summary-value {
      margin-top: 3px;
      font-weight: 740;
      overflow-wrap: anywhere;
    }

    .summary-list {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .summary-list li {
      border-top: 1px solid var(--line);
      padding-top: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    textarea {
      width: 100%;
      min-height: 0;
      height: 100%;
      resize: none;
      border: 1px solid #243240;
      border-radius: 6px;
      background: var(--code-bg);
      color: var(--code-ink);
      padding: 14px;
      line-height: 1.45;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      white-space: pre;
    }

    .error {
      color: var(--danger);
      border-color: #f0b8b2;
      background: #fff7f6;
    }

    @media (max-width: 820px) {
      header {
        align-items: flex-start;
        flex-direction: column;
        padding: 16px;
      }

      main {
        grid-template-columns: 1fr;
      }

      aside {
        border-right: 0;
        border-bottom: 1px solid var(--line);
        padding: 16px;
      }

      .output {
        padding: 16px;
        min-height: 58vh;
      }

      .summary-grid {
        grid-template-columns: 1fr 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>DXF to XXL</h1>
      <div id="status" class="status">Pripravljen</div>
    </header>

    <main>
      <aside>
        <form id="convert-form">
          <label class="dropzone" id="dropzone">
            <input id="file" name="file" type="file" accept=".dxf">
            <span>
              <span class="file-name" id="file-name">Izberi DXF datoteko</span>
              <span class="file-meta" id="file-meta">.dxf</span>
            </span>
          </label>

          <div class="fields">
            <label>
              Ime programa
              <input id="name" name="name" type="text" placeholder="PART2">
            </label>

            <label>
              Debelina materiala
              <input name="thickness" type="number" min="0" step="0.1" placeholder="18">
            </label>

            <div class="row">
              <label>
                Koncni Z
                <input name="cut_depth" type="number" min="0" step="0.1" placeholder="20">
              </label>
              <label>
                Mozniki Z
                <input name="drill_depth" type="number" min="0" step="0.1" placeholder="18">
              </label>
            </div>

            <label>
              Max Z na prehod
              <select name="max_pass_depth">
                <option value="10">10 mm</option>
                <option value="0">En prehod</option>
                <option value="5">5 mm</option>
                <option value="8">8 mm</option>
              </select>
            </label>
          </div>

          <div class="actions">
            <button class="primary" id="convert" type="submit" disabled>Pretvori</button>
            <button id="clear" type="button">Pocisti</button>
          </div>
        </form>
      </aside>

      <section class="output">
        <div class="toolbar">
          <div class="filename-output" id="output-name">Ni kode</div>
          <div class="actions">
            <button id="copy" type="button" disabled>Kopiraj</button>
            <button id="download" type="button" disabled>Prenesi .xxl</button>
          </div>
        </div>
        <div class="summary" id="summary" hidden>
          <div class="summary-title">
            <span>Kaj je zaznano</span>
            <span id="summary-file"></span>
          </div>
          <div class="summary-grid" id="summary-grid"></div>
          <ul class="summary-list" id="summary-list"></ul>
        </div>
        <textarea id="code" spellcheck="false" readonly></textarea>
      </section>
    </main>
  </div>

  <script>
    const form = document.getElementById('convert-form');
    const fileInput = document.getElementById('file');
    const dropzone = document.getElementById('dropzone');
    const fileName = document.getElementById('file-name');
    const fileMeta = document.getElementById('file-meta');
    const statusEl = document.getElementById('status');
    const codeEl = document.getElementById('code');
    const convertBtn = document.getElementById('convert');
    const clearBtn = document.getElementById('clear');
    const copyBtn = document.getElementById('copy');
    const downloadBtn = document.getElementById('download');
    const outputName = document.getElementById('output-name');
    const nameInput = document.getElementById('name');
    const summary = document.getElementById('summary');
    const summaryFile = document.getElementById('summary-file');
    const summaryGrid = document.getElementById('summary-grid');
    const summaryList = document.getElementById('summary-list');

    let outputFilename = 'output.xxl';

    function setStatus(text, isError = false) {
      statusEl.textContent = text;
      statusEl.classList.toggle('error', isError);
    }

    function clearSummary() {
      summary.hidden = true;
      summaryFile.textContent = '';
      summaryGrid.replaceChildren();
      summaryList.replaceChildren();
    }

    function addSummaryItem(label, value) {
      const item = document.createElement('div');
      item.className = 'summary-item';
      const labelEl = document.createElement('div');
      labelEl.className = 'summary-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('div');
      valueEl.className = 'summary-value';
      valueEl.textContent = value;
      item.append(labelEl, valueEl);
      summaryGrid.append(item);
    }

    function renderSummary(detected) {
      clearSummary();
      summary.hidden = false;
      summaryFile.textContent = detected.program;
      addSummaryItem('Velikost', `DX=${detected.header.dx} DY=${detected.header.dy}`);
      addSummaryItem('Glava XXL', `DZ=${detected.header.dz} BY=${detected.header.by}`);
      addSummaryItem('Mozniki', `${detected.dowels.count} x Z=${detected.dowels.depth}`);
      addSummaryItem('Konture', `${detected.contours.length}`);

      const dowelLine = document.createElement('li');
      dowelLine.textContent = `Mozniki: ${detected.dowels.count} krogov radius ${detected.dowels.radius} mm -> B ukazi, T=${detected.dowels.tool}, S=${detected.dowels.speed}, Z=${detected.dowels.depth}`;
      summaryList.append(dowelLine);

      if (!detected.contours.length) {
        const line = document.createElement('li');
        line.textContent = 'Konture: ni rezkalnih kontur za izpis.';
        summaryList.append(line);
        return;
      }

      detected.contours.forEach((contour, index) => {
        const line = document.createElement('li');
        line.textContent = `${index + 1}. ${contour.name}: ${contour.width} x ${contour.height} mm, ${contour.segments} segmentov -> T=${contour.tool}, D=${contour.cutter_d}, Z prehodi ${contour.passes.join(', ')}`;
        summaryList.append(line);
      });
    }

    function updateFile(file) {
      convertBtn.disabled = !file;
      if (!file) {
        fileName.textContent = 'Izberi DXF datoteko';
        fileMeta.textContent = '.dxf';
        return;
      }
      fileName.textContent = file.name;
      fileMeta.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      if (!nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\\.[^.]+$/, '').toUpperCase();
      }
    }

    fileInput.addEventListener('change', () => updateFile(fileInput.files[0]));

    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.dataset.active = 'true';
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.dataset.active = 'false';
    });

    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.dataset.active = 'false';
      if (event.dataTransfer.files.length) {
        fileInput.files = event.dataTransfer.files;
        updateFile(fileInput.files[0]);
      }
    });

    clearBtn.addEventListener('click', () => {
      form.reset();
      codeEl.value = '';
      outputFilename = 'output.xxl';
      outputName.textContent = 'Ni kode';
      copyBtn.disabled = true;
      downloadBtn.disabled = true;
      clearSummary();
      updateFile(null);
      setStatus('Pripravljen');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = fileInput.files[0];
      if (!file) {
        setStatus('Manjka DXF datoteka', true);
        return;
      }

      setStatus('Pretvarjam ...');
      convertBtn.disabled = true;
      const data = new FormData(form);

      try {
        const response = await fetch('/convert', { method: 'POST', body: data });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Napaka pri pretvorbi');
        }
        codeEl.value = payload.code;
        outputFilename = payload.filename;
        outputName.textContent = `${payload.filename} | ${payload.stats.dowels} moznikov | ${payload.stats.contours} kontur`;
        renderSummary(payload.detected);
        copyBtn.disabled = false;
        downloadBtn.disabled = false;
        setStatus('Koda pripravljena');
      } catch (error) {
        codeEl.value = '';
        copyBtn.disabled = true;
        downloadBtn.disabled = true;
        outputName.textContent = 'Ni kode';
        clearSummary();
        setStatus(error.message, true);
      } finally {
        convertBtn.disabled = !fileInput.files[0];
      }
    });

    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(codeEl.value);
      setStatus('Kopirano');
    });

    downloadBtn.addEventListener('click', () => {
      const blob = new Blob([codeEl.value], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outputFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus('Prenos pripravljen');
    });
  </script>
</body>
</html>
"""


class AppHandler(BaseHTTPRequestHandler):
    server_version = "DxfToXxlUI/1.0"

    def do_GET(self) -> None:
        if self.path in {"/", "/index.html"}:
            self.send_bytes(APP_HTML.encode("utf-8"), "text/html; charset=utf-8")
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:
        if self.path != "/convert":
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        try:
            payload = self.convert_request()
            self.send_json(payload)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def convert_request(self) -> dict[str, Any]:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        file_item = form["file"] if "file" in form else None
        if file_item is None or not getattr(file_item, "filename", ""):
            raise ValueError("Manjka DXF datoteka")

        original_name = Path(file_item.filename).name
        stem = Path(original_name).stem
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".dxf") as tmp:
                data = file_item.file.read()
                if isinstance(data, str):
                    data = data.encode("utf-8")
                tmp.write(data)
                temp_path = Path(tmp.name)

            thickness = parse_optional_float(form, "thickness")
            cut_depth = parse_optional_float(form, "cut_depth")
            drill_depth = parse_optional_float(form, "drill_depth")
            max_pass_depth = parse_optional_float(form, "max_pass_depth", default=10.0) or 0.0
            program_name = parse_optional_text(form, "name") or stem.upper()

            circles, segments = parse_dxf(temp_path)
            dowels = dowel_circles(circles)
            stock_bbox, contours = classify_contours(dowels, segments)
            code = generate_xxl(
                temp_path,
                thickness=thickness,
                cut_depth=cut_depth,
                drill_depth=drill_depth,
                max_pass_depth=max_pass_depth,
                cam_name=program_name,
            )
            return {
                "filename": f"{safe_filename(stem)}.xxl",
                "code": code,
                "detected": build_detected_summary(
                    program_name=program_name,
                    stock_bbox=stock_bbox,
                    contours=contours,
                    dowels=dowels,
                    thickness=thickness,
                    cut_depth=cut_depth,
                    drill_depth=drill_depth,
                    max_pass_depth=max_pass_depth,
                ),
                "stats": {
                    "circles": len(circles),
                    "dowels": len(dowels),
                    "segments": len(segments),
                    "contours": len(contours),
                },
            }
        finally:
            if temp_path is not None:
                try:
                    temp_path.unlink()
                except FileNotFoundError:
                    pass

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, body: bytes, content_type: str) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {html.escape(format % args)}")


def parse_optional_text(form: cgi.FieldStorage, key: str) -> str | None:
    if key not in form:
        return None
    value = form.getfirst(key, "").strip()
    return value or None


def parse_optional_float(form: cgi.FieldStorage, key: str, default: float | None = None) -> float | None:
    value = form.getfirst(key, "").strip() if key in form else ""
    if not value:
        return default
    return float(value.replace(",", "."))


def safe_filename(stem: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in stem.strip())
    return cleaned or "output"


def build_detected_summary(
    *,
    program_name: str,
    stock_bbox: tuple[float, float, float, float] | None,
    contours: list[Any],
    dowels: list[Any],
    thickness: float | None,
    cut_depth: float | None,
    drill_depth: float | None,
    max_pass_depth: float,
) -> dict[str, Any]:
    external_contours = [contour for contour in contours if contour.role == "external"]

    dx = dy = 0.0
    if stock_bbox is not None and external_contours:
        min_x, min_y, max_x, max_y = stock_bbox
        dx = max_x - min_x
        dy = max_y - min_y

    final_cut_depth = cut_depth if cut_depth is not None else (thickness + 2.0 if thickness is not None else 20.0)
    final_drill_depth = drill_depth if drill_depth is not None else (thickness if thickness is not None else 10.0)

    contour_rows: list[dict[str, Any]] = []
    for contour in contours:
        min_x, min_y, max_x, max_y = contour.bbox
        is_external = contour.role == "external"
        contour_rows.append(
            {
                "name": "zunanja kontura" if is_external else "notranji izrez",
                "role": contour.role,
                "width": fmt(max_x - min_x),
                "height": fmt(max_y - min_y),
                "segments": len(contour.segments),
                "tool": 1,
                "cutter_d": 25 if is_external else 43,
                "passes": [fmt(value) for value in depth_passes(final_cut_depth, max_pass_depth)],
            }
        )

    return {
        "program": program_name,
        "header": {
            "dx": fmt(dx),
            "dy": fmt(dy),
            "dz": fmt(thickness or 0.0),
            "by": fmt(dy),
        },
        "dowels": {
            "count": len(dowels),
            "radius": fmt(dowels[0].radius) if dowels else "4",
            "depth": fmt(final_drill_depth),
            "tool": 2,
            "speed": 3500,
        },
        "contours": contour_rows,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local DXF to XXL web UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"DXF to XXL UI: http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
