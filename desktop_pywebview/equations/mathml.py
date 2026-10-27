"""Presentation MathML layout, preserving the mtef-mathml v0.2.0 output contract."""

from .model import Char, Line, Matrix, Pile, Template


def escape(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def element(tag, body, **attrs):
    attributes = ''.join(f' {k}="{escape(str(v))}"' for k, v in attrs.items() if v != '')
    return f'<{tag}{attributes}>{body}</{tag}>'


def mo(value):
    return element('mo', escape(value)) if value else ''


def script_pos(pos):
    return 2 if pos == 2 else 1


def as_script(s):
    return element('mstyle', s, scriptlevel='0') if s else ''


def content(slots):
    return [n for n in slots if not (isinstance(n, Line) and n.null)]


def is_script(t):
    return isinstance(t, Template) and ((t.version == 5 and 27 <= t.selector <= 29) or (t.version == 3 and t.selector in (15, 44)))


def is_pre(t):
    return is_script(t) and (t.selector == 44 if t.version == 3 else bool(t.variation & 1))


def write_script(t, base, pos=0, pre=False):
    slots = content(t.slots)
    def get(i):
        if i >= len(slots):
            raise ValueError('script template has too few slots')
        s = write(slots[i], 1 if pre else script_pos(pos))
        return as_script(s) if pre or pos == 0 else s
    if pre:
        sub = sup = '<none/>'
        if t.version == 3:
            if t.variation == 0:
                sup = get(0)
            else:
                sub = get(0)
            if t.variation == 2:
                sup = get(1)
        else:
            if t.selector in (27, 29):
                sub = get(0)
            if t.selector == 28:
                sup = get(0)
            if t.selector == 29:
                sup = get(1)
        return element('mmultiscripts', base + '<none/><none/><mprescripts/>' + sub + sup)
    if t.version == 3:
        return element('msup' if t.variation == 0 else 'msub' if t.variation == 1 else 'msubsup',
                       base + get(0) + (get(1) if t.variation not in (0, 1) else ''))
    if t.variation & 1:
        raise ValueError('pre-script template must precede its base')
    return element({27: 'msub', 28: 'msup', 29: 'msubsup'}[t.selector],
                   base + get(0) + (get(1) if t.selector == 29 else ''))


def row(nodes, pos):
    items, previous, i = [], '', 0
    while i < len(nodes):
        n = nodes[i]
        if is_pre(n) or (is_script(n) and not previous and i + 1 < len(nodes) and not is_script(nodes[i + 1])):
            if i + 1 >= len(nodes):
                raise ValueError('pre-script template has no base')
            if previous:
                items.append(previous)
            previous = write_script(n, write(nodes[i + 1], pos), pre=True)
            i += 2
            continue
        if is_script(n) and previous:
            previous = write_script(n, previous, pos)
            i += 1
            continue
        if previous:
            items.append(previous)
        function = lambda c: isinstance(c, Char) and c.typeface == 2 and c.value.isalpha() and not c.embellishments
        text = lambda c: isinstance(c, Char) and c.typeface in (1, 9, 10) and not c.embellishments
        if function(n) or text(n):
            predicate = function if function(n) else text
            end = i + 1
            while end < len(nodes) and predicate(nodes[end]):
                end += 1
            value = escape(''.join(c.value for c in nodes[i:end]))
            previous = element('mi', value, mathvariant='normal') if function(n) else '<mtext xml:space="preserve">' + value.replace(' ', '\u00a0') + '</mtext>'
            i = end
        else:
            previous, i = write(n, pos), i + 1
    if previous:
        items.append(previous)
    return element('mrow', ''.join(items))


BIG = '∫∬∭∮∯∰∲∳∑∏∐⋃⋂'
SPACES = {0xef01: '0', 0xeb02: '0.167', 0xef02: '0.167', 0xeb07: '0.167',
          0xeb03: '0.222', 0xef03: '0.222', 0xeb04: '0.278', 0xef04: '0.278',
          0xeb05: '1', 0xef05: '1', 0xeb06: '2', 0xef06: '2', 0xeb08: '0.083', 0xef08: '0.083'}
OVER = {2: '˙', 3: '¨', 4: '···', 8: '~', 9: '^', 11: '→', 12: '←', 13: '↔', 14: '⇀', 15: '↼', 17: '¯', 19: '⌢', 20: '⌣', 24: '····'}
UNDER = {25: '˙', 26: '¨', 27: '···', 28: '····', 29: '¯', 30: '~', 31: '⌢', 32: '⌣', 33: '→', 34: '←', 35: '↔', 36: '⇁', 37: '↽'}


def is_operator(value):
    if value in '+-−×÷=*/=<>≤≥≠,;:.()[]{}|!∫∑∏∪∩⋃⋂':
        return True
    code = ord(value)
    return any(lo <= code <= hi for lo, hi in ((0xa0, 0xbb), (0x2c6, 0x2ff), (0x300, 0x36f),
               (0x2010, 0x2027), (0x2030, 0x2069), (0x2070, 0x209f), (0x2100, 0x214f),
               (0x2190, 0x2aff), (0x3000, 0x303f)))


def write_char(c, pos):
    if c.code in SPACES:
        return f'<mspace width="{SPACES[c.code]}em"/>'
    if c.code in (0xef00, 0xef07):
        return ''
    value = escape(c.value)
    if 0xf000 <= c.code <= 0xf019:
        s = element('mi', chr(ord('A') + c.code - 0xf000), mathvariant='fraktur')
    elif c.value == '∅':
        s = element('mi', 'Ø', mathvariant='normal')
    elif c.typeface == 2 and c.value.isalpha() and not c.embellishments:
        s = element('mi', value, mathvariant='normal')
    elif c.value in "'′″‴‵⁗()[]{}⟨⟩〈〉|‖⌊⌋⌈⌉⟦⟧〚〛":
        s = element('mo', value, stretchy='false')
    elif c.typeface in (1, 9, 10):
        s = '<mtext xml:space="preserve">' + value.replace(' ', '\u00a0') + '</mtext>'
    elif c.value.isspace() and not is_operator(c.value):
        s = '<mspace width="0.333em"/>'
    else:
        s = element('mn' if c.value.isdecimal() else 'mo' if is_operator(c.value) else 'mi', value)
    for k in c.embellishments:
        if k in OVER:
            s = element('mover', s + mo(OVER[k]), accent='true')
        elif k in UNDER:
            s = element('munder', s + mo(UNDER[k]), accentunder='true')
        elif k in (5, 6, 18):
            s = element('msup', s + mo({5: '′', 6: '″', 18: '‴'}[k]))
        elif k == 7:
            s = element('mmultiscripts', s + '<none/><none/><mprescripts/><none/><mo lspace="0" rspace="0">‵</mo>')
        elif k in (10, 16, 21, 22, 23):
            notation = {16: 'horizontalstrike', 21: 'updiagonalstrike downdiagonalstrike', 23: 'downdiagonalstrike'}.get(k, 'updiagonalstrike')
            s = element('menclose', s, notation=notation)
    if c.font_size and (c.force_size or (c.value not in BIG and pos != 2)):
        s = element('mstyle', s, mathsize=c.font_size)
    return element('mpadded', s, width='1.2em', lspace='0.1em') if c.value == '∅' else s


def table(n, pos):
    matrix = isinstance(n, Matrix)
    attrs = dict(columnalign={1: 'left', 3: 'right'}.get(n.hjust if matrix else n.halign, ''),
                 rowalign={0: 'top', 1: 'baseline', 2: 'bottom', 4: 'axis'}.get(n.valign, ''))
    frame, outer = '', []
    if matrix:
        if len(n.cells) != n.rows * n.cols:
            raise ValueError('matrix has inconsistent dimensions')
        attrs.update(rowspacing=n.row_spacing, columnspacing=n.col_spacing)
        for parts, key in ((n.row_parts, 'rowlines'), (n.col_parts, 'columnlines')):
            lines = ['none', 'solid', 'dashed', 'dotted']
            attrs[key] = ' '.join(lines[p] for p in parts[1:-1]) if any(parts[1:-1]) else ''
        edges = [n.row_parts[0] if n.row_parts else 0, n.row_parts[-1] if n.row_parts else 0,
                 n.col_parts[0] if n.col_parts else 0, n.col_parts[-1] if n.col_parts else 0]
        if all(edges):
            frame = 'dashed' if any(p in (2, 3) for p in edges) else 'solid'
        attrs['frame'] = frame
        outer = [name for name, p in zip(('top', 'bottom', 'left', 'right'), edges) if p]
        rows = [n.cells[i * n.cols:(i + 1) * n.cols] for i in range(n.rows)]
    else:
        rows = [[line] for line in n.lines]
    body = ''.join(element('mtr', ''.join(element('mtd', write(cell, pos)) for cell in cells)) for cells in rows)
    result = element('mtable', body, **attrs)
    return element('menclose', result, notation=' '.join(outer)) if outer and not frame else result


def fence_group(left, main, right):
    if left or right:
        main = element('mpadded', main, height='+0.12em', depth='+0.12em')
    return element('mrow', fence_mo(left) + main + fence_mo(right))


def fence_mo(value):
    return element('mo', escape(value), stretchy='true') if value else ''


def stretch(main, mark, under=False):
    return element('munder' if under else 'mover', main + fence_mo(mark))


def enclose_box(notation, main):
    if notation in ('top left', 'top right', 'bottom left', 'bottom right'):
        glyph = {'top left': '⌜', 'top right': '⌝', 'bottom left': '⌞', 'bottom right': '⌟'}[notation]
        mark = element('mo', glyph, stretchy='false', lspace='0', rspace='0')
        return element('mrow', mark + main if notation.endswith('left') else main + mark)
    return element('menclose', element('mpadded', main, height='+0.18em', depth='+0.18em', width='+0.36em', lspace='0.18em'), notation=notation)


def box_notation(v):
    sides = [name for name, bit in (('top', 8), ('bottom', 16), ('left', 2), ('right', 4)) if v & bit]
    if len(sides) == 4:
        return 'roundedbox' if v & 1 else 'box'
    return ' '.join(sides) or 'box'


def sized_operator(glyph):
    if glyph not in '∫∬∭∮∯∰∲∳':
        return mo(glyph)
    if glyph in '∯∰∲∳':
        return element('mo', glyph, stretchy='false', largeop='false', mathsize='234%')
    return element('mo', glyph, stretchy='false', largeop='true')


def big_glyph(selector, variation):
    if selector != 15:
        return {16: '∑', 17: '∏', 18: '∐', 19: '⋃', 20: '⋂', 21: '∫'}.get(selector, '∑')
    loop, count = variation & 12, variation & 3
    if loop in (12, 8):
        return '∳' if loop == 12 else '∲'
    if loop == 4:
        return {2: '∯', 3: '∰'}.get(count, '∮')
    return {2: '∬', 3: '∭'}.get(count, '∫')


def decorate(op, lower, upper, under=True):
    if lower and upper:
        return element('munderover' if under else 'msubsup', op + lower + upper)
    if lower:
        return element('munder' if under else 'msub', op + lower)
    if upper:
        return element('mover' if under else 'msup', op + upper)
    return op


def big_operator(t):
    index = 0
    def take(pos):
        nonlocal index
        if index >= len(t.slots):
            return ''
        n = t.slots[index]
        index += 1
        return '' if isinstance(n, Line) and n.null else write(n, pos)
    main = take(0)
    lower = take(2) if t.variation & 16 else ''
    upper = take(2) if t.variation & 32 else ''
    glyph = big_glyph(t.selector, t.variation)
    if t.selector in (21, 22):
        glyph = next((n.value for n in t.slots[index:] if isinstance(n, Char) and n.value in BIG), glyph)
    lower = element('mstyle', lower, displaystyle='false') if lower else ''
    upper = element('mstyle', upper, displaystyle='false') if upper else ''
    return element('mstyle', decorate(sized_operator(glyph), lower, upper, bool(t.variation & 64) or t.selector in (19, 20)) + main, displaystyle='true')


def arrow(t):
    index, labels = 0, ['', '']
    for k in range(2):
        if index < len(t.slots) and not isinstance(t.slots[index], Char):
            n = t.slots[index]
            labels[k] = '' if isinstance(n, Line) and n.null else as_script(write(n, 1))
            index += 1
    glyphs = [write(n) for n in t.slots[index:] if isinstance(n, Char)]
    glyphs = [g for g in glyphs if g]
    v = t.variation
    fallback = '↔' if v & 16 and v & 32 else '←' if v & 16 else '⇀' if v & 2 else '⇄' if v & 1 else '→'
    op = element('munder', ''.join(glyphs[:2])) if len(glyphs) >= 2 else glyphs[0] if glyphs else mo(fallback)
    return decorate(op, labels[1], labels[0])


FENCES = [('⟨', '⟩'), ('(', ')'), ('{', '}'), ('[', ']'), ('|', '|'), ('‖', '‖'), ('⌊', '⌋'), ('⌈', '⌉'), ('⟦', '⟧')]


def horizontal_brace(t, get, get_script):
    main = get(0)
    over = t.selector == 27 if t.version == 3 else bool(t.variation & 1)
    tag = 'mover' if over else 'munder'
    if t.version != 3 and t.selector == 25:
        body = element('menclose', element('mpadded', main, width='+1.1em', lspace='0.55em', height='+0.12em', depth='+0.12em'), notation='top' if over else 'bottom')
    else:
        padded = element('mpadded', main, width='2.6em', lspace='0.8em', height='+0.12em')
        mark = element('mo', '⏞' if over else '⏟', stretchy='true', minsize='2.6em', maxsize='2.6em')
        body = element(tag, padded + mark)
    return element(tag, body + get_script(1)) if len(content(t.slots)) > 1 else body


def template(t, pos):
    s, v = t.selector, t.variation
    if t.version != 3:
        if s == 14:
            return arrow(t)
        if 15 <= s <= 22:
            return big_operator(t)
        if s == 30:
            values = []
            for n in t.slots:
                if isinstance(n, Char) or len(values) == 2:
                    break
                values.append('' if isinstance(n, Line) and n.null else write(n))
            values += [''] * (2 - len(values))
            return element('mrow', (fence_mo('⟨') if v & 1 else '') + values[0] + fence_mo('|') + values[1] + (fence_mo('⟩') if v & 2 else ''))
    slots = content(t.slots)
    def get(i, script=False):
        if i >= len(slots):
            raise ValueError(f'template {s} has too few slots')
        value = write(slots[i], script_pos(pos) if script else pos)
        return as_script(value) if script else value
    get_script = lambda i: get(i, True)
    if t.version == 3:
        return v3_template(t, get, get_script)
    if s <= 8:
        left, right = FENCES[s]
        return fence_group(left if v & 1 else '', get(0), right if v & 2 else '')
    if s == 9:
        return fence_group('()[]'[v & 3], get(0), '()[]'[(v >> 4) & 3])
    if s == 10:
        return element('mroot', get(0) + get_script(1)) if v & 1 else element('msqrt', get(0))
    if s == 11:
        n, d = get(0), get(1)
        if v & 2 and v & 4:
            return element('mrow', n + mo('/') + d)
        return element('mstyle', element('mfrac', n + d, **({'bevelled': 'true'} if v & 2 else {})), displaystyle='true')
    if s in (12, 13):
        main = stretch(get(0), '¯' if s == 13 else '_', s == 12)
        return stretch(main, '¯' if s == 13 else '_', s == 12) if v & 1 else main
    if s == 23:
        return element('mrow', element('munder', get(0) + get_script(1)))
    if s in (24, 25):
        return horizontal_brace(t, get, get_script)
    if s == 26:
        main = element('menclose', get(0), notation='longdiv')
        if v & 1:
            return element('mtable', element('mtr', element('mtd', get(1), columnalign='right')) + element('mtr', element('mtd', main, columnalign='right')), columnspacing='0', rowspacing='0')
        return main
    if s in (27, 28, 29):
        if not slots:
            return '<mrow></mrow>'
        return write(slots[0], script_pos(pos)) if len(slots) == 1 else write_script(Template(t.version, t.offset, s, 0, t.slots), '<mrow></mrow>', pos)
    if s in (31, 32, 33, 34):
        main = get(0)
        mark = {31: '→', 32: '~', 33: '^', 34: '⏜'}[s]
        if s == 31:
            mark = '↔' if v & 1 and v & 2 else '←' if v & 1 else mark
            if v & 8:
                mark = '↼' if v & 1 else '⇀'
        if '<mo>' in main:
            mark = {'⇀': '→', '↼': '←'}.get(mark, mark)
        return stretch(main, mark, s == 31 and bool(v & 4))
    if s == 35:
        return element('menclose', get(0), notation='top')
    if s == 36:
        notation = 'horizontalstrike' if v & 1 else 'updiagonalstrike downdiagonalstrike' if v & 2 and v & 4 else 'downdiagonalstrike' if v & 4 else 'updiagonalstrike' if v & 2 else 'updiagonalstrike downdiagonalstrike'
        return element('menclose', get(0), notation=notation)
    if s == 37:
        return enclose_box(box_notation(v), get(0))
    raise ValueError(f'unsupported template selector {s}')


def v3_template(t, get, gs):
    s, v = t.selector, t.variation
    if s <= 7:
        left, right = FENCES[s]
        return fence_group('' if v == 2 else left, get(0), '' if v == 1 else right)
    if 8 <= s <= 12:
        return fence_group('(', get(0), ')')
    if s == 13:
        return element('mroot', get(0) + gs(1)) if v == 1 else element('msqrt', get(0))
    if s == 14:
        return element('mstyle', element('mfrac', get(0) + get(1)), **({'scriptlevel': '+1'} if v == 1 else {'displaystyle': 'true'}))
    if s in (15, 44):
        raise ValueError('detached v3 script template')
    if s in (16, 17, 18, 19, 20, 46, 47):
        mark = {16: '_', 17: '¯', 18: '←', 19: '→', 20: '↔'}.get(s, '←' if v == 0 else '→')
        return element('munder' if s == 16 else 'mover', get(0) + mo(mark), **({'accentunder': 'true'} if s == 16 else {'accent': 'true'}))
    if s in (21, 22, 23, 24, 25, 26, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 42, 43):
        glyph = {21: '∫', 24: '∫', 22: '∬', 25: '∬', 23: '∭', 26: '∭', 29: '∑', 30: '∑', 43: '∑', 31: '∏', 32: '∏', 33: '∐', 34: '∐', 35: '⋃', 36: '⋃', 37: '⋂', 38: '⋂', 42: '∫'}[s]
        if s in (21, 22, 23):
            lower, upper = v in (1, 2, 4), v == 2
        elif s in (24, 25, 26):
            lower, upper = True, v == 0
        elif s in (29, 31, 33, 35, 37):
            lower, upper = v in (0, 1), v == 1
        elif s in (42, 43):
            lower, upper = v in (0, 2), v in (1, 2)
        else:
            lower, upper = True, v == 1
        return element('mrow', decorate(sized_operator(glyph), gs(1) if lower else '', gs(2 if lower else 1) if upper else '') + get(0))
    if s in (27, 28):
        return horizontal_brace(t, get, gs)
    if s == 39:
        return decorate(get(0), gs(1) if v != 0 else '', gs(1 if v == 0 else 2) if v != 1 else '')
    if s == 40:
        return element('menclose', get(0), notation='longdiv')
    if s == 41:
        if v == 1:
            return element('mrow', get(0) + mo('/') + get(1))
        main = element('mfrac', get(0) + get(1), bevelled='true')
        return element('mstyle', main, scriptlevel='+1') if v == 2 else main
    if s == 45:
        return element('mrow', mo('⟨') + get(0) + mo('|') + get(1) + mo('⟩'))
    if s == 48:
        return enclose_box(box_notation(v), get(0))
    raise ValueError(f'unsupported MTEF v3 template selector {s}')


def write(node, pos=0):
    if isinstance(node, Line):
        return row(node.children, pos)
    if isinstance(node, Char):
        return write_char(node, pos)
    if isinstance(node, (Matrix, Pile)):
        return table(node, pos)
    if isinstance(node, Template):
        return template(node, pos)
    raise ValueError(f'cannot serialize {type(node).__name__}')


def serialize(root):
    return '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">' + write(root) + '</math>'
