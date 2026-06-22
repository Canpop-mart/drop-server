import type { Component } from "vue";

export type NavigationItem = {
  prefix: string;
  route: string;
  label: string;
  /** Optional section label used to visually group the admin nav. */
  group?: string;
};

export type QuickActionNav = {
  icon: Component;
  notifications?: Ref<number>;
  action: () => Promise<void>;
};
