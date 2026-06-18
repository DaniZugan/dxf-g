from pathlib import Path
import unittest

from dxf_to_xxl import dowel_circles, generate_xxl, parse_dxf


ROOT = Path(__file__).resolve().parents[1]


class DxfToXxlTests(unittest.TestCase):
    def test_part1_drill_holes_are_parsed(self):
        circles, segments = parse_dxf(ROOT / "Examples" / "part1.DXF")

        self.assertEqual(len(circles), 12)
        self.assertEqual(len(dowel_circles(circles)), 12)
        self.assertEqual(len(segments), 4)

    def test_part2_generates_external_cut_and_drilling(self):
        output = generate_xxl(
            ROOT / "Examples" / "part2 dxf.DXF",
            thickness=18,
            max_pass_depth=0,
            cam_name="PART2",
        )

        self.assertIn("H DX=510 DY=210 DZ=18-IL", output)
        self.assertIn('BX=0 BY=210 BZ=0', output.splitlines()[0])
        self.assertIn("; kontura okoli", output)
        self.assertIn("XG0 X=123 Y=17 Z=20 V=2 T=1 P=0 D=25 C=1 s=0", output)
        self.assertEqual(output.count("\nB X="), 12)
        self.assertIn("B X=14 Y=-25 Z=18", output)

    def test_dowels_use_exact_drill_depth(self):
        output = generate_xxl(
            ROOT / "Examples" / "part2 dxf.DXF",
            thickness=18,
            drill_depth=12.5,
            max_pass_depth=0,
            cam_name="PART2",
        )

        drill_lines = [line for line in output.splitlines() if line.startswith("B X=")]
        self.assertEqual(len(drill_lines), 12)
        self.assertTrue(all(" Z=12.5 " in line for line in drill_lines))
        self.assertIn("XL2P X=505 Y=-5 Z=20", output)

    def test_part3_generates_drilling_and_internal_two_pass_cut(self):
        output = generate_xxl(
            ROOT / "Examples" / "part3.DXF",
            cut_depth=20,
            drill_depth=10,
            cam_name="PART3",
        )

        self.assertIn("; luknje za moznike", output)
        self.assertIn("; izrez notri", output)
        self.assertEqual(output.count("\nB X="), 12)
        self.assertIn("XG0 X=172 Y=-96.283 Z=10 V=2 T=1 P=0 D=43 C=1 s=0", output)
        self.assertIn("XG0 X=172 Y=-96.283 Z=20 V=2 T=1 P=0 D=43 C=1 s=0", output)


if __name__ == "__main__":
    unittest.main()
