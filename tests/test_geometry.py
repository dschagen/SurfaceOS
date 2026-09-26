import unittest

import helpers  # noqa: F401
from utils.geometry import clamp, distance


class GeometryTests(unittest.TestCase):
    def test_distance(self):
        self.assertAlmostEqual(distance((0, 0), (3, 4)), 5.0)

    def test_clamp(self):
        self.assertEqual(clamp(1.5), 1.0)
        self.assertEqual(clamp(-2.0), 0.0)
        self.assertEqual(clamp(0.3), 0.3)


if __name__ == "__main__":
    unittest.main()
