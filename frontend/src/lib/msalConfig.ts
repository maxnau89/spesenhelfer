import { LogLevel, PublicClientApplication } from "@azure/msal-browser";
import type { Configuration } from "@azure/msal-browser";

const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID || "";
const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID || "common";
const BASE = import.meta.env.BASE_URL || "/";

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: `${window.location.origin}/auth-popup.html`,
    postLogoutRedirectUri: `${window.location.origin}${BASE}login`,
  },
  cache: {
    cacheLocation: "localStorage" as const,
  },
  system: {
    loggerOptions: {
      loggerCallback: (_level, message, containsPii) => {
        if (!containsPii && import.meta.env.DEV) {
          console.log(`[MSAL] ${message}`);
        }
      },
      logLevel: LogLevel.Warning,
    },
  },
};

export const loginRequest = { scopes: ["openid", "email", "profile"] };

export const msalInstance = new PublicClientApplication(msalConfig);
export const msalReady: Promise<void> = msalInstance.initialize().then(() => undefined);
