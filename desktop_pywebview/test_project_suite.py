import unittest

from .project_suite import expected_external_source_path


class ProjectSuitePathTests(unittest.TestCase):
    def test_windows_same_drive_rebases_from_destination_directory(self):
        self.assertEqual(expected_external_source_path(
            r'C:\Projects\costs.xlsx', r'C:\Users\runner\output\project.json', windows=True,
        ), '../../../Projects/costs.xlsx')

    def test_windows_cross_drive_remains_absolute(self):
        source = r'C:\Projects\costs.xlsx'
        self.assertEqual(expected_external_source_path(
            source, r'D:\output\project.json', windows=True,
        ), source)

    def test_macos_preserves_foreign_windows_absolute_path(self):
        source = r'C:\Projects\costs.xlsx'
        self.assertEqual(expected_external_source_path(
            source, '/tmp/output/project.json', windows=False,
        ), source)
