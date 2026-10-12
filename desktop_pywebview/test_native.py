import base64
from concurrent.futures import ThreadPoolExecutor
import json
import io
from pathlib import Path
import threading
import sys
import time
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

    def test_host_files_are_not_accessible(self):
        result = self.run_script("def process(context):\n return open('/etc/passwd').read()")
        self.assertFalse(result["ok"])
        self.assertTrue(result["error"])

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
        self.assertIsNotNone(self.helper._process.poll())
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
