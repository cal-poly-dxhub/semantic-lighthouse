"use client";

import { Anchor, Paper, Text, Title, useMantineTheme } from "@mantine/core";

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
      <Anchor href="http://localhost:3000/video/?id=04ad9e6d-ea66-4e4e-ae48-baa7bb3763ec">
        Watch a demo video
      </Anchor>
    </Paper>
  );
}
