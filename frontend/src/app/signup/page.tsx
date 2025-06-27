"use client";

import { useAuth } from "@/constants/AuthContext";
import {
  Alert,
  Anchor,
  Button,
  Container,
  Paper,
  PasswordInput,
  Text,
  TextInput,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const theme = useMantineTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { handleSignup } = useAuth();
  const router = useRouter();

  const form = useForm({
    initialValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : "Invalid email"),
      username: (value) =>
        value.length < 3 ? "Username must be at least 3 characters" : null,
      password: (value) =>
        value.length < 8 ? "Password must be at least 8 characters" : null,
      confirmPassword: (value, values) =>
        value !== values.password ? "Passwords do not match" : null,
    },
  });

  const onSubmit = async (values: {
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
  }) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    handleSignup(
      values.email,
      values.username,
      values.password,
      () => {
        setLoading(false);
        setSuccess(
          "Account created successfully! Redirecting to verification page..."
        );
        setTimeout(() => {
          router.push(
            `/verify?username=${encodeURIComponent(values.username)}`
          );
        }, 2000);
      },
      (err: unknown) => {
        setLoading(false);
        const typedErr = err as { code?: string; message: string };

        if (
          typedErr.code === "NotAuthorizedException" &&
          typedErr.message.includes("sign-up is not allowed")
        ) {
          setError(
            "New user registration is currently closed. Please contact an administrator to get an account."
          );
        } else if (typedErr.code?.includes("self")) {
          setError(
            "Self-signup is currently disabled. Please contact an administrator to get an account."
          );
        } else {
          setError(typedErr.message || "Signup failed. Please try again.");
        }
      }
    );
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
        Join Semantic Lighthouse
      </Title>

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
            label="Email"
            placeholder="your@email.com"
            required
            {...form.getInputProps("email")}
          />
          <TextInput
            label="Username"
            placeholder="Choose a username"
            required
            mt="md"
            {...form.getInputProps("username")}
          />
          <PasswordInput
            label="Password"
            placeholder="Your password"
            required
            mt="md"
            {...form.getInputProps("password")}
          />
          <PasswordInput
            label="Confirm Password"
            placeholder="Confirm your password"
            required
            mt="md"
            {...form.getInputProps("confirmPassword")}
          />
          <Button
            type="submit"
            fullWidth
            mt="xl"
            loading={loading}
            disabled={!!success}
            bg={theme.primaryColor}
          >
            Create Account
          </Button>
        </form>

        <Text ta="center" mt="md">
          Already have an account?{" "}
          <Anchor
            component={Link}
            href="/login"
            size="sm"
            c={theme.primaryColor}
          >
            Sign in here
          </Anchor>
        </Text>
      </Paper>
    </Container>
  );
}
