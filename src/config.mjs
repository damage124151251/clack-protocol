export const TOKEN_CA = null;
export const X_URL = null;
export const GITHUB_URL = "https://github.com/damage124151251/clack-protocol";
export const DEV_WALLET = "FzF7sPdYGiaC6D9uajFDD2W8S38XRTTkWPWgQuf9D6wx";
export const PROTOCOL_WALLETS = [
  { role: "intake", address: "Fbj1gmpLTgiidyD3KaRudDjELQPnvtrAWwirx2rfVk3m" },
  {
    role: "distribution",
    address: "FDL2ujmRqas2aMmqznCgxi96gM9eis7LPFafV1oJEoWP",
  },
  { role: "reserve", address: "DTQx5tTz93aH9dahbiBDYjDMK4iKKiyeMCzyFKt7q2Wx" },
  {
    role: "operations",
    address: "6ZxU7yzcpgJNKW1fEWuwdT5xDCFBNM5sNsU1n9gtvb5k",
  },
];
export const ROLES = [
  {
    id: "intake",
    label: "Intake",
    description: "Receipts into the protocol",
    color: "#eb986c",
  },
  {
    id: "distribution",
    label: "Distribution",
    description: "Treasury-funded settlements",
    color: "#3659d9",
  },
  {
    id: "reserve",
    label: "Reserve",
    description: "Funds held for future operations",
    color: "#a69dce",
  },
  {
    id: "buyback",
    label: "Buyback",
    description: "Public observation; no automatic trading",
    color: "#968848",
  },
  {
    id: "operations",
    label: "Operations",
    description: "Infrastructure and operating costs",
    color: "#588b92",
  },
];
