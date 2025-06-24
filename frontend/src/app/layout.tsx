import "@mantine/core/styles.css";

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
          <MantineProvider theme={theme}>{children}</MantineProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
