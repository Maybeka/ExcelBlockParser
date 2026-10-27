import base64
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

from .equations import convert_mtef, convert_ole
from .equations.mathml import write
from .equations.model import Char, Line, Matrix, Pile, Template
from .equations.parser import spacing


def node(value):
    if 'Children' in value:
        return Line([node(n) for n in value['Children'] or []], value['Null'])
    if 'Value' in value:
        return Char(chr(value['Value']), value['MTCode'], value['Typeface'], value['Style'],
                    value['FunctionStart'], [n['Kind'] for n in value['Embellishments'] or []],
                    value['FontSize'], value['ForceSize'])
    if 'Selector' in value:
        return Template(value['Version'], value['Offset'], value['Selector'], value['Variation'], [node(n) for n in value['Slots'] or []])
    if 'Lines' in value:
        return Pile([node(n) for n in value['Lines'] or []], value['HAlign'], value['VAlign'])
    def parts(name):
        return list(base64.b64decode(value[name])) if value[name] else []
    return Matrix(value['Rows'], value['Cols'], [node(n) for n in value['Cells'] or []],
                  parts('RowParts'), parts('ColParts'), value['VAlign'], value['HJust'], value['VJust'],
                  value['RowSpacing'], value['ColSpacing'])


class EquationTests(unittest.TestCase):
    def test_dimension_precision_is_not_truncated_to_six_digits(self):
        self.assertEqual(spacing((2, 1.23456789), False), '1.23456789pt')
        self.assertEqual(spacing((4, 12.3456789), False), '0.123456789ex')

    def test_mtef_matches_captured_original_results(self):
        cases = json.loads(Path(__file__).with_name('fixtures').joinpath('mtef-v020-streams.json').read_text())
        for index, case in enumerate(cases):
            with self.subTest(index=index):
                data = base64.b64decode(case['data'])
                if case['error']:
                    with self.assertRaises((ValueError, RecursionError)):
                        convert_mtef(data)
                else:
                    actual = convert_mtef(data)
                    self.assertEqual(actual['supported'], case['result']['Supported'])
                    self.assertEqual(actual['mathMl'], case['result']['MathML'])
                    self.assertEqual(actual['diagnostics'], [dict(severity=d['Severity'], offset=d['Offset'], construct=d['Construct'], message=d['Message']) for d in case['result']['Diagnostics'] or []])

    def test_all_captured_nodes_match_original_mathml(self):
        cases = json.loads(Path(__file__).with_name('fixtures').joinpath('mtef-v020-nodes.json').read_text())
        for index, case in enumerate(cases):
            with self.subTest(index=index):
                value = node(case['node'])
                if case['error']:
                    with self.assertRaises(ValueError):
                        write(value, case['pos'])
                else:
                    actual = write(value, case['pos'])
                    self.assertEqual(actual, case['mathMl'])
                    ET.fromstring('<math>' + actual + '</math>')

    def test_malformed_ole_is_rejected(self):
        for data in (b'', b'bad', bytes.fromhex('d0cf11e0a1b11ae1') + b'\0' * 504):
            with self.subTest(length=len(data)), self.assertRaises(ValueError):
                convert_ole(data)
