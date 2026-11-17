#!/usr/bin/env python3
"""
Deterministic offline production builder for After the tide.
Generates:
1. dist/ (dist/index.html, dist/assets/index-<hash>.js, dist/assets/index-<hash>.css)
2. Play_After_The_Tide.html (self-contained standalone HTML artifact with inlined CSS + JS)
"""
import hashlib
import json
import os
import re
import shutil

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_PATH = os.path.join(PROJECT_DIR, "scripts", "vendor-three-iife.js")

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def strip_known_module_syntax(filename: str, code: str) -> str:
    lines = code.splitlines()
    out = []
    for ln in lines:
        s = ln.strip()
        if s == "import * as THREE from 'three';":
            continue
        if s == "import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';":
            continue
        if s == "import './style.css';":
            continue
        if re.match(r"^import\s+\{[^}]+\}\s+from\s+'\./(game|save|audio|world|interaction|i18n)\.js';$", s):
            continue
        if s.startswith("import ") or s.startswith("import{"):
            raise RuntimeError(f"Unrecognized import in {filename}: {ln}")

        ln = re.sub(r"^(\s*)export\s+(const|let|function|class)\s+", r"\1\2 ", ln)
        if re.match(r"^\s*export\s+", ln):
            raise RuntimeError(f"Residual export in {filename}: {ln}")
        out.append(ln)
    return "\n".join(out)

def build():
    if not os.path.exists(SEED_PATH):
        raise RuntimeError(f"Missing vendored engine seed: {SEED_PATH}")
    with open(SEED_PATH, "r", encoding="utf-8") as f:
        vendor_iife = f.read()

    module_order = [
        "src/i18n.js",
        "src/game.js",
        "src/save.js",
        "src/audio.js",
        "src/interaction.js",
        "src/world.js",
        "src/main.js",
    ]
    hashes = {}
    transformed_chunks = []

    for rel in module_order:
        full = os.path.join(PROJECT_DIR, rel)
        with open(full, "rb") as fb:
            raw = fb.read()
        hashes[rel] = sha256_bytes(raw)
        transformed = strip_known_module_syntax(rel, raw.decode("utf-8"))
        transformed_chunks.append(f"// === MODULE: {rel} (sha256: {hashes[rel][:16]}) ===\n" + transformed)

    css_path = os.path.join(PROJECT_DIR, "src", "style.css")
    with open(css_path, "rb") as fb:
        css_bytes = fb.read()
    hashes["src/style.css"] = sha256_bytes(css_bytes)
    css_str = css_bytes.decode("utf-8")

    html_path = os.path.join(PROJECT_DIR, "index.html")
    with open(html_path, "rb") as fb:
        html_bytes = fb.read()
    hashes["index.html"] = sha256_bytes(html_bytes)

    app_body = "\n\n".join(transformed_chunks)
    for i, ln in enumerate(app_body.splitlines(), 1):
        if re.match(r"^\s*(import|export)\b", ln):
            raise RuntimeError(f"Residual module keyword at line {i}: {ln}")

    manifest_json = json.dumps(hashes, sort_keys=True)
    full_js = (
        f"/* After the tide offline production bundle | sources: {manifest_json} */\n"
        + vendor_iife
        + "\n(() => {\n"
        + "const THREE = __THREE_BUNDLE__;\n"
        + "const { mergeGeometries } = __THREE_BUNDLE__;\n\n"
        + app_body
        + "\n})();\n"
    )
    if "</script" in full_js.lower():
        raise RuntimeError("Unexpected </script substring inside JS bundle")

    js_bytes = full_js.encode("utf-8")
    js_hash = sha256_bytes(js_bytes)[:8]
    css_hash = sha256_bytes(css_bytes)[:8]

    js_filename = f"index-{js_hash}.js"
    css_filename = f"index-{css_hash}.css"

    html_str = html_bytes.decode("utf-8")
    script_tag = '<script type="module" src="/src/main.js"></script>'
    if script_tag not in html_str:
        raise RuntimeError("Missing /src/main.js script tag in index.html")

    # 1. Standard HTTP production dist/
    dist_html = html_str.replace(
        "</head>",
        f'  <script type="module" crossorigin src="/assets/{js_filename}"></script>\n'
        f'  <link rel="stylesheet" crossorigin href="/assets/{css_filename}">\n</head>'
    ).replace(script_tag, "")

    dist_dir = os.path.join(PROJECT_DIR, "dist")
    assets_dir = os.path.join(dist_dir, "assets")
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    os.makedirs(assets_dir, exist_ok=True)

    with open(os.path.join(assets_dir, js_filename), "wb") as fw:
        fw.write(js_bytes)
    with open(os.path.join(assets_dir, css_filename), "wb") as fw:
        fw.write(css_bytes)
    with open(os.path.join(dist_dir, "index.html"), "w", encoding="utf-8") as fw:
        fw.write(dist_html)

    # 2. Standalone self-contained Play_After_The_Tide.html (no server or dependencies required)
    standalone_html = html_str.replace(
        "</head>",
        f"  <style>\n{css_str}\n  </style>\n</head>"
    ).replace(
        script_tag,
        f"<script type=\"module\">\n{full_js}\n</script>"
    )
    standalone_path = os.path.join(PROJECT_DIR, "Play_After_The_Tide.html")
    with open(standalone_path, "w", encoding="utf-8") as fw:
        fw.write(standalone_html)

    print(f"BUILD OK: dist/index.html, dist/assets/{js_filename} ({len(js_bytes)} B), dist/assets/{css_filename} ({len(css_bytes)} B)")
    print(f"STANDALONE OK: Play_After_The_Tide.html ({os.path.getsize(standalone_path)} B)")
    print("SOURCE HASHES:", json.dumps(hashes, indent=2))

if __name__ == "__main__":
    build()
