import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401
from settings import ENV_PATH, PROJECT_ROOT, load_env


class LoadEnvTests(unittest.TestCase):
    def env_file(self, text: str) -> Path:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / ".env"
        path.write_text(text, encoding="utf-8")
        return path

    def test_reads_names_and_values(self):
        environ = {}
        path = self.env_file('# comment\n\nGEMINI_API_KEY="abc123"\nGEMINI_MODEL = gemini-x\nnot a setting\n')
        self.assertEqual(load_env(path, environ), ["GEMINI_API_KEY", "GEMINI_MODEL"])
        self.assertEqual(environ, {"GEMINI_API_KEY": "abc123", "GEMINI_MODEL": "gemini-x"})

    def test_existing_values_win(self):
        environ = {"GEMINI_API_KEY": "from-terminal"}
        self.assertEqual(load_env(self.env_file("GEMINI_API_KEY=from-file\n"), environ), [])
        self.assertEqual(environ["GEMINI_API_KEY"], "from-terminal")

    def test_placeholder_and_empty_values_are_skipped(self):
        environ = {}
        load_env(self.env_file("GEMINI_API_KEY=paste-your-key-here\nOTHER=\n"), environ)
        self.assertEqual(environ, {})

    def test_missing_file_is_fine(self):
        self.assertEqual(load_env(Path("does-not-exist.env"), {}), [])

    def test_reads_dot_env_not_the_example(self):
        self.assertEqual(ENV_PATH, PROJECT_ROOT / ".env")


if __name__ == "__main__":
    unittest.main()
