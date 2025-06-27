import "@mantine/core/styles.css";

import Header from "@/components/Header";
import { AuthProvider } from "@/constants/AuthContext";
import { theme } from "@/constants/theme";
import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps,
} from "@mantine/core";

export const metadata = {
  title: "Semantic Lighthouse",
  description: "Create meeting minutes from a video and agenda.",
};

const RootWrapper = ({ children }: { children: React.ReactNode }) => (
  <>
    <Header />
    {children}
  </>
);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <AuthProvider>
          <MantineProvider theme={theme} defaultColorScheme="light">
            <RootWrapper>{children}</RootWrapper>
          </MantineProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
