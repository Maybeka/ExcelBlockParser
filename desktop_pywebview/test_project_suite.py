import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from .project_suite import expected_external_source_path, wait_saved


class ProjectSuitePathTests(unittest.TestCase):
    def test_save_waits_for_completion_instead_of_accepting_intermediate_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Project.json'
            intermediate = {'version': 3, 'sourcePath': 'workbooks/sales.xlsx'}
            final = {'version': 3, 'sourcePath': '../input/workbooks/sales.xlsx'}
            path.write_text(json.dumps(intermediate), encoding='utf-8')
            ui = Mock()
            def finish_save(expression):
                self.assertIn('.project-save-notice', expression)
                self.assertIn('!== window.__pywebviewSaveNoticeBeforeCommand', expression)
                self.assertIn('Saved Project', expression)
                path.write_text(json.dumps(final), encoding='utf-8')
            ui.wait.side_effect = finish_save
            self.assertEqual(wait_saved(path, ui), final)
            ui.wait.assert_called_once()

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
