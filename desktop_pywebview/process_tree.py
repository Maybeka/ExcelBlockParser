"""Stop execution descendants as well as the interpreter that created them."""

import ctypes
import os
import signal


class ProcessTree:
    def __init__(self, process):
        self.process, self.job = process, None
        if os.name == 'nt':
            from ctypes import wintypes
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
            kernel.CreateJobObjectW.restype = wintypes.HANDLE
            kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            kernel.AssignProcessToJobObject.restype = wintypes.BOOL
            kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            class BasicLimits(ctypes.Structure):
                _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                            ('flags', wintypes.DWORD), ('min_working', ctypes.c_size_t),
                            ('max_working', ctypes.c_size_t), ('active', wintypes.DWORD),
                            ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD),
                            ('scheduling', wintypes.DWORD)]
            class IOLimits(ctypes.Structure):
                _fields_ = [(name, ctypes.c_uint64) for name in ('reads', 'writes', 'other', 'read_bytes', 'write_bytes', 'other_bytes')]
            class ExtendedLimits(ctypes.Structure):
                _fields_ = [('basic', BasicLimits), ('io', IOLimits),
                            ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),
                            ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
            kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
            kernel.SetInformationJobObject.restype = wintypes.BOOL
            self.kernel = kernel
            self.job = kernel.CreateJobObjectW(None, None)
            limits = ExtendedLimits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (not self.job or not kernel.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits))
                    or not kernel.AssignProcessToJobObject(self.job, int(process.sentinel))):
                error = ctypes.get_last_error()
                if self.job:
                    kernel.CloseHandle(self.job)
                raise ctypes.WinError(error)

    def close(self):
        if self.job:
            self.kernel.TerminateJobObject(self.job, 1)
            self.kernel.CloseHandle(self.job)
            self.job = None
        elif os.name != 'nt':
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if self.process.is_alive():
            self.process.terminate()
        self.process.join(5)
        if self.process.is_alive():
            self.process.kill()
            self.process.join(5)
        if self.process.is_alive():
            raise RuntimeError('Python worker could not be stopped')
