#!/usr/bin/env python3
"""
Generate PromptVault app icons for all platforms.

Requirements:
    pip3 install Pillow

Usage:
    python3 scripts/generate_icons.py
"""

import math
import os
from PIL import Image, ImageDraw, ImageFont


def make_icon(size: int) -> Image.Image:
    """Generate a PromptVault hex icon at the given pixel size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle (Darcula accent blue)
    margin = int(size * 0.05)
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=(75, 110, 175),
    )

    # Hexagon
    cx, cy = size // 2, size // 2
    r = int(size * 0.32)
    hex_points = [
        (cx + r * math.cos(math.radians(60 * i - 30)),
         cy + r * math.sin(math.radians(60 * i - 30)))
        for i in range(6)
    ]
    draw.polygon(
        hex_points,
        fill=(92, 142, 214),
        outline=(169, 183, 198),
        width=max(1, size // 64),
    )

    # "P" in center
    font_size = int(size * 0.30)
    try:
        # Try common system font paths
        for font_path in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            "/System/Library/Fonts/Menlo.ttc",
            "/System/Library/Fonts/SFMono-Bold.otf",
            "C:/Windows/Fonts/consola.ttf",
        ]:
            if os.path.exists(font_path):
                font = ImageFont.truetype(font_path, font_size)
                break
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "P", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        (cx - tw // 2 - bbox[0], cy - th // 2 - bbox[1]),
        "P",
        fill=(255, 255, 255),
        font=font,
    )

    return img


def main():
    # Output directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    icons_dir = os.path.join(project_root, "src-tauri", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    # Generate PNGs at required sizes
    targets = [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),
    ]

    for size, filename in targets:
        img = make_icon(size)
        path = os.path.join(icons_dir, filename)
        img.save(path, "PNG")
        print(f"  {filename:20s} {size}x{size}  ({os.path.getsize(path)} bytes)")

    # Generate .ico (Windows) — multi-resolution
    ico_sizes = [16, 32, 48, 256]
    ico_images = [make_icon(s) for s in ico_sizes]
    ico_path = os.path.join(icons_dir, "icon.ico")
    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
        append_images=ico_images[1:],
    )
    print(f"  {'icon.ico':20s} multi   ({os.path.getsize(ico_path)} bytes)")

    print(f"\nIcons written to {icons_dir}")


if __name__ == "__main__":
    print("Generating PromptVault icons...\n")
    main()