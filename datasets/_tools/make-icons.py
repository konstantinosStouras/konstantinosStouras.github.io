"""Rebuild the library's own typographic icons (Pillow, Georgia font)."""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('--font', required=True, help='Path to Georgia regular TTF')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
icon = Image.new('RGB', (1024, 1024), '#164f46')
draw = ImageDraw.Draw(icon)
font = ImageFont.truetype(args.font, 830)
box = draw.textbbox((0, 0), 'd.', font=font)
draw.text(((1024-(box[2]-box[0]))/2-box[0], (1024-(box[3]-box[1]))/2-box[1]-25),
          'd.', font=font, fill='#fffdf6')
for size, name in [(16,'favicon-16.png'), (32,'favicon-32.png'),
                   (180,'apple-touch-icon.png'), (192,'icon-192.png'), (512,'icon-512.png')]:
    icon.resize((size,size), Image.Resampling.LANCZOS).save(root/name, optimize=True)
icon.save(root/'favicon.ico', sizes=[(16,16),(32,32),(48,48)])
print('Generated six library icon files.')
