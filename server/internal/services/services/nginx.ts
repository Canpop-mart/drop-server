import { spawn } from "child_process";
import { Service } from "..";
import path from "path";
import os from "os";
import fs from "fs";

export const NGINX_SERVICE = new Service(
  "nginx",
  () => {
    const nginxConfig = path.resolve(
      process.env.NGINX_CONFIG ?? "./build/nginx.conf",
    );
    // Keep nginx state (pid, temp dirs) off the bind-mounted data volume —
    // ownership on a host bind-mount doesn't always match the container's
    // runtime uid, which leaves nginx unable to write into `/data/nginx`.
    // tmpdir is always writable by the running user and ephemeral by design.
    const nginxPrefix = path.join(os.tmpdir(), "drop-nginx");
    fs.mkdirSync(nginxPrefix, { recursive: true });

    return spawn("nginx", ["-c", nginxConfig, "-p", nginxPrefix]);
  },
  undefined,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  async () => await $fetch(`http://127.0.0.1:8080/`),
);
