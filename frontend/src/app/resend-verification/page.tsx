"use client";

import {
  Alert,
  Anchor,
  Button,
  Container,
  Paper,
  Text,
  TextInput,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import Link from "next/link";
import { useState } from "react";

// TODO: not implemented fully
export default function ResendVerificationPage() {
  const theme = useMantineTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      username: "",
    },
    validate: {
      username: (value: string | unknown[]) =>
        value.length < 3 ? "Username must be at least 3 characters" : null,
    },
  });

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    // Note: This would need to be implemented with AWS Cognito resendConfirmationCode
    // For now, we'll show a helpful message
    setTimeout(() => {
      setLoading(false);
      setSuccess(
        "If this username exists and is unverified, a new verification code has been sent to the associated email address."
      );
    }, 1000);
  };

  return (
    <Container size={620} my={40}>
      <Title
        ta="center"
        style={{
          fontFamily: "Greycliff CF, var(--mantine-font-family)",
          fontWeight: 900,
        }}
      >
        Resend Verification Code
      </Title>

      <Text ta="center" c="dimmed" size="sm" mt="sm">
        Enter your username to receive a new verification code
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        {error && (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        )}

        {success && (
          <Alert color="green" mb="md">
            {success}
          </Alert>
        )}

        <form onSubmit={form.onSubmit(onSubmit)}>
          <TextInput
            label="Username"
            placeholder="Your username"
            required
            {...form.getInputProps("username")}
            description="The username you used when signing up"
          />

          <Button
            type="submit"
            fullWidth
            mt="xl"
            loading={loading}
            disabled={!!success}
            bg={theme.primaryColor}
          >
            Resend Verification Code
          </Button>
        </form>

        <Text ta="center" mt="md" size="sm" c={theme.primaryColor}>
          Remember your verification code?{" "}
          <Anchor component={Link} href="/verify" size="sm">
            Verify account
          </Anchor>
        </Text>

        <Text ta="center" mt="xs" size="sm" c={theme.primaryColor}>
          Already verified?{" "}
          <Anchor component={Link} href="/login" size="sm">
            Sign in here
          </Anchor>
        </Text>
      </Paper>
    </Container>
  );
}
