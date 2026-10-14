"use client";

import { Center, Loader, Text } from "@mantine/core";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

/**
 * settings that only exist after the stack is deployed. the deploy writes them to
 * /config.json next to the site, so one build works for any stack. for `next dev`,
 * copy the deployed file into public/: curl https://<FrontendUrl>/config.json -o public/config.json
 */
export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  apiUrl: string;
}

const ConfigContext = createContext<AppConfig | null>(null);

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/config.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`config.json returned ${response.status}`);
        }
        return response.json() as Promise<AppConfig>;
      })
      .then(setConfig)
      .catch((err) => {
        console.error("ERROR: could not load /config.json", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (error) {
    return (
      <Center h="100vh">
        <Text c="red">Couldn&apos;t load the site&apos;s settings ({error}).</Text>
      </Center>
    );
  }

  if (!config) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
};

export const useConfig = (): AppConfig => {
  const config = useContext(ConfigContext);
  if (!config) {
    throw new Error("useConfig must be used inside ConfigProvider");
  }
  return config;
};
