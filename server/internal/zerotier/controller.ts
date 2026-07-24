/*
Thin HTTP client for a self-hosted ZeroTier network controller (the zerotier-one
built-in controller, REST API on :9993 authed by `authtoken.secret`). See
docs/zerotier-controller.md.

Two API surfaces live on the same daemon and share the same auth token:

  /controller/network/...  — the CONTROLLER API: mint networks, authorize other
                             nodes onto them, read their assigned IPs.
  /network/...             — this NODE's OWN membership: join/leave a network and
                             read the addresses it was assigned.

Co-op rooms only ever use the controller API: the server mints a network for the
players and never joins it, so it holds no overlay IP. Archipelago breaks that —
the AP server runs ON this machine, so remote players need a routable address for
it. `joinNetwork` (plus authorizing our own node id) puts the server on its own
network so it has a stable overlay IP to advertise. See
`server/internal/archipelago/index.ts`.
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

/**
 * This node's own membership of a network (the `/network/...` service API), as
 * opposed to `ZTNetwork` which is a network we host via the controller API.
 */
export interface ZTNetworkMembership {
  id?: string;
  nwid?: string;
  status?: string; // e.g. "OK", "REQUESTING_CONFIGURATION", "ACCESS_DENIED"
  /** IPv4/IPv6 addresses this node actually holds on the network. */
  assignedAddresses?: string[];
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

  /**
   * The controller-assigned IPs for a member (from the network's auto-assign
   * pool). Empty until the member comes online and the controller hands it an
   * address. The source of truth for peers' overlay IPs.
   */
  async getMemberIpAssignments(
    networkId: string,
    memberId: string,
  ): Promise<string[]> {
    const member = await this.req<{ ipAssignments?: string[] }>(
      `/controller/network/${networkId}/member/${memberId}`,
    );
    return member.ipAssignments ?? [];
  }

  // --- This node's own membership (service API, not the controller API) ---

  /**
   * Join this node to a network, so the server itself is reachable on the
   * overlay. Idempotent: joining a network we're already on is a no-op that
   * still returns the membership.
   *
   * Joining alone is not enough on a private network — the member also has to be
   * authorized. We're the controller, so we authorize ourselves via
   * `setMemberAuthorized(networkId, await getControllerNodeId(), true)`.
   */
  async joinNetwork(networkId: string): Promise<ZTNetworkMembership> {
    return await this.req<ZTNetworkMembership>(`/network/${networkId}`, {
      method: "POST",
      // An empty config body means "join with defaults".
      body: {},
    });
  }

  /** Leave a network this node has joined. */
  async leaveNetwork(networkId: string): Promise<void> {
    await this.req(`/network/${networkId}`, { method: "DELETE" });
  }

  /**
   * This node's own view of a network it has joined. `assignedAddresses` is
   * what the node actually holds (as opposed to `getMemberIpAssignments`, which
   * is the controller's intent) — addresses arrive asynchronously after the
   * join, so expect this to be empty for a moment.
   */
  async getJoinedNetwork(
    networkId: string,
  ): Promise<ZTNetworkMembership | undefined> {
    try {
      return await this.req<ZTNetworkMembership>(`/network/${networkId}`);
    } catch {
      // Not joined (404) — the caller decides whether that's an error.
      return undefined;
    }
  }
}

export const zerotierController = new ZeroTierController();
export default zerotierController;
