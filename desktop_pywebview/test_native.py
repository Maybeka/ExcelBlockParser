import base64
from concurrent.futures import ThreadPoolExecutor
import json
import io
from pathlib import Path
import threading
import sys
import time
import tempfile
import http.server
import unittest

from desktop_pywebview.helper import NativeHelper
from desktop_pywebview.host import DesktopAPI


ROOT = Path(__file__).resolve().parents[1]


def project(source, *files):
    return {"entryPath": "main.py", "files": [{"path": "main.py", "source": source}, *files]}


class NativeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.helper = NativeHelper()
        self.addCleanup(self.helper.close)

    def run_script(self, source, context="{}", *files):
        return self.helper.request("run", project=project(source, *files), context=context)

    def test_multi_file_context_output_and_generated_files(self):
        result = self.run_script(
            "from support import double\ndef process(context):\n print('processing')\n return {'value': double(context['data']['value']), 'artifacts': [{'path':'rtl/demo.sv', 'content':'module demo; endmodule'}]}",
            '{"data":{"value":7},"blockResults":[],"regionResults":[]}',
            {"path": "support.py", "source": "def double(value): return value * 2"},
        )
        self.assertTrue(result["ok"], result)
        self.assertIn("processing", result["stdout"])
        self.assertEqual(json.loads(result["resultJson"])["value"], 14)
        self.assertEqual(json.loads(result["resultJson"])["artifacts"][0]["path"], "rtl/demo.sv")

    def test_runtime_errors_and_non_json_results(self):
        for source, text in [
            ("def process(context): raise ValueError('example')", "example"),
            ("def process(context): return {1, 2}", "JSON serializable"),
            ("value = 1", "process(context)"),
        ]:
            with self.subTest(source=source):
                result = self.run_script(source)
                self.assertFalse(result["ok"])
                self.assertIn(text, result["error"])

    def test_path_and_context_validation(self):
        result = self.helper.request("run", project={"entryPath": "../main.py", "files": []}, context="{}")
        self.assertFalse(result["ok"])
        self.assertTrue(result["hostError"])
        self.assertFalse(self.run_script("def process(context): return {}", "invalid")["ok"])

    def test_trusted_script_can_read_write_host_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'trusted.txt')
            path.write_text('input', encoding='utf-8')
            result = self.run_script("from pathlib import Path\ndef process(context):\n p=Path(context['path'])\n value=p.read_text()\n p.write_text('output')\n return value", json.dumps({'path': str(path)}))
            self.assertTrue(result['ok'], result)
            self.assertEqual(json.loads(result['resultJson']), 'input')
            self.assertEqual(path.read_text(), 'output')

    def test_trusted_script_network_and_standard_library(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'network-ok')
            def log_message(self, *_):
                pass
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                result = self.run_script("import urllib.request, decimal, statistics, csv, ssl\ndef process(context):\n return {'http': urllib.request.urlopen(context['url'], timeout=5).read().decode(), 'sum': str(decimal.Decimal('0.1')+decimal.Decimal('0.2')), 'mean': statistics.mean([2,4])}", json.dumps({'url': f'http://127.0.0.1:{server.server_port}/'}))
                self.assertTrue(result['ok'], result)
                self.assertEqual(json.loads(result['resultJson']), {'http': 'network-ok', 'sum': '0.3', 'mean': 3})
            finally:
                server.shutdown()
                thread.join(5)

    def test_output_overflow_and_abrupt_exit_do_not_poison_next_run(self):
        result = self.run_script("def process(context):\n print('x' * (1024 * 1024 + 1))\n return {}")
        self.assertFalse(result['ok'])
        self.assertIn('1 MB', result['hostError'])
        result = self.run_script('import os\ndef process(context): os._exit(7)')
        self.assertFalse(result['ok'])
        self.assertTrue(result['hostError'])
        self.assertTrue(self.run_script('def process(context): return {}')['ok'])

    def test_cancel_stops_trusted_script_descendants(self):
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=1) as executor:
            ready, output = Path(directory, 'ready'), Path(directory, 'late-output')
            child = "from pathlib import Path; import time; Path(" + repr(str(ready)) + ").write_text('ready'); time.sleep(1); Path(" + repr(str(output)) + ").write_text('not stopped')"
            source = "import subprocess\ndef process(context):\n subprocess.Popen([context['python'], '-c', context['child']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n while True: pass"
            running = executor.submit(self.run_script, source, json.dumps({'python': sys.executable, 'child': child}))
            try:
                deadline = time.monotonic() + 10
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), 'Script descendant did not start')
                self.assertTrue(self.helper.request('cancel'))
                self.assertIn('KeyboardInterrupt', running.result(timeout=10)['error'])
                time.sleep(1.1)
                self.assertFalse(output.exists(), 'Cancelled descendant continued executing')
            finally:
                self.helper.request('cancel')

    def test_each_run_has_fresh_globals_and_threaded_output_is_complete(self):
        source = "import threading\nvalue=0\ndef process(context):\n global value\n value+=1\n threads=[threading.Thread(target=lambda: print('thread-output')) for _ in range(20)]\n for t in threads: t.start()\n for t in threads: t.join()\n return value"
        for _ in range(2):
            result = self.run_script(source)
            self.assertTrue(result['ok'], result)
            self.assertEqual(json.loads(result['resultJson']), 1)
            self.assertEqual(result['stdout'].count('thread-output'), 20)

    def test_cancel_during_startup_and_reuse_after_cancellation(self):
        with ThreadPoolExecutor(max_workers=1) as executor:
            running = executor.submit(self.run_script, "def process(context):\n while True: pass")
            deadline = time.monotonic() + 15
            cancelled = False
            while time.monotonic() < deadline:
                if self.helper.request("cancel"):
                    cancelled = True
                    break
                time.sleep(0.02)
            self.assertTrue(cancelled)
            result = running.result(timeout=30)
        self.assertFalse(result["ok"])
        self.assertIn("KeyboardInterrupt", result["error"])
        self.assertTrue(self.run_script("def process(context): return {'ready': True}")["ok"])

    def test_math_type_valid_and_invalid_payloads(self):
        import struct
        mtef = bytes([3, 1, 1, 3, 0, 10, 1, 2, 131, ord('x'), 0, 0, 0])
        header = bytearray(28)
        struct.pack_into('<H', header, 0, 28)
        struct.pack_into('<I', header, 8, len(mtef))
        result = self.helper.request("mathType", data=base64.b64encode(header + mtef).decode("ascii"))
        self.assertTrue(result["supported"], result)
        self.assertIn("<math", result["mathMl"])
        self.assertFalse(result.get("diagnostics"), result)
        with self.assertRaisesRegex(RuntimeError, "payload is shorter"):
            self.helper.request("mathType", data=base64.b64encode(bytes([1, 2, 3])).decode("ascii"))
        self.assertTrue(self.helper.request("mathType", data=base64.b64encode(header + mtef).decode("ascii"))["supported"])

    def test_math_type_reference_workbook_objects(self):
        import zipfile
        source = ROOT / ".tmp" / "征地col.xlsx"
        if not source.exists():
            self.skipTest("Local MathType reference workbook unavailable")
        with zipfile.ZipFile(source) as archive:
            objects = [name for name in archive.namelist() if name.startswith("xl/embeddings/") and name.endswith(".bin")]
            self.assertEqual(len(objects), 3)
            for name in objects:
                with self.subTest(name=name):
                    result = self.helper.request("mathType", data=base64.b64encode(archive.read(name)).decode("ascii"))
                    self.assertTrue(result["supported"], result)
                    self.assertIn("<math", result["mathMl"])

    def test_helper_shutdown_during_running_script(self):
        with ThreadPoolExecutor(max_workers=1) as executor:
            started = threading.Event()

            def run():
                started.set()
                return self.run_script("def process(context):\n while True: pass")

            running = executor.submit(run)
            started.wait(5)
            # Synchronize through an actual protocol reply before closing.
            self.helper.request("hello")
            self.helper.close()
            with self.assertRaises(RuntimeError):
                running.result(timeout=10)
        self.assertFalse(self.helper._process.is_alive())
        self.assertFalse(self.helper._reader.is_alive())

    @unittest.skipUnless(sys.platform == 'win32', 'Windows GDI+ rasterization requires a Windows runtime')
    def test_windows_emf_fallback_through_host_returns_nonblank_png(self):
        import zipfile
        from PIL import Image
        source = ROOT / 'tests-native' / 'fixtures' / 'mathtype-equation-dsmt4.xlsx'
        with zipfile.ZipFile(source) as archive:
            emf = archive.read('xl/media/image1.emf')
        api = DesktopAPI(helper=self.helper)
        png = bytes(api.RasterizeLegacyEquationPreview(list(emf), 'emf'))
        self.assertTrue(png.startswith(b'\x89PNG\r\n\x1a\n'))
        with Image.open(io.BytesIO(png)) as image:
            self.assertGreater(image.width, 0)
            self.assertGreater(image.height, 0)
            rgb = Image.new('RGB', image.size, 'white')
            rgba = image.convert('RGBA')
            rgb.paste(rgba, mask=rgba.getchannel('A'))
            self.assertTrue(any(min(pixel) < 240 for pixel in rgb.getdata()), 'Windows EMF preview is blank')


if __name__ == "__main__":
    unittest.main()
