"""Typed MTEF nodes, preserving the source structure before MathML layout."""

from dataclasses import dataclass, field


@dataclass
class Line:
    children: list = field(default_factory=list)
    null: bool = False


@dataclass
class Char:
    value: str
    code: int = 0
    typeface: int = 0
    style: int = 0
    function_start: bool = False
    embellishments: list = field(default_factory=list)
    font_size: str = ""
    force_size: bool = False


@dataclass
class Template:
    version: int
    offset: int
    selector: int
    variation: int
    slots: list


@dataclass
class Pile:
    lines: list
    halign: int
    valign: int


@dataclass
class Matrix:
    rows: int
    cols: int
    cells: list
    row_parts: list
    col_parts: list
    valign: int
    hjust: int
    vjust: int
    row_spacing: str = ""
    col_spacing: str = ""
