"""Compare the extracted compiler against a pinned local Rain source snapshot."""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
from adapters.renpy.compiler import render_story
from adapters.renpy.story_model import enumerate_routes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rain_snapshot', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    root = args.rain_snapshot
    read = lambda path: json.loads((root / path).read_text(encoding='utf-8'))
    spec = importlib.util.spec_from_file_location('upstream_story_model', root / 'tools/story_model.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Evaluate only the three original compiler functions, removing host imports.
    tree = ast.parse((root / 'tools/compile_story.py').read_text(encoding='utf-8'))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {'quote', 'condition_expression', 'render_story'}]
    namespace = dict(json=json, hashlib=hashlib, enumerate_routes=module.enumerate_routes)
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(root / 'tools/compile_story.py'), 'exec'), namespace)
    story = read('game/data/story.json')
    inputs = (story, read('game/data/asset_manifest.json')['assets'], read('game/data/voice_manifest.json')['voices'], read('game/data/full_voice_manifest.json')['clips'])
    native = namespace['render_story'](*inputs)
    extracted = render_story(*inputs)
    assert native == extracted, 'RenPy script or image declarations changed'
    routes = enumerate_routes(story)
    assert not routes['errors'], routes['errors']
    report = dict(repository='Rain', scenes=len(story['nodes']), routes=len(routes['routes']), script_sha256=hashlib.sha256(extracted[0].encode()).hexdigest(), result='passed', execution='compiler parity only; RenPy SDK and Windows not executed')
    if args.out:
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
