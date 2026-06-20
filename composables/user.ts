import type { UserModel } from "~/prisma/client/models";

// undefined = haven't check
// null = check, no user
// {} = check, user

export const useUser = () => useState<UserModel | undefined | null>(undefined);
export const updateUser = async () => {
  const user = useUser();
  if (user.value === null) return;

  user.value = await $dropFetch<UserModel | null>("/api/v1/user");
};

export async function completeSignin() {
  const route = useRoute();
  const router = useRouter();

  const user = useUser();
  user.value = await $dropFetch<UserModel | null>("/api/v1/user");
  router.push(safeRedirectPath(route.query.redirect?.toString()));
}

// Same-origin relative paths only — stops a crafted ?redirect= from turning the
// post-login navigation into an open redirect.
function safeRedirectPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
