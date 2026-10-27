"""Windows GDI+ equation preview rasterization, without a native helper binary."""

import ctypes
from pathlib import Path
import sys
import tempfile


def rasterize(data, extension):
    extension = extension.lower().lstrip('.')
    if extension not in ('emf', 'wmf'):
        raise ValueError(f'unsupported legacy equation preview format: {extension}')
    if sys.platform != 'win32':
        raise RuntimeError('Native equation preview rasterization requires Windows')
    from ctypes import wintypes
    class Startup(ctypes.Structure):
        _fields_ = [('version', ctypes.c_uint32), ('callback', ctypes.c_void_p),
                    ('background', wintypes.BOOL), ('codecs', wintypes.BOOL)]
    class GUID(ctypes.Structure):
        _fields_ = [('a', ctypes.c_uint32), ('b', ctypes.c_uint16), ('c', ctypes.c_uint16),
                    ('d', ctypes.c_ubyte * 8)]
    api = ctypes.WinDLL('gdiplus')
    api.GdiplusStartup.argtypes = [ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(Startup), ctypes.c_void_p]
    api.GdiplusShutdown.argtypes = [ctypes.c_size_t]
    api.GdipLoadImageFromFile.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p)]
    api.GdipSaveImageToFile.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.POINTER(GUID), ctypes.c_void_p]
    api.GdipDisposeImage.argtypes = [ctypes.c_void_p]
    token, image = ctypes.c_size_t(), ctypes.c_void_p()
    def check(status, action):
        if status:
            raise RuntimeError(f'GDI+ {action} failed (status {status})')
    check(api.GdiplusStartup(ctypes.byref(token), ctypes.byref(Startup(1)), None), 'startup')
    try:
        with tempfile.TemporaryDirectory(prefix='equation-preview-') as directory:
            source, destination = Path(directory, 'preview.' + extension), Path(directory, 'preview.png')
            source.write_bytes(data)
            check(api.GdipLoadImageFromFile(str(source), ctypes.byref(image)), 'load image')
            try:
                encoder = GUID(0x557cf406, 0x1a04, 0x11d3, (ctypes.c_ubyte * 8)(0x9a, 0x73, 0, 0, 0xf8, 0x1e, 0xf3, 0x2e))
                check(api.GdipSaveImageToFile(image, str(destination), ctypes.byref(encoder), None), 'encode PNG')
                return destination.read_bytes()
            finally:
                api.GdipDisposeImage(image)
    finally:
        api.GdiplusShutdown(token)
