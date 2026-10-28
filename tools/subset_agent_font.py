"""Build the renamed OFL font for independent AI interface examples."""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('font', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
paths = list((root / 'src').rglob('*.ts')) + [root / 'tools/agent-example.mjs', root / 'tools/package-game.mjs']
text = ''.join(p.read_text(encoding='utf-8') for p in paths)
font = TTFont(args.font)
missing = {c for c in text if ord(c) > 127 and ord(c) not in font.getBestCmap()}
# Authored examples must be legible even on hosts without Chinese system fonts.
example = (root / 'tools/agent-example.mjs').read_text(encoding='utf-8')
if any(c in example for c in missing):
    raise ValueError('Source font lacks example glyphs: ' + ''.join(sorted(missing)))
options = subset.Options()
options.flavor = 'woff2'
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in {1, 4, 6, 16}:
        name = 'VNAgentSans-Regular' if record.nameID == 6 else 'VN Agent Sans'
        record.string = name.encode(record.getEncoding())
font.flavor = 'woff2'
font.save(root / 'examples/agent/assets/agent.woff2')
