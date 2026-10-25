"""Rebuild the renamed OFL subset used by Studio's own Chinese interface."""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('font', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
paths = list((root / 'editor').rglob('*')) + list((root / 'src').rglob('*.ts')) + list((root / 'examples/runtime').rglob('*'))
text = ''.join(p.read_text(encoding='utf-8') for p in paths if p.suffix in {'.json', '.mjs', '.html', '.css', '.ts'})
font = TTFont(args.font)
options = subset.Options()
options.flavor = 'woff2'
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in {1, 4, 6, 16}:
        name = 'VNStudioSans-Regular' if record.nameID == 6 else 'VN Studio Sans'
        record.string = name.encode(record.getEncoding())
font.flavor = 'woff2'
font.save(root / 'editor/studio-font.woff2')
