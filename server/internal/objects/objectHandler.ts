/**
 * Objects are basically files, like images or downloads, that have a set of metadata and permissions attached
 * They're served by the API from the /api/v1/object/${objectId} endpoint.
 *
 * It supports streams and buffers, depending on the use case. Buffers will likely only be used internally if
 * the data needs to be manipulated somehow.
 *
 * Objects are designed to be created once, and link to a single ID. For example, each user gets a single object
 * that's tied to their profile picture. If they want to update their profile picture, they overwrite that object.
 *
 * Permissions are a list of strings. Each permission string is in the id:permission format. Eg
 * anonymous:read
 * myUserId:read
 * anotherUserId:write
 */

import { type } from "arktype";
import { parse as getMimeTypeBuffer } from "file-type-mime";
import type pino from "pino";
import type { Writable } from "stream";
import { Readable } from "stream";
import { createHash } from "node:crypto";
import { getMimeType as getMimeTypeStream } from "stream-mime-type";
import type { ObjectStat } from "./backend";

export type ObjectReference = string;

export const objectMetadata = type({
  mime: "string",
  permissions: "string[]",
  userMetadata: {
    "[string]": "string",
  },
});
export type ObjectMetadata = typeof objectMetadata.infer;

export enum ObjectPermission {
  Read = "read",
  Write = "write",
  Delete = "delete",
}
export const ObjectPermissionPriority: Array<ObjectPermission> = [
  ObjectPermission.Read,
  ObjectPermission.Write,
  ObjectPermission.Delete,
];

export type Object = { mime: string; data: Source };

export type Source = Readable | Buffer;

export abstract class ObjectBackend {
  // Interface functions, not designed to be called directly.
  // They don't check permissions to provide any utilities
  abstract fetch(id: ObjectReference): Promise<Source | undefined>;
  abstract write(id: ObjectReference, source: Source): Promise<boolean>;
  abstract startWriteStream(id: ObjectReference): Promise<Writable | undefined>;
  abstract create(
    id: string,
    source: Source,
    metadata: ObjectMetadata,
  ): Promise<ObjectReference | undefined>;
  abstract createWithWriteStream(
    id: string,
    metadata: ObjectMetadata,
  ): Promise<Writable | undefined>;
  abstract delete(id: ObjectReference): Promise<boolean>;
  abstract fetchMetadata(
    id: ObjectReference,
  ): Promise<ObjectMetadata | undefined>;
  abstract writeMetadata(
    id: ObjectReference,
    metadata: ObjectMetadata,
  ): Promise<boolean>;
  abstract fetchHash(id: ObjectReference): Promise<string | undefined>;
  abstract listAll(): Promise<string[]>;
  abstract cleanupMetadata(taskLogger: pino.Logger): Promise<void>;
}

export class ObjectHandler {
  private backend: ObjectBackend;

  constructor(backend: ObjectBackend) {
    this.backend = backend;
  }

  private async fetchMimeType(source: Source) {
    if (source instanceof ReadableStream) {
      source = Readable.from(source);
    }
    if (source instanceof Readable) {
      const { stream, mime } = await getMimeTypeStream(source);
      return { source: Readable.from(stream), mime: mime };
    }
    if (source instanceof Buffer) {
      const mime =
        getMimeTypeBuffer(new Uint8Array(source).buffer)?.mime ??
        "application/octet-stream";
      return { source: source, mime };
    }

    return { source: undefined, mime: undefined };
  }

  async createFromSource(
    id: string,
    sourceFetcher: () => Promise<Source>,
    metadata: { [key: string]: string },
    permissions: Array<string>,
  ) {
    const { source, mime } = await this.fetchMimeType(await sourceFetcher());
    if (!mime)
      throw new Error("Unable to calculate MIME type - is the source empty?");

    await this.backend.create(id, source, {
      permissions,
      userMetadata: metadata,
      mime,
    });
  }

  /**
   * Hash the source bytes and use the digest as the object id. Pure
   * dedup — if the same image is uploaded twice, both callers reference
   * the same object. Only useful for Buffer sources today because
   * computing a content hash forces us to fully materialise the stream
   * before writing; large uploads should stick with the random-uuid
   * path.
   *
   * Behind a feature flag (`OBJECTS_CONTENT_HASH`) for now — see the
   * audit doc for rollout plan. Existing random-UUID objects keep
   * working; this just changes which id new objects get.
   */
  async createContentAddressed(
    sourceFetcher: () => Promise<Buffer>,
    metadata: { [key: string]: string },
    permissions: Array<string>,
  ): Promise<string> {
    const buf = await sourceFetcher();
    const id = createHash("sha256").update(buf).digest("hex");
    // Short-circuit if an object with this content already exists. We
    // still ensure the new permission set is at least a superset of the
    // old one — overwriting metadata is the responsibility of the
    // caller, not the dedup path.
    const existing = await this.backend.fetchMetadata(id);
    if (existing) return id;

    const { mime } = await this.fetchMimeType(buf);
    if (!mime)
      throw new Error("Unable to calculate MIME type - is the source empty?");
    await this.backend.create(id, buf, {
      permissions,
      userMetadata: metadata,
      mime,
    });
    return id;
  }

  async createWithStream(
    id: string,
    metadata: { [key: string]: string },
    permissions: Array<string>,
  ) {
    return this.backend.createWithWriteStream(id, {
      permissions,
      userMetadata: metadata,
      mime: "application/octet-stream",
    });
  }

  // We only need one permission, so find instead of filter is faster
  private hasAnyPermissions(permissions: string[], userId?: string) {
    return !!permissions.find((e) => {
      if (userId !== undefined && e.startsWith(userId)) return true;
      if (userId !== undefined && e.startsWith("internal")) return true;
      if (e.startsWith("anonymous")) return true;
      return false;
    });
  }

  private fetchPermissions(permissions: string[], userId?: string) {
    return (
      permissions
        .filter((e) => {
          if (userId !== undefined && e.startsWith(userId)) return true;
          if (userId !== undefined && e.startsWith("internal")) return true;
          if (e.startsWith("anonymous")) return true;
          return false;
        })
        // Strip IDs from permissions
        .map((e) => e.split(":").at(1))
        // Map to priority according to array
        .map((e) => ObjectPermissionPriority.findIndex((c) => c === e))
    );
  }

  /**
   * Backend-agnostic existence check. Used by the admin object browser
   * and the cleanup task to avoid touching `fs` in callers.
   */
  async exists(id: ObjectReference): Promise<boolean> {
    const stat = await this.stat(id);
    return stat !== undefined;
  }

  /**
   * Backend-agnostic stat. Returns size + mtime so the admin browser
   * can show "largest 20 objects" without falling back to `fs.statSync`
   * in the page handler.
   *
   * Falls back to inspecting the readable stream length when the
   * backend doesn't expose stat() — only the new-shape FsObjectBackend
   * implements it directly today.
   */
  async stat(id: ObjectReference): Promise<ObjectStat | undefined> {
    // Prefer the new-shape stat() if the backend exposes it.
    const backend = this.backend as ObjectBackend & {
      stat?: (id: string) => Promise<ObjectStat | undefined>;
    };
    if (typeof backend.stat === "function") {
      return await backend.stat(id);
    }
    return undefined;
  }

  /**
   * Backend-agnostic streaming read. Skips permission checks — only
   * call this from server-internal contexts that already know they're
   * allowed to read.
   *
   * Prefer this over reading the file off disk yourself. The HTTP GET
   * endpoint uses `fetchWithPermissions` instead; this is for tasks /
   * admin tooling that need raw streamed access.
   */
  async read(id: ObjectReference) {
    const metadata = await this.backend.fetchMetadata(id);
    if (!metadata) return undefined;
    const stream = await this.backend.fetch(id);
    if (!stream) return undefined;
    return { mime: metadata.mime, stream };
  }

  /**
   * Fetches object, but also checks if user has perms to access it
   * @param id object id
   * @param userId user to check, or act as anon user
   * @returns
   */
  async fetchWithPermissions(id: ObjectReference, userId?: string) {
    const metadata = await this.backend.fetchMetadata(id);
    if (!metadata) return;

    if (!this.hasAnyPermissions(metadata.permissions, userId)) return;

    // Because any permission can be read or up, we automatically know we can read this object
    // So just straight return the object
    const source = await this.backend.fetch(id);
    if (!source) return undefined;
    const object: Object = {
      data: source,
      mime: metadata.mime,
    };
    return object;
  }

  /**
   * Fetch object hash. Permissions check should be done on read
   * @param id object id
   * @returns
   */
  async fetchHash(id: ObjectReference) {
    return await this.backend.fetchHash(id);
  }

  /**
   *
   * @param id object id
   * @param sourceFetcher callback used to provide image
   * @param userId user to check, or act as anon user
   * @returns
   * @description If we need to fetch a remote resource, it doesn't make sense
   * to immediately fetch the object, *then* check permissions.
   * Instead the caller can pass a simple anonymous function, like
   * () => $dropFetch('/my-image');
   * And if we actually have permission to write, it fetches it then.
   */
  async writeWithPermissions(
    id: ObjectReference,
    sourceFetcher: () => Promise<Source>,
    userId?: string,
  ) {
    const metadata = await this.backend.fetchMetadata(id);
    if (!metadata) return false;

    const permissions = this.fetchPermissions(metadata.permissions, userId);

    const requiredPermissionIndex = 1;
    const hasPermission =
      permissions.find((e) => e >= requiredPermissionIndex) != undefined;

    if (!hasPermission) return false;

    const source = await sourceFetcher();
    // TODO: prevent user from overwriting existing object
    const result = await this.backend.write(id, source);

    return result;
  }

  /**
   *
   * @param id object id
   * @param userId user to check, or act as anon user
   * @returns
   */
  async deleteWithPermission(id: ObjectReference, userId?: string) {
    const metadata = await this.backend.fetchMetadata(id);
    if (!metadata) return false;

    const permissions = this.fetchPermissions(metadata.permissions, userId);

    const requiredPermissionIndex = 2;
    const hasPermission =
      permissions.find((e) => e >= requiredPermissionIndex) != undefined;

    if (!hasPermission) return false;

    const result = await this.backend.delete(id);
    return result;
  }

  /**
   * Deletes object without checking permission
   * @param id
   * @returns
   */
  async deleteAsSystem(id: ObjectReference) {
    return await this.backend.delete(id);
  }

  /**
   * List all objects
   */
  async listAll() {
    return await this.backend.listAll();
  }

  /**
   * Aggregate stats for the admin object browser. Reads (count, total
   * size, top N largest) without exposing the backend implementation.
   *
   * If the backend has a native `statAll`, use it (FsObjectBackend
   * batches stat calls). Otherwise stat() each id individually — fine
   * for small instances but the native path is preferred.
   */
  async statAll(limit = 20): Promise<{
    count: number;
    totalSize: number;
    top: Array<{ id: string; size: number; mtime: Date }>;
  }> {
    const backend = this.backend as ObjectBackend & {
      statAll?: (
        n?: number,
      ) => Promise<{
        count: number;
        totalSize: number;
        top: Array<{ id: string; size: number; mtime: Date }>;
      }>;
    };
    if (typeof backend.statAll === "function") {
      return await backend.statAll(limit);
    }

    const ids = await this.backend.listAll();
    let totalSize = 0;
    const entries: Array<{ id: string; size: number; mtime: Date }> = [];
    for (const id of ids) {
      const s = await this.stat(id);
      if (!s) continue;
      totalSize += s.size;
      entries.push({ id, size: s.size, mtime: s.mtime });
    }
    entries.sort((a, b) => b.size - a.size);
    return { count: ids.length, totalSize, top: entries.slice(0, limit) };
  }

  /**
   * Purges metadata for objects that no longer exist
   * This is useful for cleaning up metadata files that are left behinds
   * @returns
   */
  async cleanupMetadata(taskLogger: pino.Logger) {
    return await this.backend.cleanupMetadata(taskLogger);
  }
}
