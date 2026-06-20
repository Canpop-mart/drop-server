# Self-hosted ZeroTier controller (co-op rooms)

Drop's co-op "rooms" feature uses a **self-hosted ZeroTier network controller** to mint
private virtual-LAN networks and auto-authorize members — no ZeroTier Central, no user
accounts. This doc covers standing the controller up next to `drop-server` and proving it
works (**Milestone A**). The room API + UX that call it come later (Milestones B–D).

## Why this needs no special privileges

A ZeroTier controller only **mints and authorizes** networks for *other* nodes. It never
**joins** a network itself, so it never creates a TUN interface — meaning the sidecar needs
**no `/dev/net/tun` and no `NET_ADMIN`**. Members reach the controller over ZeroTier's free
public roots (addressed by the controller's node ID, which is the first 10 hex of every
network ID), so there's **no inbound port-forwarding** either. The container just needs
outbound internet and a persistent state volume.

> If your NAS's Docker refuses to start the container without a TUN device, that's an
> image-entrypoint quirk, not a real requirement — uncomment the `devices:`/`cap_add:`
> fallback in the compose service and it'll start.

## 1. Add the sidecar to your compose

The repo's [`deploy-template/compose.yml`](../deploy-template/compose.yml) already includes
it. For your live NAS compose (`/volume1/docker/media-viewing/…`), add this service and
point the `drop` service at it:

```yaml
  zerotier-controller:
    image: zyclonite/zerotier:latest   # pin a tag once verified
    container_name: drop-zerotier-controller
    restart: unless-stopped
    # Fallback ONLY if the container won't start without a tun device:
    # devices: [ "/dev/net/tun" ]
    # cap_add: [ "NET_ADMIN" ]
    volumes:
      - ./zerotier:/var/lib/zerotier-one
```

And on the `drop` service, add the two env vars (token filled in step 3):

```yaml
    environment:
      - ZEROTIER_CONTROLLER_URL=http://zerotier-controller:9993
      - ZEROTIER_AUTH_TOKEN=            # paste in step 3
```

Bring it up: `sudo docker compose up -d zerotier-controller`

## 2. Allow drop-server's container to call the API

The controller's HTTP API (`:9993`) only answers callers in its `allowManagementFrom` list.
After the first boot creates `./zerotier/`, drop a `local.conf` beside its state so the
Docker bridge subnets are allowed (the auth token is still required, so this is safe):

```bash
cat > ./zerotier/local.conf <<'JSON'
{
  "settings": {
    "allowManagementFrom": ["127.0.0.1/32", "172.16.0.0/12", "10.0.0.0/8", "192.168.0.0/16"]
  }
}
JSON
sudo docker compose restart zerotier-controller
```

## 3. Wire the auth token into drop-server

The controller generates a stable `authtoken.secret` on first boot. Read it and paste it
into the `drop` service's `ZEROTIER_AUTH_TOKEN` (inline avoids cross-container file-perms):

```bash
sudo docker exec drop-zerotier-controller cat /var/lib/zerotier-one/authtoken.secret
```

Put that value in `ZEROTIER_AUTH_TOKEN=...`, then `sudo docker compose up -d drop`.

## 4. Validate the controller API (Milestone A proof)

Run a throwaway `curl` container on the same compose network. Replace `TOKEN` with the
value from step 3 and `NET` with your compose network (find it via `docker network ls`):

```bash
TOKEN='<authtoken from step 3>'
NET='media-viewing_default'   # your compose project's default network

# a) controller node id + that it's online
docker run --rm --network "$NET" curlimages/curl -s \
  -H "X-ZT1-Auth: $TOKEN" http://zerotier-controller:9993/status

# b) mint a private test network (NODE = the 10-hex "address" from step a)
NODE='<address from a>'
docker run --rm --network "$NET" curlimages/curl -s \
  -H "X-ZT1-Auth: $TOKEN" -X POST \
  -d '{"name":"drop-room-test","private":true,"enableBroadcast":true,
       "v4AssignMode":{"zt":true},
       "ipAssignmentPools":[{"ipRangeStart":"10.77.0.1","ipRangeEnd":"10.77.0.254"}],
       "routes":[{"target":"10.77.0.0/24"}]}' \
  "http://zerotier-controller:9993/controller/network/${NODE}______"
# -> returns the network config incl. its "nwid"/"id" (NODE + 6 hex)
```

Then from any ZeroTier client (the proven Deck or PC POC nodes work), `join` that network
id. It'll show `ACCESS_DENIED` until you authorize it:

```bash
# member id == the joining node's 10-hex id
docker run --rm --network "$NET" curlimages/curl -s \
  -H "X-ZT1-Auth: $TOKEN" -X POST -d '{"authorized":true}' \
  "http://zerotier-controller:9993/controller/network/<nwid>/member/<member-id>"
```

The client should flip to `OK` with a `10.77.x` address. **That closes Milestone A: a
network we minted and authorized ourselves carries a real client — no ZeroTier Central.**

## Fallback: build your own controller image

If `zyclonite/zerotier` fights the NAS, build a minimal canonical image instead:

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -s https://install.zerotier.com | bash \
 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
VOLUME /var/lib/zerotier-one
EXPOSE 9993
ENTRYPOINT ["zerotier-one"]
```

Build on the NAS (`docker build -t drop-zt-controller .`) and swap the `image:` line.

## Notes

- **Token alternative:** instead of inline `ZEROTIER_AUTH_TOKEN`, you can mount `./zerotier`
  read-only into the `drop` container and set `ZEROTIER_AUTH_TOKEN_PATH` — but the secret is
  `root:root 0600`, so the inline approach is simpler unless you reconcile UIDs.
- **Lifecycle:** networks the controller mints persist until deleted. Milestone B adds a
  reaper so abandoned rooms are cleaned up; for now, delete test networks with
  `DELETE /controller/network/<nwid>`.
