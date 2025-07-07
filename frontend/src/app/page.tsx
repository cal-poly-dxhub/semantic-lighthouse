"use client";

import { Paper, Text, Title, useMantineTheme } from "@mantine/core";

export default function Home() {
  const theme = useMantineTheme();

  return (
    <Paper
      p="xl"
      shadow="xs"
      w={600}
      mx="auto"
      mt={50}
      radius={theme.radius.lg}
    >
      <Title order={2} mb="md">
        Welcome to Semantic Lighthouse
      </Title>
      <Text>
        AI-powered, template-driven, secure board meeting minutes generator.
      </Text>
    </Paper>
  );
}
