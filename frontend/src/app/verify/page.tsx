"use client";

import { useAuth } from "@/constants/AuthContext";
import { theme } from "@/constants/theme";
import {
  Alert,
  Anchor,
  Button,
  Container,
  Paper,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function SuspenseWrap() {
  return (
    <Suspense>
      <VerifyPage />
    </Suspense>
  );
}

const VerifyPage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { handleConfirmSignup } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // get username from URL params if available (passed from signup)
  const usernameFromParams = searchParams.get("username") || "";
  const confirmationCodeFromParams = searchParams.get("code") || "";

  const form = useForm({
    initialValues: {
      username: usernameFromParams,
      confirmationCode: confirmationCodeFromParams,
      password: "",
    },
    validate: {
      username: (value: string) =>
        value.length < 3 ? "Username must be at least 3 characters" : null,
      confirmationCode: (value: string) =>
        value.length < 6
          ? "Confirmation code must be at least 6 characters"
          : null,
      password: (value: string) =>
        value.length < 8 ? "Password must be at least 8 characters" : null,
    },
  });

  const onSubmit = async (values: {
    username: string;
    confirmationCode: string;
    password: string;
  }) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    handleConfirmSignup(
      values.username,
      values.confirmationCode,
      values.password,
      () => {
        // verification handles login automatically
        setSuccess(
          "Email verified successfully! Taking you to the home page..."
        );
        setTimeout(() => {
          setLoading(false);
          router.push("/");
        }, 1000);
      },
      (err: unknown) => {
        setLoading(false);
        const typedErr = err as { code?: string; message: string };

        if (typedErr.code === "CodeMismatchException") {
          setError(
            "Invalid verification code. Please check your email and try again."
          );
        } else if (typedErr.code === "ExpiredCodeException") {
          setError("Verification code has expired. Please request a new one.");
        } else if (typedErr.code === "NotAuthorizedException") {
          setError(
            "This account may already be verified. Try logging in directly."
          );
        } else {
          setError(
            typedErr.message || "Verification failed. Please try again."
          );
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
        Verify Your Email
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
            label="Username"
            placeholder="Your username"
            required
            {...form.getInputProps("username")}
          />

          <TextInput
            label="Verification Code"
            placeholder="Enter the code from your email"
            required
            mt="md"
            {...form.getInputProps("confirmationCode")}
          />

          <TextInput
            label="Password"
            type="password"
            placeholder="Your password"
            required
            mt="md"
            {...form.getInputProps("password")}
          />

          <Button
            type="submit"
            fullWidth
            mt="xl"
            loading={loading}
            disabled={!!success}
            bg={theme.primaryColor}
            style={{
              background: "linear-gradient(45deg, #1c7ed6, #339af0)",
            }}
          >
            Verify Account
          </Button>
        </form>

        <Text ta="center" mt="xs">
          Already verified?{" "}
          <Anchor
            component={Link}
            href="/login"
            size="sm"
            c={theme.primaryColor}
          ></Anchor>
        </Text>
      </Paper>
    </Container>
  );
};
