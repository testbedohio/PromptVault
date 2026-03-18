#!/usr/bin/env python3
"""
Generate PromptVault app icons for all platforms by resizing a source PNG.

Requirements:
    pip3 install Pillow

Usage:
    python3 scripts/generate_icons.py
"""

import os
from PIL import Image


# Source icon (2000x2000 RGB PNG) — converted to RGBA for output.
SOURCE_ICON = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "PromptVault_Icon.png",
)


def load_source() -> Image.Image:
    """Load the source icon, crop to content, and convert to RGBA."""
    img = Image.open(SOURCE_ICON)
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # Crop to the bounding box of non-transparent content (removes surrounding whitespace/black)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    # Make square by padding the shorter axis with transparency
    w, h = img.size
    if w != h:
        side = max(w, h)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.paste(img, ((side - w) // 2, (side - h) // 2))
        img = square

    return img


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    icons_dir = os.path.join(project_root, "src-tauri", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    source = load_source()
    print(f"Source: {SOURCE_ICON}  ({source.size[0]}x{source.size[1]} {source.mode})\n")

    # PNG targets
    targets = [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),
    ]

    for size, filename in targets:
        resized = source.resize((size, size), Image.LANCZOS)
        path = os.path.join(icons_dir, filename)
        resized.save(path, "PNG")
        print(f"  {filename:20s} {size}x{size}  ({os.path.getsize(path)} bytes)")

    # ICO (Windows) — multi-resolution
    # Pillow's ICO writer needs the largest image saved with sizes= to embed
    # multiple resolutions. It downscales internally, but we pre-resize with
    # LANCZOS for best quality and pass all frames via append_images.
    ico_sizes = [16, 32, 48, 256]
    ico_images = [source.resize((s, s), Image.LANCZOS) for s in ico_sizes]
    ico_path = os.path.join(icons_dir, "icon.ico")
    # Save the 256px image as the base, append smaller ones.
    ico_images[-1].save(
        ico_path,
        format="ICO",
        append_images=ico_images[:-1],
    )
    print(f"  {'icon.ico':20s} multi   ({os.path.getsize(ico_path)} bytes)")

    print(f"\nIcons written to {icons_dir}")


if __name__ == "__main__":
    print("Generating PromptVault icons...\n")
    main()
