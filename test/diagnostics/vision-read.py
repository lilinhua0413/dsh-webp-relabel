#!/usr/bin/env python3
"""
Does the model actually SEE the image when WebP bytes are relabeled as image/png,
or does it just stop erroring? Ask it to read a word drawn into the image.
"""
import base64, io, json, os, urllib.request, urllib.error
from PIL import Image, ImageDraw

# Any OpenAI-compatible server. Override with env vars.
API_URL = os.environ.get("VISION_API_URL", "http://127.0.0.1:1234/v1/chat/completions")
API_KEY = os.environ.get("VISION_API_KEY", "not-needed")
MODEL = os.environ.get("VISION_MODEL", "qwen3.5-122b-a10b")
WORD = "BANANA"


def make_image():
    img = Image.new('RGB', (420, 160), color='white')
    d = ImageDraw.Draw(img)
    d.rectangle([5, 5, 414, 154], outline='black', width=4)
    # default PIL bitmap font scaled up by drawing at 3x into a temp image
    tmp = Image.new('RGB', (140, 40), color='white')
    td = ImageDraw.Draw(tmp)
    td.text((8, 12), WORD, fill='black')
    tmp = tmp.resize((420, 120), Image.NEAREST)
    img.paste(tmp, (0, 20))
    return img


def to_bytes(img, fmt):
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def ask(label, raw):
    url = f"data:{label};base64," + base64.b64encode(raw).decode()
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "Read the word written in this image. Reply with only that word, uppercase."},
            {"type": "image_url", "image_url": {"url": url}},
        ]}],
        "max_tokens": 400,
        "temperature": 0,
    }
    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = json.loads(r.read().decode())
        msg = body['choices'][0]['message']
        return True, msg
    except urllib.error.HTTPError as e:
        return False, e.read().decode()[:200]
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


img = make_image()
for title, label, raw in [
    ("png  bytes + image/png (control)", 'image/png', to_bytes(img, 'PNG')),
    ("webp bytes + image/png (relabel)", 'image/png', to_bytes(img, 'WEBP')),
]:
    ok, msg = ask(label, raw)
    if ok:
        content = (msg.get('content') or '').strip()
        reasoning = (msg.get('reasoning_content') or msg.get('reasoning') or '').strip()
        print(f"HTTP200 | {title}")
        print(f"        content={content[:200]!r}")
        if reasoning:
            print(f"        reasoning={reasoning[:300]!r}")
    else:
        print(f"HTTPERR | {title} | {msg}")
    print()
