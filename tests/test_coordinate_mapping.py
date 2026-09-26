import unittest

import helpers  # noqa: F401
from calibration.coordinate_mapper import CoordinateMapper


class CoordinateMappingTests(unittest.TestCase):
    def test_mirror(self):
        mapper = CoordinateMapper(mirror_x=True)
        self.assertEqual(mapper.to_surface((0.2, 0.7)), (0.8, 0.7))

    def test_no_mirror(self):
        mapper = CoordinateMapper(mirror_x=False)
        self.assertEqual(mapper.to_surface((0.2, 0.7)), (0.2, 0.7))

    def test_round_trip(self):
        mapper = CoordinateMapper(mirror_x=True)
        point = (0.31, 0.64)
        back = mapper.to_camera(mapper.to_surface(point))
        self.assertAlmostEqual(back[0], point[0])
        self.assertAlmostEqual(back[1], point[1])


if __name__ == "__main__":
    unittest.main()
