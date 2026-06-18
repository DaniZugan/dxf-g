#!/usr/bin/env python3
"""Convert simple 2D DXF files to the XXL CNC dialect used in the examples."""

from __future__ import annotations

import argparse
import datetime as _dt
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


EPS = 0.01
LEAD_RADIUS = 22.0
DOWEL_RADIUS = 4.0
DOWEL_RADIUS_TOLERANCE = 0.05


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def distance_to(self, other: "Point") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    def machine(self) -> "Point":
        return Point(self.x, -self.y)


@dataclass(frozen=True)
class Segment:
    kind: str
    start: Point
    end: Point
    center: Point | None = None
    ccw_dxf: bool = True

    def reversed(self) -> "Segment":
        return Segment(
            kind=self.kind,
            start=self.end,
            end=self.start,
            center=self.center,
            ccw_dxf=not self.ccw_dxf,
        )

    def length(self) -> float:
        if self.kind == "LINE" or self.center is None:
            return self.start.distance_to(self.end)
        r = self.center.distance_to(self.start)
        a0 = math.atan2(self.start.y - self.center.y, self.start.x - self.center.x)
        a1 = math.atan2(self.end.y - self.center.y, self.end.x - self.center.x)
        delta = a1 - a0
        if self.ccw_dxf and delta < 0:
            delta += math.tau
        if not self.ccw_dxf and delta > 0:
            delta -= math.tau
        return abs(delta) * r

    def split_at(self, distance: float) -> tuple[Point, "Segment"]:
        if self.kind != "LINE":
            raise ValueError("Only line segments can be split for lead-in")
        total = self.length()
        if total <= EPS:
            return self.start, self
        t = max(0.0, min(1.0, distance / total))
        point = Point(
            self.start.x + (self.end.x - self.start.x) * t,
            self.start.y + (self.end.y - self.start.y) * t,
        )
        return point, Segment("LINE", point, self.end)


@dataclass(frozen=True)
class Circle:
    center: Point
    radius: float


@dataclass
class Contour:
    segments: list[Segment]
    bbox: tuple[float, float, float, float]
    role: str


def fmt(value: float) -> str:
    if abs(value) < 0.0005:
        value = 0.0
    if abs(value - round(value)) < 0.0005:
        return str(int(round(value)))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def parse_dxf(path: Path) -> tuple[list[Circle], list[Segment]]:
    lines = path.read_text(errors="ignore").splitlines()
    pairs: list[tuple[str, str]] = []
    for i in range(0, len(lines) - 1, 2):
        pairs.append((lines[i].strip(), lines[i + 1].strip()))

    in_entities = False
    current_type: str | None = None
    current: dict[str, list[str]] = {}
    circles: list[Circle] = []
    segments: list[Segment] = []

    def values(code: str) -> list[str]:
        return current.get(code, [])

    def first_float(code: str, default: float = 0.0) -> float:
        vals = values(code)
        return float(vals[0]) if vals else default

    def flush() -> None:
        nonlocal current_type, current
        if current_type == "CIRCLE":
            circles.append(
                Circle(
                    center=Point(first_float("10"), first_float("20")),
                    radius=first_float("40"),
                )
            )
        elif current_type == "LINE":
            segments.append(
                Segment(
                    kind="LINE",
                    start=Point(first_float("10"), first_float("20")),
                    end=Point(first_float("11"), first_float("21")),
                )
            )
        elif current_type == "ARC":
            center = Point(first_float("10"), first_float("20"))
            radius = first_float("40")
            start_angle = math.radians(first_float("50"))
            end_angle = math.radians(first_float("51"))
            segments.append(
                Segment(
                    kind="ARC",
                    start=Point(
                        center.x + radius * math.cos(start_angle),
                        center.y + radius * math.sin(start_angle),
                    ),
                    end=Point(
                        center.x + radius * math.cos(end_angle),
                        center.y + radius * math.sin(end_angle),
                    ),
                    center=center,
                    ccw_dxf=True,
                )
            )
        elif current_type == "LWPOLYLINE":
            xs = [float(v) for v in values("10")]
            ys = [float(v) for v in values("20")]
            flags = int(float(values("70")[0])) if values("70") else 0
            points = [Point(x, y) for x, y in zip(xs, ys)]
            for a, b in zip(points, points[1:]):
                segments.append(Segment("LINE", a, b))
            if flags & 1 and len(points) > 1:
                segments.append(Segment("LINE", points[-1], points[0]))
        current_type = None
        current = {}

    for code, value in pairs:
        if code == "0":
            if value == "SECTION":
                flush()
                current_type = None
                current = {}
                continue
            if value == "ENDSEC":
                flush()
                in_entities = False
                continue
            if value == "EOF":
                flush()
                break
            if in_entities:
                flush()
                if value in {"CIRCLE", "LINE", "ARC", "LWPOLYLINE"}:
                    current_type = value
                    current = {}
                continue
        if code == "2" and value == "ENTITIES":
            in_entities = True
            continue
        if in_entities and current_type is not None:
            current.setdefault(code, []).append(value)

    flush()
    return circles, segments


def is_dowel_circle(circle: Circle) -> bool:
    return abs(circle.radius - DOWEL_RADIUS) <= DOWEL_RADIUS_TOLERANCE


def dowel_circles(circles: Sequence[Circle]) -> list[Circle]:
    return [circle for circle in circles if is_dowel_circle(circle)]


def bbox_of_segments(segments: Sequence[Segment]) -> tuple[float, float, float, float]:
    points: list[Point] = []
    for segment in segments:
        points.extend([segment.start, segment.end])
        if segment.kind == "ARC" and segment.center is not None:
            r = segment.center.distance_to(segment.start)
            points.extend(
                [
                    Point(segment.center.x - r, segment.center.y - r),
                    Point(segment.center.x + r, segment.center.y + r),
                ]
            )
    return (
        min(p.x for p in points),
        min(p.y for p in points),
        max(p.x for p in points),
        max(p.y for p in points),
    )


def bbox_area(bbox: tuple[float, float, float, float]) -> float:
    min_x, min_y, max_x, max_y = bbox
    return max(0.0, max_x - min_x) * max(0.0, max_y - min_y)


def point_in_bbox(point: Point, bbox: tuple[float, float, float, float], margin: float = 0.0) -> bool:
    min_x, min_y, max_x, max_y = bbox
    return (
        min_x - margin <= point.x <= max_x + margin
        and min_y - margin <= point.y <= max_y + margin
    )


def group_segments(segments: Sequence[Segment]) -> list[list[Segment]]:
    groups: list[list[Segment]] = []
    for segment in segments:
        placed = False
        endpoints = [segment.start, segment.end]
        for group in groups:
            if any(
                endpoint.distance_to(existing) <= EPS
                for endpoint in endpoints
                for member in group
                for existing in (member.start, member.end)
            ):
                group.append(segment)
                placed = True
                break
        if not placed:
            groups.append([segment])

    merged = True
    while merged:
        merged = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if any(
                    endpoint.distance_to(existing) <= EPS
                    for member in groups[i]
                    for endpoint in (member.start, member.end)
                    for other in groups[j]
                    for existing in (other.start, other.end)
                ):
                    groups[i].extend(groups.pop(j))
                    merged = True
                    break
            if merged:
                break
    return groups


def order_segments(group: Sequence[Segment]) -> list[Segment]:
    if not group:
        return []
    unused = list(group)
    ordered = [unused.pop(0)]
    while unused:
        tail = ordered[-1].end
        match_index = None
        reverse = False
        for index, candidate in enumerate(unused):
            if tail.distance_to(candidate.start) <= EPS:
                match_index = index
                break
            if tail.distance_to(candidate.end) <= EPS:
                match_index = index
                reverse = True
                break
        if match_index is None:
            ordered.extend(unused)
            break
        candidate = unused.pop(match_index)
        ordered.append(candidate.reversed() if reverse else candidate)
    return ordered


def reverse_path(path: Sequence[Segment]) -> list[Segment]:
    return [segment.reversed() for segment in reversed(path)]


def is_rect_like(path: Sequence[Segment]) -> bool:
    if not path:
        return False
    for segment in path:
        if segment.kind == "LINE":
            same_x = abs(segment.start.x - segment.end.x) <= EPS
            same_y = abs(segment.start.y - segment.end.y) <= EPS
            if not (same_x or same_y):
                return False
        elif segment.kind != "ARC":
            return False
    return True


def classify_contours(circles: Sequence[Circle], segments: Sequence[Segment]) -> tuple[tuple[float, float, float, float] | None, list[Contour]]:
    groups = [order_segments(group) for group in group_segments(segments)]
    groups = [group for group in groups if group]
    if not groups:
        return None, []

    bboxes = [bbox_of_segments(group) for group in groups]
    stock_index = max(range(len(groups)), key=lambda i: bbox_area(bboxes[i]))
    stock_bbox = bboxes[stock_index]
    contours: list[Contour] = []

    for index, group in enumerate(groups):
        bbox = bboxes[index]
        if index == stock_index and len(groups) > 1:
            continue
        if index == stock_index and len(groups) == 1 and circles:
            continue

        area = bbox_area(bbox)
        stock_area = bbox_area(stock_bbox)
        holes_inside = sum(1 for circle in circles if point_in_bbox(circle.center, bbox, margin=EPS))
        role = "external"
        if stock_area and area < stock_area * 0.75 and holes_inside == 0:
            role = "internal"
            group = reverse_path(group)
        contours.append(Contour(segments=list(group), bbox=bbox, role=role))

    return stock_bbox, contours


def snake_sorted_circles(circles: Sequence[Circle]) -> list[Circle]:
    columns: dict[int, list[Circle]] = {}
    for circle in circles:
        key = int(round(circle.center.x * 1000))
        columns.setdefault(key, []).append(circle)

    result: list[Circle] = []
    for column_index, key in enumerate(sorted(columns)):
        column = columns[key]
        column.sort(key=lambda c: c.center.y, reverse=bool(column_index % 2))
        result.extend(column)
    return result


def depth_passes(cut_depth: float, max_pass_depth: float) -> list[float]:
    if cut_depth <= 0:
        return []
    if max_pass_depth <= 0 or cut_depth <= max_pass_depth:
        return [cut_depth]
    passes: list[float] = []
    current = max_pass_depth
    while current < cut_depth:
        passes.append(current)
        current += max_pass_depth
    passes.append(cut_depth)
    return passes


def unit_vector(a: Point, b: Point) -> Point:
    length = a.distance_to(b)
    if length <= EPS:
        return Point(1.0, 0.0)
    return Point((b.x - a.x) / length, (b.y - a.y) / length)


def left_normal(vector: Point) -> Point:
    return Point(-vector.y, vector.x)


def lead_points(cut_start: Point, next_point: Point, radius: float = LEAD_RADIUS) -> tuple[Point, Point]:
    direction = unit_vector(cut_start, next_point)
    normal = left_normal(direction)
    center = Point(cut_start.x + normal.x * radius, cut_start.y + normal.y * radius)
    start = Point(center.x - direction.x * radius, center.y - direction.y * radius)
    return start, center


def rect_path(contour: Contour) -> list[Point]:
    min_x, min_y, max_x, max_y = contour.bbox
    width = max_x - min_x
    height = max_y - min_y
    if contour.role == "internal":
        start_y = min_y + height * 0.68283
        return [
            Point(min_x, start_y),
            Point(min_x, max_y),
            Point(max_x, max_y),
            Point(max_x, min_y),
            Point(min_x, min_y),
            Point(min_x, start_y),
        ]
    start_x = min_x + width * 0.28
    return [
        Point(start_x, min_y),
        Point(max_x, min_y),
        Point(max_x, max_y),
        Point(min_x, max_y),
        Point(min_x, min_y),
        Point(start_x, min_y),
    ]


def rotate_to_long_line(path: Sequence[Segment]) -> tuple[list[Segment], Point | None]:
    line_indexes = [i for i, segment in enumerate(path) if segment.kind == "LINE" and segment.length() > EPS]
    if not line_indexes:
        return list(path), None
    start_index = max(line_indexes, key=lambda i: path[i].length())
    rotated = list(path[start_index:]) + list(path[:start_index])
    split_distance = max(LEAD_RADIUS * 2.0, rotated[0].length() * 0.28)
    split_point, first_segment = rotated[0].split_at(split_distance)
    rotated[0] = first_segment
    return rotated, split_point


def emit_point(prefix: str, point: Point, z: float, extra: str = "") -> str:
    machine = point.machine()
    suffix = f" {extra}" if extra else ""
    return f"{prefix} X={fmt(machine.x)} Y={fmt(machine.y)} Z={fmt(z)}{suffix}"


def emit_contour(contour: Contour, z: float, cutter_d: int) -> list[str]:
    lines: list[str] = []
    if is_rect_like(contour.segments):
        points = rect_path(contour)
        cut_start = points[0]
        next_point = points[1]
        lead_start, lead_center = lead_points(cut_start.machine(), next_point.machine())
        cut_start_m = cut_start.machine()
        lines.append(
            f"XG0 X={fmt(lead_start.x)} Y={fmt(lead_start.y)} Z={fmt(z)} V=2 T=1 P=0 D={cutter_d} C=1 s=0"
        )
        lines.append(
            f"XA2P X={fmt(cut_start_m.x)} Y={fmt(cut_start_m.y)} Z={fmt(z)} "
            f"I={fmt(lead_center.x)} J={fmt(lead_center.y)} G=2 V=6"
        )
        for point in points[1:]:
            lines.append(emit_point("XL2P", point, z))
        lead_end = Point(lead_center.x + (lead_center.x - lead_start.x), lead_center.y + (lead_center.y - lead_start.y))
        lines.append(
            f"XA2P X={fmt(lead_end.x)} Y={fmt(lead_end.y)} Z={fmt(z)} "
            f"I={fmt(lead_center.x)} J={fmt(lead_center.y)} G=2"
        )
        return lines

    path, split_point = rotate_to_long_line(contour.segments)
    if split_point is None:
        return []
    cut_start = split_point
    next_point = path[0].end
    lead_start, lead_center = lead_points(cut_start.machine(), next_point.machine())
    cut_start_m = cut_start.machine()
    lines.append(
        f"XG0 X={fmt(lead_start.x)} Y={fmt(lead_start.y)} Z={fmt(z)} V=2 T=1 P=0 D={cutter_d} C=1 s=0"
    )
    lines.append(
        f"XA2P X={fmt(cut_start_m.x)} Y={fmt(cut_start_m.y)} Z={fmt(z)} "
        f"I={fmt(lead_center.x)} J={fmt(lead_center.y)} G=2 V=6"
    )
    for segment in path:
        if segment.kind == "LINE":
            lines.append(emit_point("XL2P", segment.end, z))
        elif segment.kind == "ARC" and segment.center is not None:
            end = segment.end.machine()
            center = segment.center.machine()
            g = 2 if segment.ccw_dxf else 3
            lines.append(
                f"XA2P X={fmt(end.x)} Y={fmt(end.y)} Z={fmt(z)} "
                f"I={fmt(center.x)} J={fmt(center.y)} G={g}"
            )
    lead_end = Point(lead_center.x + (lead_center.x - lead_start.x), lead_center.y + (lead_center.y - lead_start.y))
    lines.append(
        f"XA2P X={fmt(lead_end.x)} Y={fmt(lead_end.y)} Z={fmt(z)} "
        f"I={fmt(lead_center.x)} J={fmt(lead_center.y)} G=2"
    )
    return lines


def emit_section(title: str) -> list[str]:
    return [
        ";******************************",
        f"; {title}",
        ";******************************",
        "; ",
        "O X=0 Y=0 Z=0 F=1 ;Offset",
        "; ",
    ]


def generate_xxl(
    dxf_path: Path,
    *,
    thickness: float | None = None,
    cut_depth: float | None = None,
    drill_depth: float | None = None,
    max_pass_depth: float = 10.0,
    cam_name: str | None = None,
) -> str:
    circles, segments = parse_dxf(dxf_path)
    dowels = dowel_circles(circles)
    stock_bbox, contours = classify_contours(dowels, segments)
    external_contours = [contour for contour in contours if contour.role == "external"]
    internal_contours = [contour for contour in contours if contour.role == "internal"]

    if cut_depth is None:
        cut_depth = thickness + 2.0 if thickness is not None else 20.0
    if drill_depth is None:
        drill_depth = thickness if thickness is not None else 10.0

    dx = dy = 0.0
    if stock_bbox is not None and external_contours:
        min_x, min_y, max_x, max_y = stock_bbox
        dx = max_x - min_x
        dy = max_y - min_y
    dz = thickness or 0.0
    name = cam_name or dxf_path.stem.upper().replace(" DXF", "")
    today = _dt.date.today().strftime("%d-%b-%Y").upper()

    output: list[str] = [
        f'H DX={fmt(dx)} DY={fmt(dy)} DZ={fmt(dz)}-IL C=0 T=16973825 R=999 *MM /"def" BX=0 BY={fmt(dy)} BZ=0 V=10',
        ";****************************************************************************",
        f";CAM_FileName: {name}",
        f";Datum XXL datoteke: {today}",
        ";DXF direct generator: dxf_to_xxl.py",
        ";T1=REZKAR 20MM",
        ";T2=SVEDER 8MM",
        ";****************************************************************************",
        "IX=0",
        "IY=0;",
        "ROT A=0 X=0 Y=0",
        "PL X=0 Y=0 Z=0 Q=0 R=0",
        ";",
        "C=0",
        "F=1",
        ";Tilt Plane - POS 1",
        "PL X=0 Y=0 Z=0 Q=0 R=0",
    ]

    if external_contours:
        output.extend(emit_section("kontura okoli"))
        for contour in external_contours:
            for z in depth_passes(cut_depth, max_pass_depth):
                output.extend(emit_contour(contour, z, cutter_d=25))
        output.append(";******************************")

    if dowels:
        if external_contours:
            output.extend(
                [
                    ";Tilt Plane - POS 1",
                    "PL X=0 Y=0 Z=0 Q=0 R=0",
                ]
            )
        output.extend(emit_section("luknje za moznike"))
        for circle in snake_sorted_circles(dowels):
            center = circle.center.machine()
            output.append(
                f"B X={fmt(center.x)} Y={fmt(center.y)} Z={fmt(drill_depth)} "
                "V=2 S=3500 Q=0 R=1 x=0 y=0 D=2 G=1 T=2"
            )
        output.append(";******************************")

    if internal_contours:
        output.extend(
            [
                ";Tilt Plane - POS 1",
                "PL X=0 Y=0 Z=0 Q=0 R=0",
            ]
        )
        output.extend(emit_section("izrez notri"))
        for contour in internal_contours:
            for z in depth_passes(cut_depth, max_pass_depth):
                output.extend(emit_contour(contour, z, cutter_d=43))
        output.append(";******************************")

    output.extend(
        [
            ";**********************************************************",
            ";END",
            ";**********************************************************",
            "F=1",
            "N X=0",
        ]
    )
    return "\n".join(output) + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convert a simple 2D DXF to CNC XXL G-code.")
    parser.add_argument("input", type=Path, help="Input DXF file")
    parser.add_argument("-o", "--output", type=Path, help="Output .xxl file")
    parser.add_argument("--thickness", type=float, help="Material thickness in mm")
    parser.add_argument("--cut-depth", type=float, help="Final milling depth in mm. Defaults to thickness + 2, or 20.")
    parser.add_argument("--drill-depth", type=float, help="Drilling depth in mm. Defaults to thickness, or 10.")
    parser.add_argument(
        "--max-pass-depth",
        type=float,
        default=10.0,
        help="Maximum Z depth per milling pass. Use 0 for one pass. Default: 10.",
    )
    parser.add_argument("--name", help="CAM_FileName value in the header")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    output = generate_xxl(
        args.input,
        thickness=args.thickness,
        cut_depth=args.cut_depth,
        drill_depth=args.drill_depth,
        max_pass_depth=args.max_pass_depth,
        cam_name=args.name,
    )
    if args.output:
        args.output.write_text(output)
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
