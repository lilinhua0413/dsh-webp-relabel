/**
 * dsh-webp-relabel — relabel DSH's normalized WebP request images as PNG.
 *
 * WHY THIS EXISTS
 * ---------------
 * DSH normalizes an attached screenshot and stores it as WebP whenever the
 * source has an alpha channel (see `dsh-attachment-local`:
 * `mediaType = hasAlpha ? "image/webp" : "image/jpeg"`). At request time
 * `dsh-llm-pi-ai` builds the OpenAI `image_url` payload as
 *
 *     mimeType: version.mediaType          // <- "image/webp"
 *     data:     base64(version.data)
 *
 * so the wire payload becomes `data:image/webp;base64,...`. Some local
 * OpenAI-compatible servers (LM Studio / llama.cpp) validate that label against
 * a PNG/JPEG allowlist and reject the whole call with:
 *
 *     'url' field must be a base64 encoded image.
 *
 * even though the bytes themselves decode fine.
 *
 * THE FIX
 * -------
 * Wrap `attachments.readImageRequest()` and return the *same bytes* with a
 * compatible MIME label. Measured behaviour of the local server:
 *
 *     webp bytes + image/webp  -> HTTP 400
 *     webp bytes + image/png   -> HTTP 200, image correctly understood
 *     png  bytes + image/webp  -> HTTP 400
 *
 * i.e. only the label is validated, not the container. Verified by asking the
 * model to read text drawn into a WebP image sent as `image/png`.
 *
 * WHY THIS LAYER
 * --------------
 * `dsh-llm-pi-ai` takes the label from `readImageRequest(...).mediaType`, NOT
 * from the message's `ImageBlock.attachment.mediaType`, so rewriting request
 * messages would have no effect — and `readImageRequest` is reached through
 * `ctx.get("attachments")`, resolved freshly on every call, so patching the
 * service is picked up immediately. `requestImageHandleText()` reads
 * `ref.mediaType` rather than `version.mediaType`, so the model-visible
 * attachment handle text stays accurate.
 *
 * The method is installed on the service object's *prototype* rather than on
 * the instance: `ctx.get()` hands back a Cordis "traceable" Proxy whose `set`
 * trap routes through an extra shadow receiver, so an instance-level write is
 * not reliably observable. A property on the prototype is always found by the
 * proxy's descriptor walk.
 */

export const name = 'dsh-webp-relabel';

/** Hard dependency: we patch this exact service. */
export const inject = ['attachments'];

const DEFAULTS = Object.freeze({
  from: 'image/webp',
  to: 'image/png',
  debug: true,
});

const TAG = '[dsh-webp-relabel]';
const PATCH_MARK = Symbol.for('dsh.webp-relabel.patched');

/** Walk an object's prototype chain for the first definition of `methodName`. */
function findMethodOwner(object, methodName) {
  let proto = Object.getPrototypeOf(object);
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
    if (descriptor && typeof descriptor.value === 'function') return { owner: proto, descriptor };
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

/** Resolve the attachments service, preferring the live Cordis accessor. */
function resolveService(ctx) {
  const direct = ctx.get('attachments');
  if (direct) return { service: direct, via: 'ctx.get' };
  try {
    const store = ctx.reflect?.store;
    for (const key of Reflect.ownKeys(store ?? {})) {
      const impl = store[key];
      if (impl && impl.name === 'attachments' && impl.value) {
        return { service: impl.value, via: 'reflect.store' };
      }
    }
  } catch {
    // ignore and report below
  }
  return undefined;
}

export function apply(ctx, config) {
  const from = typeof config?.from === 'string' ? config.from : DEFAULTS.from;
  const to = typeof config?.to === 'string' ? config.to : DEFAULTS.to;
  const debug = config?.debug ?? DEFAULTS.debug;
  const log = (...args) => {
    if (debug) console.log(TAG, ...args);
  };

  ctx.effect(() => {
    const resolved = resolveService(ctx);
    if (!resolved) {
      console.error(`${TAG} attachments service not found; nothing patched`);
      return () => {};
    }

    const { service, via } = resolved;
    const found = findMethodOwner(service, 'readImageRequest');
    if (!found) {
      console.error(`${TAG} attachments.readImageRequest not found; nothing patched`);
      return () => {};
    }

    const { descriptor: originalDescriptor } = found;
    const original = originalDescriptor.value;

    if (original[PATCH_MARK] === true) {
      log('already patched; skipping');
      return () => {};
    }

    // Shadow on the immediate prototype so the change is narrow and easy to undo.
    const target = Object.getPrototypeOf(service);
    const previous = Object.getOwnPropertyDescriptor(target, 'readImageRequest');

    let relabels = 0;

    const patched = async function readImageRequest(ref, requestTarget, signal) {
      const version = await original.call(this, ref, requestTarget, signal);
      if (!version || version.mediaType !== from) return version;
      relabels += 1;
      log(
        `relabel #${relabels}: ${from} -> ${to}` +
          ` (${version.width}x${version.height}px, ${version.bytes}B, ref ${String(ref?.attachmentId ?? '?')})`,
      );
      // Identical bytes with a compatible label; a new object leaves any frozen
      // original untouched.
      return { ...version, mediaType: to };
    };
    Object.defineProperty(patched, PATCH_MARK, { value: true, enumerable: false });

    Object.defineProperty(target, 'readImageRequest', {
      ...originalDescriptor,
      value: patched,
    });

    log(`active: ${from} -> ${to} (service via ${via}, method on ${target.constructor?.name ?? 'prototype'})`);

    return () => {
      try {
        if (previous) Object.defineProperty(target, 'readImageRequest', previous);
        else delete target.readImageRequest;
      } catch (error) {
        console.error(`${TAG} failed to restore attachments.readImageRequest:`, error);
      }
      log(`inactive: restored (relabelled ${relabels} request image(s))`);
    };
  }, 'dsh-webp-relabel: relabel request images');

  log(`loaded (config: from=${from}, to=${to}, debug=${debug})`);
}
