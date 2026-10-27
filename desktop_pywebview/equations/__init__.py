"""Python port of mtef-mathml v0.2.0; no Go runtime or compiler required."""

import struct

from .mathml import serialize
from .ole import SIGNATURE, extract
from .parser import MAX_BYTES, Parser


def convert_mtef(data):
    parser = Parser(data)
    root = parser.parse()
    result = dict(supported=False, mathMl='', diagnostics=parser.diagnostics)
    if any(d['severity'] == 'error' for d in parser.diagnostics):
        return result
    try:
        result['mathMl'] = serialize(root)
    except (ValueError, RecursionError) as error:
        result['diagnostics'].append(dict(severity='error', offset=0, construct='MathML serialization', message=str(error)))
        return result
    result['supported'] = True
    return result


def convert_ole(data):
    if len(data) > 64 << 20:
        raise ValueError('OLE payload exceeds 67108864-byte limit')
    if data.startswith(SIGNATURE):
        data = extract(data)
    if len(data) < 28:
        raise ValueError('not an Equation Native payload: payload is shorter than 28 bytes')
    header = struct.unpack_from('<H', data)[0]
    length = struct.unpack_from('<I', data, 8)[0]
    if not 28 <= header <= len(data):
        raise ValueError('not an Equation Native payload: invalid header length')
    if length > MAX_BYTES or length > len(data) - header:
        raise ValueError('not an Equation Native payload: invalid MTEF length')
    return convert_mtef(data[header:header + length])
