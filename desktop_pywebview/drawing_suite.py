"""Live Univer drawing registration and native WebView image decoding checks."""

import json
import os
from pathlib import Path
import time

from .native_suite import NativeSuiteAPI, NativeUI
from .smoke import evaluate_async
from .native_snapshot import capture_if_enabled


class NativeDrawingAPI(NativeSuiteAPI):
    def __init__(self, recovery_dir):
        super().__init__(recovery_dir)
        self._math_type_results = []

    def Ready(self):
        super().Ready()
        self._window.evaluate_js("""(() => {
          window.__nativeDrawingIssues = [];
          window.__nativeDrawingCanvas = () => Array.from(document.querySelectorAll('canvas'))
            .filter(canvas => { const rect = canvas.getBoundingClientRect();
              return rect.width > 100 && rect.height > 100 && rect.left >= 0 && rect.top >= 0
                && rect.left < innerWidth && rect.top < innerHeight })
            .sort((a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
              return y.width * y.height - x.width * x.height })[0];
          const relevant = /OfficeMath|MathType|LegacyEquation|Equation\\.3|Unable to render workbook image|speech-worker|\\bSRE\\b|NaN|Infinity/i;
          for (const level of ['warn', 'error']) {
            const original = console[level].bind(console);
            console[level] = (...values) => {
              const text = values.map(String).join(' ');
              if (level === 'error' || relevant.test(text)) window.__nativeDrawingIssues.push(text);
              original(...values);
            };
          }
          window.addEventListener('error', event => {
            if (relevant.test(event.message || '')) window.__nativeDrawingIssues.push(event.message);
          });
          window.__nativeDrawingRequests = [];
          new PerformanceObserver(list => window.__nativeDrawingRequests.push(...list.getEntries().map(entry => entry.name)))
            .observe({type: 'resource', buffered: true});
        })()""")

    def ConvertMathTypeOLE(self, data):
        result = super().ConvertMathTypeOLE(data)
        self._math_type_results.append(result)
        return result

    def ReadFile(self, path):
        result = super().ReadFile(path)
        print(f'Native drawing workbook read: {Path(path).name}: {len(result)} base64 characters', flush=True)
        return result


DECODE_DRAWINGS = """(async () => {
  const results = [];
  for (const [sheet, drawings] of Object.entries(window.__excelBlockParserImageState())) {
    for (const drawing of drawings) {
      const source = drawing.source;
      const mime = source.slice(5, source.indexOf(';'));
      if (mime === 'image/svg+xml') {
        const svg = atob(source.slice(source.indexOf(',') + 1));
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        if (document.querySelector('parsererror') || /NaN|Infinity/.test(svg)) throw new Error('Invalid registered SVG geometry/XML');
        const root = document.documentElement;
        const box = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
        if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw new Error('Invalid registered SVG viewBox');
      }
      const image = await new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => reject(new Error('Native drawing image decode timed out')), 10000);
        image.onload = () => { clearTimeout(timer); resolve(image) };
        image.onerror = () => { clearTimeout(timer); reject(new Error('Native drawing image decode failed')) };
        image.src = source;
      });
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('Decoded drawing has no dimensions');
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(800, image.naturalWidth);
      canvas.height = Math.min(800, image.naturalHeight);
      const context = canvas.getContext('2d');
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 240 || pixels[index + 1] < 240 || pixels[index + 2] < 240) ink++;
      }
      if (ink === 0) throw new Error('Registered drawing decodes to a blank image');
      results.push({sheet, mime, width: image.naturalWidth, height: image.naturalHeight, ink});
    }
  }
  return results;
})()"""


def run(window, api, directory):
    ui = NativeUI(window)
    ui.wait('Boolean(window.__excelBlockParserImageState) && Boolean(window.pywebview?.runtimeInfo)')
    root = Path(__file__).resolve().parents[1]
    sources = [
        ('embedded image', root / '.tmp/pywebview-drawing-fixtures/image.xlsx', 'Image', 'image/png'),
        ('modern Office Math textbox', root / 'tests-native/fixtures/office-math-textbox.xlsx', 'Sheet1', 'image/svg+xml'),
        ('MathType native conversion', root / 'tests-native/fixtures/mathtype-equation-dsmt4.xlsx', 'Sheet1', 'image/svg+xml'),
    ]
    if os.environ.get('PYWEBVIEW_NATIVE_SNAPSHOTS'):
        sources.append(('embedded image after project transitions',
                        root / '.tmp/pywebview-drawing-fixtures/image.xlsx', 'Image', 'image/png'))
    for index, (name, source, sheet, mime) in enumerate(sources):
        started = time.monotonic()
        source = source.resolve(strict=True)
        project = dict(version=3, exportedAt='2026-10-12T00:00:00.000Z', project=dict(
            id=f'drawing-{index}', name=name, activeWorkbookId='drawing', activeBlockId='', activeRegionId=None,
            focusMode='always-editable', blocks=[], regions=[],
            workbooks=[dict(id='drawing', name=source.name, sourcePath=str(source), sheetNames=[sheet], activeSheetName=sheet)],
            workbookLoadSettings=dict(parseImages=True, parseOfficeMath=True, restoreExcelActiveCell=False,
                                      performanceLogging=False, experimentalStagedLoading=False)), data={}, blockResults=[])
        path = Path(directory) / f'drawing-{index}.json'
        path.write_text(json.dumps(project), encoding='utf-8')
        api._select('OPEN', path)
        ui.button('Open Project')
        if index:
            ui.choose('Open another project?', 2)
        try:
            # Hidden WKWebViews throttle the asynchronous ZIP decompression
            # used twice by import and rendering. Keep application timeouts intact.
            ui.wait(f"(window.__excelBlockParserImageState()?.[{json.dumps(sheet)}] || []).length === 1", timeout=90)
        except RuntimeError:
            print(f'Native drawing issues: {ui.read("window.__nativeDrawingIssues")}; conversion results: {api._math_type_results}', flush=True)
            raise
        decoded = evaluate_async(window, DECODE_DRAWINGS)
        expected = [drawing for drawing in decoded if drawing['sheet'] == sheet]
        if len(expected) != 1 or expected[0]['mime'] != mime:
            raise RuntimeError(f'Unexpected live native drawing for {name}: {decoded}')
        if index == 2 and (not api._math_type_results or not all(result.get('supported') for result in api._math_type_results)):
            raise RuntimeError('MathType drawing did not use a supported native conversion')
        print(f'PASS pywebview drawing: {name}: {json.dumps(decoded)} ({time.monotonic() - started:.2f}s hidden load)', flush=True)
        if os.environ.get('PYWEBVIEW_NATIVE_SNAPSHOTS'):
            ui.wait("!document.querySelector('.ant-spin-spinning') && !Array.from(document.querySelectorAll('.ant-modal-mask')).some(mask => getComputedStyle(mask).display !== 'none')")
            print(f'Native drawing scene before snapshot: {ui.read("window.__excelBlockParserDrawingRenderState?.()")}', flush=True)
            if index == 2:
                # This fixture's formula is anchored at K13, outside the first
                # horizontal viewport. Use the existing canvas wheel handler.
                ui.read("""(() => {
                  const canvas = window.__nativeDrawingCanvas();
                  const rect = canvas.getBoundingClientRect();
                  canvas.dispatchEvent(new WheelEvent('wheel', {deltaX: 600,
                    clientX: rect.left + 200, clientY: rect.top + 200, bubbles: true}));
                })()""")
        def ready_to_capture():
            ui.wait("window.__excelBlockParserDrawingRenderState?.().images.some(image => image.visible && image.complete && image.naturalWidth > 0 && image.width > 0 && image.height > 0)")
            evaluate_async(window, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))")
        logged_bounds = []
        def validate_drawing(path):
            from PIL import Image
            bounds = ui.read("""(() => {
              const state = window.__excelBlockParserDrawingRenderState();
              const image = state.images[0];
              const canvas = window.__nativeDrawingCanvas().getBoundingClientRect();
              return {left: canvas.left + image.left - state.scrollX, top: canvas.top + image.top - state.scrollY,
                width: image.width, height: image.height, viewportWidth: innerWidth};
            })()""")
            if not logged_bounds:
                print(f'Native drawing validation bounds: {bounds}', flush=True)
                logged_bounds.append(bounds)
            with Image.open(path) as screenshot:
                scale = screenshot.width / bounds['viewportWidth']
                box = tuple(round(value * scale) for value in (
                    bounds['left'], bounds['top'], bounds['left'] + bounds['width'], bounds['top'] + bounds['height']))
                crop = screenshot.convert('RGB').crop(box)
                if mime == 'image/png':
                    ink = sum(red < 80 and 100 < green < 170 and blue > 200 for red, green, blue in crop.getdata())
                else:
                    # Ignore the MathType frame and light worksheet grid lines.
                    margin = round(2 * scale)
                    crop = crop.crop((margin, margin, crop.width - margin, crop.height - margin))
                    ink = sum(max(pixel) < 160 for pixel in crop.getdata())
                return ink >= 25
        capture_if_enabled(window, f'drawing-{index}', ready=ready_to_capture,
                           validate=validate_drawing)
        if os.environ.get('PYWEBVIEW_NATIVE_SNAPSHOTS'):
            print(f'Native drawing scene after snapshot: {ui.read("window.__excelBlockParserDrawingRenderState?.()")}', flush=True)
    issues = ui.read('window.__nativeDrawingIssues')
    requests = ui.read('window.__nativeDrawingRequests')
    speech_requests = [url for url in requests if any(part in url.lower() for part in ('speech-worker', 'speech-rule-engine', '/sre/'))]
    if issues or speech_requests:
        raise RuntimeError(f'Native drawing issues: {issues}; speech requests: {speech_requests}')
    print('PASS pywebview drawing: no formula warnings, invalid geometry or speech-service resource requests', flush=True)
    print(f'pywebview native drawing suite: {len(sources) + 1} scenarios passed', flush=True)
