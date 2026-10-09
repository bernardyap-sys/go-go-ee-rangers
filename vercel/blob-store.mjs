import { BlobPreconditionFailedError, del, get, put } from '@vercel/blob';

export const blobStore = {
  async read(pathname) {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { value: await new Response(result.stream).json(), etag: result.blob.etag.replace(/^W\//, '') };
  },
  async write(pathname, value, etag = null) {
    return put(pathname, JSON.stringify(value), {
      access: 'private',
      contentType: 'application/json',
      ...(etag ? { allowOverwrite: true, ifMatch: etag } : {}),
    });
  },
  async remove(pathname) { await del(pathname); },
  isConflict(error) { return error instanceof BlobPreconditionFailedError || error.status === 409; },
};
