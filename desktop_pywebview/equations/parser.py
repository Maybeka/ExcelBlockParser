"""Bounded MTEF v3/v5 parser, ported from mtef-mathml v0.2.0."""

from pathlib import Path
from decimal import Decimal
import struct
import xml.etree.ElementTree as ET

from .model import Char, Line, Matrix, Pile, Template


MAX_BYTES = 16 << 20
MT_CODES = {0xe901: 0x2a72, 0xe902: 0x2a71, 0xe903: 0x2a26, 0xe904: 0x2a24,
            0xe90b: 0x2287, 0xe90c: 0x2286, 0xe922: 0x22da, 0xe92d: 0x22db,
            0xe932: 0x2272, 0xe933: 0x2273, 0xe98f: 0xb7, 0xeb01: 0x2942}


def normalize_font(value):
    return value.lower().translate(str.maketrans('', '', ' _-+.'))


def load_font_maps():
    maps = {}
    for path in Path(__file__).with_name('fontmaps').glob('*.xml'):
        symbols = {}
        for symbol in ET.parse(path).iter('symbol'):
            value = symbol.get('char', '')
            if len(value) == 1:
                try:
                    number = int(symbol.get('number', ''), 16)
                except ValueError:
                    continue
                if 0 <= number <= 65535:
                    symbols[number] = value
        maps[normalize_font(path.stem)] = symbols
    return maps


FONT_MAPS = load_font_maps()


def dim_points(dim, full):
    unit, value = dim
    return {0: value * 72, 1: value * 72 / 2.54, 2: value,
            3: value * 12, 4: full * value / 100}.get(unit, value)


def spacing(dim, row):
    unit, value = dim
    def number(number_value):
        text = format(Decimal(str(number_value)), 'f')
        return text.rstrip('0').rstrip('.') if '.' in text else text
    if unit == 4:
        if (row and 140 <= value <= 160) or (not row and 90 <= value <= 110):
            return ''
        return number(value / 100) + 'ex'
    return number(value) + {0: 'in', 1: 'cm', 2: 'pt', 3: 'pc'}.get(unit, 'em')


class Parser:
    def __init__(self, data):
        if len(data) > MAX_BYTES:
            raise ValueError('MTEF stream exceeds 16777216-byte limit')
        if len(data) < 5:
            raise ValueError('MTEF header: truncated')
        self.data, self.i, self.version = data, 5, data[0]
        if self.version not in (3, 5):
            raise ValueError(f'MTEF header: unsupported version {self.version}')
        self.styles, self.style_fonts, self.fonts = {}, {}, []
        self.font_size, self.force_size = '', False
        self.size_dims = []
        self.matrix_row_spacing = self.matrix_col_spacing = ''
        self.nodes = 0
        self.diagnostics = []
        if self.version == 5:
            self.cstring()
            self.byte()

    def take(self, count):
        if count < 0 or count > len(self.data) - self.i:
            raise ValueError(f'truncated at offset {self.i}')
        value = self.data[self.i:self.i + count]
        self.i += count
        return value

    def byte(self):
        return self.take(1)[0]

    def word(self):
        return struct.unpack('<H', self.take(2))[0]

    def uint(self):
        value = self.byte()
        return self.word() if value == 255 else value

    def signed(self):
        value = self.byte()
        return self.word() - 32768 if value == 255 else value - 128

    def cstring(self):
        start = self.i
        while self.byte():
            if self.i - start > 4096:
                raise ValueError('string exceeds 4096 bytes')
        return self.data[start:self.i - 1].decode('utf-8', errors='replace')

    def nudge(self):
        a, b = self.byte(), self.byte()
        if a == b == 128:
            self.take(4)

    def ruler(self):
        self.take(self.byte() * 3)

    def tag(self):
        value = self.byte()
        if self.version == 3:
            return value & 15, value >> 4
        return value, self.byte() if value in (1, 2, 3, 4, 5, 6, 16, 18) else 0

    def unsupported(self, offset, construct, message):
        self.diagnostics.append(dict(severity='error', offset=offset, construct=construct, message=message))

    def parse(self):
        root = Line(self.read_list(0))
        if self.i != len(self.data):
            raise ValueError(f'MTEF: trailing data at offset {self.i}')
        return root

    def read_list(self, depth):
        if depth > 256:
            raise ValueError('MTEF: nesting exceeds 256')
        previous = self.font_size, self.force_size
        nodes = []
        try:
            while True:
                offset = self.i
                typ, options = self.tag()
                if typ == 0:
                    return nodes
                node = self.record(typ, options, offset, depth)
                if node is not None:
                    self.nodes += 1
                    if self.nodes > 1 << 20:
                        raise ValueError('MTEF: object count exceeds 1048576')
                    nodes.append(node)
        finally:
            self.font_size, self.force_size = previous

    def record(self, typ, opt, off, depth):
        if typ >= 100 or (self.version == 3 and typ >= 15):
            self.take(self.uint())
            return None
        if typ in (1, 2, 3, 4, 5, 6) and opt & 8:
            self.nudge()
        if typ == 1:
            if opt & 4:
                self.word()
            if opt & 2:
                self.ruler()
            return Line(null=True) if opt & 1 else Line(self.read_list(depth + 1))
        if typ == 2:
            return self.char(opt, off)
        if typ == 3:
            selector, variation = self.byte(), self.byte()
            if self.version == 5 and variation & 128:
                variation = (variation & 127) | self.byte() << 8
            self.byte()
            slots = self.read_list(depth + 1)
            if selector > (37 if self.version == 5 else 48):
                self.unsupported(off, 'template', f'template selector {selector} is not implemented')
            return Template(self.version, off, selector, variation, slots)
        if typ == 4:
            halign, valign = self.byte(), self.byte()
            if opt & 2:
                self.ruler()
            return Pile(self.read_list(depth + 1), halign, valign)
        if typ == 5:
            valign, hjust, vjust, rows, cols = [self.byte() for _ in range(5)]
            if not rows or not cols:
                raise ValueError('MTEF matrix: zero dimension')
            def parts(count):
                raw = self.take((count * 2 + 7) // 8)
                return [(raw[i // 4] >> ((i % 4) * 2 if self.version == 5 else 6 - (i % 4) * 2)) & 3 for i in range(count)]
            row_parts, col_parts = parts(rows + 1), parts(cols + 1)
            cells = self.read_list(depth + 1)
            if len(cells) != rows * cols:
                raise ValueError(f'MTEF matrix: declared {rows * cols} cells, found {len(cells)}')
            return Matrix(rows, cols, cells, row_parts, col_parts, valign, hjust, vjust,
                          self.matrix_row_spacing, self.matrix_col_spacing)
        if typ == 6:
            self.byte()
            self.unsupported(off, 'embellishment', 'embellishment appeared outside a character')
        elif typ == 7:
            self.ruler()
        elif typ == 8:
            if self.version == 3:
                self.signed()
                self.byte()
                self.cstring()
            else:
                font, style = self.uint(), self.byte()
                self.styles[style], self.style_fonts[style] = style, font
        elif typ == 9:
            self.size()
        elif typ in (10, 11, 12, 13, 14):
            self.font_size, self.force_size = self.size_percent(typ - 10, 0), False
        elif typ == 15:
            self.uint()
        elif typ == 16:
            self.take((4 if opt & 1 else 3) * 2)
            if opt & 4:
                self.cstring()
        elif typ == 17:
            self.uint()
            self.fonts.append(self.cstring())
        elif typ == 18:
            self.preferences()
        elif typ == 19:
            self.cstring()
        else:
            raise ValueError(f'MTEF: unknown record type {typ} at offset {off}')
        return None

    def char(self, opt, off):
        tf = self.signed()
        code = self.word() if self.version == 3 or not opt & 0x20 else 0
        if self.version == 5:
            for flag, read in ((4, self.byte), (16, self.word)):
                if opt & flag:
                    value = read()
                    if opt & 0x20:
                        code = value
            if opt & 0x20 and not opt & 20:
                raise ValueError('MTEF char: no MTCode or font position')
        char = Char(chr(MT_CODES.get(code, code)), code, tf, self.styles.get(tf, 0),
                    bool(opt & (1 if self.version == 3 else 2)), font_size=self.font_size,
                    force_size=self.force_size)
        if self.version == 5 and opt & 0x20:
            index = -tf if tf < 0 else self.style_fonts.get(tf, 0)
            if 0 < index <= len(self.fonts):
                mapped = FONT_MAPS.get(normalize_font(self.fonts[index - 1]), {}).get(code)
                if mapped is None:
                    self.unsupported(off, 'character encoding', 'font position is absent from the declared font map')
                else:
                    char.value = mapped
            else:
                self.unsupported(off, 'character encoding', 'character has no MTCode and no resolvable font definition')
        if opt & (2 if self.version == 3 else 1):
            while True:
                offset = self.i
                typ, options = self.tag()
                if typ == 0:
                    break
                if typ != 6:
                    raise ValueError(f'MTEF embellishment list at {offset}: expected EMBELL, got {typ}')
                if options & 8:
                    self.nudge()
                kind = self.byte()
                if self.version == 3:
                    self.byte()
                char.embellishments.append(kind)
                if not 2 <= kind <= 37:
                    self.unsupported(offset, 'embellishment', f'embellishment type {kind} is not implemented')
        return char

    def full_points(self):
        return dim_points(self.size_dims[0], 12) if self.size_dims else 12

    def size_percent(self, logical, delta):
        full = self.full_points()
        if full <= 0:
            full = 12
        defaults = [full, full * 7 / 12, full * 5 / 12, full * 18 / 12, full]
        points = dim_points(self.size_dims[logical], full) if logical < len(self.size_dims) else defaults[logical] if logical < len(defaults) else full
        pct = max(1, points + delta / 32) / full * 100
        return '' if 99.5 < pct < 100.5 and delta == logical == 0 else f'{pct:.0f}%'

    def size(self):
        value = self.byte()
        if value == 101:
            points = -struct.unpack('<h', self.take(2))[0]
            if points > 0:
                self.font_size, self.force_size = f'{points}pt', True
            return
        if value == 100:
            logical, delta = self.byte(), struct.unpack('<h', self.take(2))[0]
            force = True
        else:
            logical, delta = value, self.byte() - 128
            force = delta != 0
        self.font_size, self.force_size = self.size_percent(logical, delta), force

    def dimensions(self):
        count = self.byte()
        if count > 64:
            raise ValueError('EQN_PREFS: dimension count exceeds limit')
        low, value = False, 0
        def nibble():
            nonlocal low, value
            if not low:
                value = self.byte()
                low = True
                return value >> 4
            low = False
            return value & 15
        dims = []
        for _ in range(count):
            unit, digits = nibble(), ''
            for _ in range(64):
                n = nibble()
                if n == 15:
                    break
                digits += str(n) if n <= 9 else '.' if n == 10 else '-' if n == 11 else ''
            else:
                raise ValueError('EQN_PREFS: unterminated dimension')
            try:
                number = float(digits)
            except ValueError:
                number = 0
            dims.append((unit, number))
        return dims

    def preferences(self):
        self.size_dims = self.dimensions()
        dims = self.dimensions()
        if len(dims) > 1:
            self.matrix_row_spacing = spacing(dims[1], True)
        if len(dims) > 2:
            self.matrix_col_spacing = spacing(dims[2], False)
        for index in range(1, self.byte() + 1):
            font = self.uint()
            self.styles[index] = self.byte() if font else 0
            if font:
                self.style_fonts[index] = font
