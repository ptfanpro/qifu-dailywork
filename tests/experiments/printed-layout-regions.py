"""Compatibility import for the single authoritative, non-binding geometry implementation."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("printed_layout_geometry",
    Path(__file__).resolve().parents[2] / "src" / "printed_layout_geometry.py")
implementation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(implementation)
for name in dir(implementation):
    if not name.startswith("_"):
        globals()[name] = getattr(implementation, name)
