/**
 * Unit tests for the dsh-webp-relabel patch.
 *
 * Run: npm test   (see the "test" script in package.json)
 *
 * Each case builds its own service class so prototypes never leak between cases.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply } from '../index.js';

/* ------------------------------------------------------------------ helpers */

/** Mirror of Cordis' own descriptor walk. */
function getPropertyDescriptor(target, prop) {
  let proto = target;
  while (proto) {
    const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
    if (desc) return desc;
    proto = Object.getPrototypeOf(proto);
  }
}

/**
 * Minimal stand-in for Cordis' "traceable" service Proxy: reads resolve through a
 * descriptor walk and every function comes back bound to the proxy itself. This
 * is what makes an instance-level patch unreliable and a prototype patch
 * necessary.
 */
function traceable(target) {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(t, prop, receiver);
      const desc = getPropertyDescriptor(t, prop);
      if (desc && 'value' in desc) {
        const value = desc.value;
        return typeof value === 'function'
          ? new Proxy(value, { apply: (fn, _thisArg, args) => Reflect.apply(fn, receiver, args) })
          : value;
      }
      const value = Reflect.get(t, prop, receiver);
      return typeof value === 'function'
        ? new Proxy(value, { apply: (fn, _thisArg, args) => Reflect.apply(fn, receiver, args) })
        : value;
    },
  });
}

/** Fresh class + instance per case. `factor` proves `this` survives the proxy hop. */
function makeService() {
  class AttachmentService {
    factor = 10;

    async readImageRequest(ref) {
      if (this.factor !== 10) throw new Error('lost `this` binding');
      const isWebp = ref.mediaType === 'image/webp';
      return {
        variantId: 'variant-1',
        attachment: ref,
        data: new Uint8Array([1, 2, 3, 4]),
        mediaType: isWebp ? 'image/webp' : 'image/jpeg',
        bytes: 4,
        width: 800,
        height: 600,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: isWebp,
      };
    }
  }
  const raw = new AttachmentService();
  return { raw, proto: AttachmentService.prototype };
}

/** Minimal Cordis-like context: `ctx.get`, `ctx.effect`, `ctx.reflect.store`. */
function makeCtx(service) {
  const cleanups = [];
  return {
    ctx: {
      reflect: { store: {} },
      get: (name) => (name === 'attachments' ? service : undefined),
      effect(fn) {
        cleanups.push(fn());
        return () => {};
      },
    },
    cleanups,
  };
}

const webpRef = { attachmentId: 'sha256:abc', mediaType: 'image/webp', bytes: 4, width: 800, height: 600 };
const jpegRef = { attachmentId: 'sha256:def', mediaType: 'image/jpeg', bytes: 4, width: 800, height: 600 };

/* -------------------------------------------------------------------- cases */

test('relabels webp to png with bytes and metadata intact', async () => {
  const { raw } = makeService();
  const { ctx } = makeCtx(traceable(raw));
  apply(ctx, { debug: false });

  const version = await raw.readImageRequest(webpRef);

  assert.equal(version.mediaType, 'image/png');
  assert.deepEqual([...version.data], [1, 2, 3, 4], 'bytes must be unchanged');
  assert.equal(version.bytes, 4);
  assert.equal(version.width, 800);
  assert.equal(version.hasAlpha, true);
  assert.equal(version.variantId, 'variant-1');
  assert.equal(version.attachment, webpRef);
});

test('the patch is visible through a Cordis-style traceable Proxy', async () => {
  const { raw } = makeService();
  const proxy = traceable(raw);
  const { ctx } = makeCtx(proxy);
  apply(ctx, { debug: false });

  const version = await proxy.readImageRequest(webpRef);

  assert.equal(version.mediaType, 'image/png', 'patch must survive the proxy');
  assert.deepEqual([...version.data], [1, 2, 3, 4]);
});

test('non-webp labels pass through untouched', async () => {
  const { raw } = makeService();
  const { ctx } = makeCtx(traceable(raw));
  apply(ctx, { debug: false });

  const version = await raw.readImageRequest(jpegRef);

  assert.equal(version.mediaType, 'image/jpeg');
});

test('dispose restores the original method', async () => {
  const { raw, proto } = makeService();
  const originalMethod = proto.readImageRequest;
  const { ctx, cleanups } = makeCtx(traceable(raw));
  apply(ctx, { debug: false });

  assert.notEqual(proto.readImageRequest, originalMethod, 'replaced while active');
  await cleanups[0]();
  assert.equal(proto.readImageRequest, originalMethod, 'restored on dispose');

  const version = await raw.readImageRequest(webpRef);
  assert.equal(version.mediaType, 'image/webp');
});

test('honours a configurable target media type', async () => {
  const { raw } = makeService();
  const { ctx } = makeCtx(traceable(raw));
  apply(ctx, { from: 'image/webp', to: 'image/gif', debug: false });

  const version = await raw.readImageRequest(webpRef);

  assert.equal(version.mediaType, 'image/gif');
});

test('re-applying does not double-wrap', async () => {
  const { raw, proto } = makeService();
  const { ctx } = makeCtx(traceable(raw));
  apply(ctx, { debug: false });
  const afterFirst = proto.readImageRequest;
  apply(ctx, { debug: false });

  assert.equal(proto.readImageRequest, afterFirst);

  const version = await raw.readImageRequest(webpRef);
  assert.equal(version.mediaType, 'image/png');
});

test('an inherited base-class method is shadowed then fully restored', async () => {
  class Base {
    async readImageRequest() {
      return { mediaType: 'image/webp', data: new Uint8Array([9]), bytes: 1, width: 1, height: 1 };
    }
  }
  class Derived extends Base {}
  const raw = new Derived();
  const baseMethod = Base.prototype.readImageRequest;

  const { ctx, cleanups } = makeCtx(traceable(raw));
  apply(ctx, { debug: false });

  let version = await raw.readImageRequest(webpRef);
  assert.equal(version.mediaType, 'image/png', 'inherited method must be shadowed');

  await cleanups[0]();
  assert.ok(!Object.hasOwn(Derived.prototype, 'readImageRequest'), 'shadow removed');
  assert.equal(Base.prototype.readImageRequest, baseMethod, 'base class untouched');

  version = await raw.readImageRequest(webpRef);
  assert.equal(version.mediaType, 'image/webp');
});
