"""Generated-file validation and confirmed UTF-8 export, matching Wails limits."""

import json
import os
from pathlib import Path, PurePosixPath
import tempfile


RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def decode_artifacts(value):
    artifacts = json.loads(value)
    if not isinstance(artifacts, list) or not 1 <= len(artifacts) <= 100:
        raise ValueError("Python must generate between 1 and 100 files")
    names = set()
    total = 0
    for artifact in artifacts:
        if not isinstance(artifact, dict) or set(artifact) - {"path", "content", "encoding"}:
            raise ValueError("Invalid Python artifact: expected path, content, and optional encoding")
        path = artifact.get("path")
        content = artifact.get("content")
        encoding = artifact.get("encoding", "utf-8")
        if not isinstance(path, str) or not 1 <= len(path.encode("utf-8")) <= 512:
            raise ValueError("Artifact paths must contain between 1 and 512 bytes")
        if not isinstance(content, str) or not isinstance(encoding, str) or encoding.lower() not in ("", "utf-8"):
            raise ValueError("Artifact content must be UTF-8 text")
        if "\\" in path or path.startswith("/") or str(PurePosixPath(path)) != path:
            raise ValueError("Artifact paths must be normalized relative paths")
        for segment in path.split("/"):
            if segment in ("", ".", "..") or segment.endswith((".", " ")):
                raise ValueError("Invalid artifact path segment")
            if segment.split(".", 1)[0].lower() in RESERVED or any(ord(char) < 32 or char in '<>:"|?*' for char in segment):
                raise ValueError("Artifact path is invalid on Windows")
        if path.lower() in names:
            raise ValueError("Duplicate artifact path")
        names.add(path.lower())
        size = len(content.encode("utf-8"))
        total += size
        if size > 5 * 1024 * 1024 or total > 25 * 1024 * 1024:
            raise ValueError("Artifact exceeds the 5 MB file or 25 MB total limit")
    return artifacts


def inspect_path(root, relative):
    current = root
    segments = relative.split("/")
    for index, segment in enumerate(segments):
        current = current / segment
        if current.is_symlink():
            raise ValueError("Artifact destination must not contain symbolic links")
        if current.exists():
            if index < len(segments) - 1 and not current.is_dir():
                raise ValueError("Artifact parent is not a directory")
            if index == len(segments) - 1 and not current.is_file():
                raise ValueError("Artifact destination is not a regular file")
    return current, current.exists()


def prepare_artifacts(directory, artifacts):
    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Output directory is not a directory")
    prepared = []
    for artifact in artifacts:
        target, exists = inspect_path(root, artifact["path"])
        prepared.append((artifact, target, exists))
    return root, prepared


def write_artifacts(root, prepared):
    for artifact, target, previously_existed in prepared:
        _, exists = inspect_path(root, artifact["path"])
        if exists and not previously_existed:
            raise ValueError("Artifact destination appeared after replacement confirmation")
        target.parent.mkdir(parents=True, exist_ok=True)
        inspect_path(root, artifact["path"])
        descriptor, temporary = tempfile.mkstemp(dir=target.parent, prefix=".python-artifact-")
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(artifact["content"].encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
