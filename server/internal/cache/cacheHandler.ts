import { prefixStorage, type StorageValue, type Storage } from "unstorage";

/**
 * Default TTL for cache entries in milliseconds (5 minutes)
 */
const DEFAULT_CACHE_TTL = 300000;

/**
 * Creates and manages the lifecycles of various caches
 */
export class CacheHandler {
  private caches = new Map<string, Storage<StorageValue>>();

  /**
   * Create a new cache
   * @param name - Name/prefix for the cache
   * @param ttl - Time to live for cache entries in milliseconds (default: 5 minutes)
   * @returns Storage instance with TTL support
   */
  createCache<V extends StorageValue>(
    name: string,
    ttl: number = DEFAULT_CACHE_TTL,
  ) {
    // will allow us to dynamicing use redis in the future just by changing the storage used
    const baseStorage = prefixStorage<V>(useStorage<V>("appCache"), name);

    // Wrap with TTL tracking
    const provider = new TTLWrappedStorage<V>(baseStorage, ttl);

    // hack to let ts have us store cache
    this.caches.set(name, provider as unknown as Storage<StorageValue>);
    return provider;
  }
}

/**
 * Wraps a storage provider with TTL (time-to-live) functionality.
 * Provides get/set/remove/has/clear/getKeys methods matching the unstorage interface.
 */
class TTLWrappedStorage<V extends StorageValue> {
  private ttl: number;
  private expirations = new Map<string, number>();

  constructor(
    private storage: Storage<V>,
    ttl: number,
  ) {
    this.ttl = ttl;
  }

  private isExpired(key: string): boolean {
    const expiration = this.expirations.get(key);
    return !!expiration && Date.now() > expiration;
  }

  async get(key: string): Promise<V | null> {
    if (this.isExpired(key)) {
      await this.remove(key);
      return null;
    }
    return this.storage.getItem(key);
  }

  // Alias for compatibility with Storage<V> consumers
  async getItem(key: string): Promise<V | null> {
    return this.get(key);
  }

  async set(key: string, value: V): Promise<void> {
    this.expirations.set(key, Date.now() + this.ttl);
    return this.storage.setItem(key, value);
  }

  async setItem(key: string, value: V): Promise<void> {
    return this.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.expirations.delete(key);
    return this.storage.removeItem(key);
  }

  async removeItem(key: string): Promise<void> {
    return this.remove(key);
  }

  async has(key: string): Promise<boolean> {
    if (this.isExpired(key)) {
      await this.remove(key);
      return false;
    }
    return this.storage.has(key);
  }

  async clear(): Promise<void> {
    this.expirations.clear();
    return this.storage.clear();
  }

  async getKeys(): Promise<string[]> {
    const keys = await this.storage.getKeys();
    const validKeys: string[] = [];
    for (const key of keys) {
      if (!this.isExpired(key)) {
        validKeys.push(key);
      } else {
        await this.remove(key);
      }
    }
    return validKeys;
  }
}
