# Diagnostics

These scripts are the evidence behind the design decision this plugin makes:
**relabel, don't transcode**. They are not part of the shipped plugin and are not
run by `npm test`.

They need network access to a live OpenAI-compatible vision server and, for
`make-alpha-image.py`, Pillow.

```sh
pip install pillow
export VISION_API_URL="http://127.0.0.1:1234/v1/chat/completions"   # default
export VISION_API_KEY="not-needed"                                  # default
export VISION_MODEL="qwen3.5-122b-a10b"                             # default
```

| Script | Question it answers |
|--------|---------------------|
| `relabel-vs-transcode.py` | Is the server validating the MIME **label** or the actual container? Sends the same bytes under four labels. If `webp bytes + image/png` passes, relabeling is sufficient and no image codec is needed. |
| `vision-read.py` | Does the model genuinely **see** a relabeled image, or does the request merely stop erroring? Asks the model to read text drawn into the image. |
| `image-format.py` | Which formats (`png` / `jpeg` / `webp`) this exact server accepts at all. |
| `make-alpha-image.py` | Produces the alpha-channel PNG that DSH normalizes to WebP — the input that triggers the bug. |

Typical session:

```sh
python3 make-alpha-image.py alpha-word.png BANANA
python3 relabel-vs-transcode.py
python3 vision-read.py
```

On LM Studio / llama.cpp the first script reports:

```
FAIL | A webp bytes + image/webp  | {"error":"'url' field must be a base64 encoded image."}
PASS | B webp bytes + image/png   |
PASS | C png  bytes + image/png   |
FAIL | D png  bytes + image/webp  | {"error":"'url' field must be a base64 encoded image."}
```

That is: only the label matters.
