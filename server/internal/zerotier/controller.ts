/*
Thin HTTP client for a self-hosted ZeroTier network controller (the zerotier-one
built-in controller, REST API on :9993 authed by `authtoken.secret`). It MINTS +
AUTHORIZES networks; it never joins one. See docs/zerotier-controller.md.
*/

import { systemConfig } from "../config/sys-conf";

export interface ZTStatus {
  address: string; // this node's 10-hex id (also the controller id)
  online: boolean;
  version: string;
}

export interface ZTNetwork {
  // zerotier-one returns the network id as `id`; older builds used `nwid`.
  id?: string;
  nwid?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ZTNetworkConfig {
  name: string;
  private: boolean;
  enableBroadcast: boolean;
  v4AssignMode: { zt: boolean };
  ipAssignmentPools: Array<{ ipRangeStart: string; ipRangeEnd: string }>;
  routes: Array<{ target: string; via: string | null }>;
}

class ZeroTierController {
  // Cache the controller's own node id — it's stable for the daemon's lifetime
  // and prefixes every network id we mint.
  private cachedNodeId: string | undefined;

  private async req<T>(
    path: string,
    init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown },
  ): Promise<T> {
    const baseUrl = systemConfig.getZerotierControllerUrl();
    const token = systemConfig.getZerotierAuthToken();
    if (!baseUrl || !token)
      throw createError({
        statusCode: 503,
        statusMessage: "ZeroTier controller is not configured on this server.",
      });

    return await $fetch<T>(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "X-ZT1-Auth": token,
        "Content-Type": "application/json",
      },
      body: init?.body as Record<string, unknown> | undefined,
      // The controller is local; fail fast rather than hanging a request.
      timeout: 8000,
    });
  }

  async getStatus(): Promise<ZTStatus> {
    return await this.req<ZTStatus>("/status");
  }

  async getControllerNodeId(): Promise<string> {
    if (this.cachedNodeId) return this.cachedNodeId;
    const status = await this.getStatus();
    if (!/^[0-9a-f]{10}$/.test(status.address))
      throw createError({
        statusCode: 502,
        statusMessage: "ZeroTier controller returned an invalid node id.",
      });
    this.cachedNodeId = status.address;
    return status.address;
  }

  /** Mint a new network owned by this controller. Returns its network id. */
  async createNetwork(config: ZTNetworkConfig): Promise<string> {
    const nodeId = await this.getControllerNodeId();
    // The trailing 6 underscores tell the controller to allocate a random suffix.
    const network = await this.req<ZTNetwork>(
      `/controller/network/${nodeId}______`,
      { method: "POST", body: config },
    );
    const networkId = network.id ?? network.nwid;
    if (!networkId || !/^[0-9a-f]{16}$/.test(networkId))
      throw createError({
        statusCode: 502,
        statusMessage: "ZeroTier controller did not return a valid network id.",
      });
    return networkId;
  }

  async deleteNetwork(networkId: string): Promise<void> {
    await this.req(`/controller/network/${networkId}`, { method: "DELETE" });
  }

  /** Authorize (or revoke) a member node on a network. */
  async setMemberAuthorized(
    networkId: string,
    memberId: string,
    authorized: boolean,
  ): Promise<void> {
    await this.req(`/controller/network/${networkId}/member/${memberId}`, {
      method: "POST",
      body: { authorized },
    });
  }
}

export const zerotierController = new ZeroTierController();
export default zerotierController;
