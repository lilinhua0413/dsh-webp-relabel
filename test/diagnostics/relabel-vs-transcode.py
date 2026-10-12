#!/usr/bin/env python3
"""
Decide HOW to fix the WebP problem:
  A) webp bytes + label image/webp   (known failure)
  B) webp bytes + label image/png    (relabel-only fix)
  C) png  bytes + label image/png    (control)
  D) png  bytes + label image/webp   (does the label matter at all?)
If B passes -> relabeling is enough.
If B fails -> we must really transcode webp -> png.
"""
import base64, io, json, os, urllib.request, urllib.error
from PIL import Image, ImageDraw

# Any OpenAI-compatible server. Override with env vars.
API_URL = os.environ.get("VISION_API_URL", "http://127.0.0.1:1234/v1/chat/completions")
API_KEY = os.environ.get("VISION_API_KEY", "not-needed")
MODEL = os.environ.get("VISION_MODEL", "qwen3.5-122b-a10b")


def make_image():
    img = Image.new('RGB', (120, 120), color='lightblue')
    d = ImageDraw.Draw(img)
    d.ellipse([10, 10, 50, 50], fill='red')
    d.rectangle([60, 10, 110, 50], fill='green')
    d.polygon([[10, 70], [50, 110], [5, 110]], fill='blue')
    return img


def to_bytes(img, fmt):
    buf = io.BytesIO()
    if fmt == 'JPEG':
        img.save(buf, format=fmt, quality=85)
    else:
        img.save(buf, format=fmt)
    return buf.getvalue()


def magic(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'PNG'
    if data[:2] == b'\xff\xd8':
        return 'JPEG'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'WEBP'
    return '?'


def ask(label, raw):
    url = f"data:{label};base64," + base64.b64encode(raw).decode()
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "What shapes do you see? Answer in one short line."},
            {"type": "image_url", "image_url": {"url": url}},
        ]}],
        "max_tokens": 60,
    }
    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = json.loads(r.read().decode())
        return True, (body['choices'][0]['message']['content'] or '').strip()[:120]
    except urllib.error.HTTPError as e:
        return False, e.read().decode()[:200]
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


img = make_image()
webp = to_bytes(img, 'WEBP')
png = to_bytes(img, 'PNG')

cases = [
    ("A webp bytes + image/webp", 'image/webp', webp),
    ("B webp bytes + image/png ", 'image/png', webp),
    ("C png  bytes + image/png ", 'image/png', png),
    ("D png  bytes + image/webp", 'image/webp', png),
]

print(f"webp bytes: {len(webp)}B magic={magic(webp)} | png bytes: {len(png)}B magic={magic(png)}\n")
for title, label, raw in cases:
    ok, detail = ask(label, raw)
    print(f"{'PASS' if ok else 'FAIL'} | {title} | {detail}")
