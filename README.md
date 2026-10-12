# dsh-webp-relabel

Relabels DSH's normalized WebP request images as PNG, so local OpenAI-compatible
vision servers accept them.

English | [简体中文](#简体中文)

## The problem

You paste a screenshot into DeepSeek Harness, pick a local vision model, and the
request dies with:

```
'url' field must be a base64 encoded image.
```

The image is fine. The **label** is not.

## Why it happens

DSH normalizes attachments before storing them, and `dsh-attachment-local` picks
the container from the alpha channel:

```js
const mediaType = hasAlpha ? "image/webp" : "image/jpeg";
```

Screenshots have an alpha channel, so they are stored as WebP. The request-image
ladder only ever emits `alpha:webp` or `opaque:jpeg` — there is no PNG rung and no
configuration option for this.

`dsh-llm-pi-ai` then builds the OpenAI `image_url` payload straight from the
prepared request image:

```js
mimeType: version.mediaType,               // "image/webp"
data: Buffer.from(version.data).toString("base64"),
```

so the wire payload becomes `data:image/webp;base64,...`. LM Studio / llama.cpp
validate that label against a PNG/JPEG allowlist and reject the whole call —
even though the bytes decode perfectly well.

## How it works

Wrap `attachments.readImageRequest()` and return **the same bytes** under a
compatible label:

```js
return { ...version, mediaType: 'image/png' };
```

Measured against LM Studio with `test/diagnostics/relabel-vs-transcode.py`:

| Payload | Result |
|---------|--------|
| webp bytes + `image/webp` | **HTTP 400** `'url' field must be a base64 encoded image.` |
| webp bytes + `image/png`  | **HTTP 200**, image correctly understood |
| png bytes + `image/png`   | HTTP 200 |
| png bytes + `image/webp`  | **HTTP 400** |

Only the label is validated, so no image transcoding is needed.
`test/diagnostics/vision-read.py` confirms the model really sees the image:
it reads a word drawn into a WebP image sent as `image/png`.

Three implementation details matter, and each was verified rather than assumed:

- **Why not rewrite the request messages?** The adapter takes the label from
  `readImageRequest(...).mediaType`, not from the message's
  `ImageBlock.attachment.mediaType`. Rewriting messages changes nothing.
- **Why is a service patch picked up immediately?** The adapter resolves the
  service per call (`resolveAttachments: () => ctx.get("attachments")`), so
  wrapping the method affects the very next request — no restart, no new session.
- **Why the prototype instead of the instance?** `ctx.get()` returns a Cordis
  "traceable" `Proxy` whose `set` trap routes through an extra shadow receiver, so
  an instance-level write is not reliably observable. A property on the prototype
  is always found by the proxy's own descriptor walk.

The model-visible attachment handle text is unaffected: it is built from
`ref.mediaType`, not `version.mediaType`, so it still describes the stored WebP
accurately.

## Install

### From a release tarball (no registry needed)

Download `dsh-webp-relabel-1.0.0.tgz` from the repository's Releases page, then:

```sh
dsh plugin --profile <your-profile> add /path/to/dsh-webp-relabel-1.0.0.tgz
```

### From npm

```sh
dsh plugin --profile <your-profile> add dsh-webp-relabel
```

### From a local checkout (verified)

Point the plugin manager at the directory:

```
plugin_manager install_bundle   target = link:/absolute/path/to/dsh-webp-relabel
```

The package is then registered as a link dependency, and its own
`cordis.patch.yml` supplies the loader row — so installing the bundle is the only
step. (Observed on DSH `0.2.1-alpha.2`: `install_bundle` does **not** insert a row
by itself, which is why this bundle ships its own.)

Installing entirely by hand instead? Add the row to your profile's
`cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-webp-relabel
      name: 'dsh-webp-relabel'
```

## Configuration

The bundle already applies these defaults; add this block to your profile's
`cordis.patch.yml` only to override them:

```yaml
- id: dsh-webp-relabel
  name: 'dsh-webp-relabel'
  config:
    from: image/webp     # label to replace (default)
    to: image/png        # replacement label (default)
    debug: true          # log one line per relabeled image (default)
```

## Verify it works

With `debug: true` the DSH console prints one line per relabeled image:

```
[dsh-webp-relabel] relabel #1: image/webp -> image/png (1200x800px, 84521B, ref sha256:...)
```

You can also check the model server's own request log: the payload should contain
`"url": "data:image/png;base64,..."` rather than `image/webp`.

## Disable / uninstall

Disable the plugin in the DSH plugin manager, or set `to: image/webp` in the
config. Either way the original `readImageRequest` is restored from the saved
descriptor — the patch is fully reversible.

## Limitations

- **The label does not match the container.** The bytes stay WebP while the label
  says PNG. This is correct for servers that validate the label (LM Studio,
  llama.cpp). A provider that strictly validates magic bytes would still reject
  it, and the right fix there is real transcoding (`sharp`, `sips`) rather than
  relabeling.
- **It applies to every provider,** because `readImageRequest()` cannot see which
  route the call is going to. Scoping it to local routes would need an extra
  `llm/stream` listener keyed by `options.provider`.
- **It depends on DSH internals:** the `attachments` service, its
  `readImageRequest` method, and that method being a class method on the
  prototype. If a DSH upgrade breaks it, those are the two things to check.

## Development

```sh
npm test
```

Seven cases in `test/plugin-patch.test.mjs`, covering the relabel itself, that the
patch survives a Cordis-style traceable `Proxy`, that non-WebP labels pass
through untouched, that disposing restores the original method (including when it
is inherited from a base class), configurable targets, and idempotent re-apply.

`test/diagnostics/` holds the server-side probes described above.

---

## 简体中文

把 DSH 归一化出来的 WebP 请求图片**重标记为 PNG**，让本地 OpenAI 兼容的视觉模型愿意收下它。

### 问题

在聊天窗口粘贴截图、选一个本地视觉模型，请求直接失败：

```
'url' field must be a base64 encoded image.
```

图片本身没问题，**标签**不对。

### 原因

`dsh-attachment-local` 归一化时按 alpha 通道选容器：

```js
const mediaType = hasAlpha ? "image/webp" : "image/jpeg";
```

截图带 alpha，于是被存成 WebP；请求图档（ladder）只有 `alpha:webp` 和
`opaque:jpeg` 两级，没有 PNG，也没有对应配置项。

`dsh-llm-pi-ai` 再把 `version.mediaType` 直接写进 OpenAI 的 `image_url`：

```js
mimeType: version.mediaType,               // "image/webp"
data: Buffer.from(version.data).toString("base64"),
```

于是线上载荷变成 `data:image/webp;base64,...`。LM Studio / llama.cpp 只允许
PNG/JPEG 标签，整条请求被拒——而字节本身完全能解码。

### 做法

包装 `attachments.readImageRequest()`，**字节一个不改**，只换标签：

```js
return { ...version, mediaType: 'image/png' };
```

实测（`test/diagnostics/relabel-vs-transcode.py`，LM Studio）：

| 载荷 | 结果 |
|------|------|
| webp 字节 + `image/webp` | **HTTP 400** `'url' field must be a base64 encoded image.` |
| webp 字节 + `image/png`  | **HTTP 200**，图片被正确理解 |
| png 字节 + `image/png`   | HTTP 200 |
| png 字节 + `image/webp`  | **HTTP 400** |

即**只校验标签**，所以不需要真的转码。`test/diagnostics/vision-read.py` 进一步确认模型
是"真看见了"：让它读一张以 `image/png` 名义发出的 WebP 图上的字，能读对。

三个关键点都是核实过的，不是推测：

- **为什么不改请求消息？** 适配器的标签来自 `readImageRequest(...).mediaType`，
  不是消息块的 `ImageBlock.attachment.mediaType`，改消息没有任何作用。
- **为什么打补丁立刻生效？** 适配器每次请求都重新解析服务
  （`resolveAttachments: () => ctx.get("attachments")`），所以下一次请求就走新方法，
  不用重启、不用新会话。
- **为什么打在原型而不是实例上？** `ctx.get()` 返回 Cordis 的 "traceable" `Proxy`，
  实例级写入会被 shadow receiver 吞掉；原型属性一定会被 Proxy 的描述符查找命中。

模型可见的图片句柄文案不受影响：它取自 `ref.mediaType` 而不是 `version.mediaType`，
所以仍然准确描述存储的 WebP。

### 安装

本地目录（已实测）：

```
plugin_manager install_bundle   target = link:/绝对路径/dsh-webp-relabel
```

手工安装则在 profile 的 `cordis.patch.yml` 里加一行：

```yaml
- insert:
    - id: dsh-webp-relabel
      name: 'dsh-webp-relabel'
```

### 配置（可选）

```yaml
- id: dsh-webp-relabel
  name: 'dsh-webp-relabel'
  config:
    from: image/webp     # 被替换的标签
    to: image/png        # 替换成的标签
    debug: true          # 每张图打印一行日志
```

### 验证

`debug: true` 时 DSH 控制台会打印：

```
[dsh-webp-relabel] relabel #1: image/webp -> image/png (1200x800px, 84521B, ref sha256:...)
```

或看模型服务器日志：载荷里应是 `"url": "data:image/png;base64,..."`。

### 关闭

在插件管理器里停用，或把 `to` 改回 `image/webp`。停用时会用保存下来的描述符
还原原始方法，补丁完全可逆。

### 限制

- **标签与容器不一致**（字节仍是 WebP）。对"只校验标签"的服务器（LM Studio /
  llama.cpp）成立；若某 provider 严格校验 magic bytes，应改为真正转码
  （`sharp` / `sips`），而不是重标记。
- **对所有 provider 生效**，因为 `readImageRequest()` 看不到路由。要限定范围需额外在
  `llm/stream` 里按 `options.provider` 判断。
- **依赖 DSH 内部结构**：`attachments` 服务、`readImageRequest` 方法、以及它是原型上的
  类方法。DSH 升级后若失效，先查这两处。

---

## License

MIT
