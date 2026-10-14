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
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function SuspenseWrap() {
  return (
    <Suspense>
      <SetupAccountPage />
    </Suspense>
  );
}

function SetupAccountPage() {
  const theme = useMantineTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { handleLogin, handleCompleteNewPasswordChallenge } = useAuth();
  const router = useRouter();

  const searchParams = useSearchParams();
  const urlEmail = searchParams.get("email");

  const form = useForm({
    initialValues: {
      email: urlEmail ? decodeURIComponent(urlEmail) : "",
      temporaryPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    validate: {
      email: (value: string) =>
        /^\S+@\S+\.\S+$/.test(value) ? null : "Invalid email format",
      temporaryPassword: (value: string) =>
        value.length < 1 ? "Temporary password is required" : null,
      newPassword: (value: string) =>
        value.length < 8 ? "Password must be at least 8 characters" : null,
      confirmPassword: (value: string, values) =>
        value !== values.newPassword ? "Passwords do not match" : null,
    },
  });

  const onSubmit = async (values: {
    email: string;
    temporaryPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      handleLogin(
        values.email,
        values.temporaryPassword,
        () => {
          console.log("INFO: Password changed successfully");
          setLoading(false);
          setSuccess(
            "Password changed successfully! Redirecting to dashboard..."
          );
          router.push("/");
        },
        (err: unknown) => {
          console.error("Error changing password:", err);
          setLoading(false);
          setError(
            (err as { message: string }).message ||
              "Login failed. Please try again."
          );
        },
        (cognitoUser, userAttributes) => {
          console.log(
            "INFO: SETUP: New password required:",
            cognitoUser,
            userAttributes
          );

          handleCompleteNewPasswordChallenge(
            cognitoUser,
            values.newPassword,
            userAttributes,
            (result) => {
              console.log("INFO: SETUP: Password change successful:", result);
              setLoading(false);
              setSuccess(
                "Password changed successfully! Redirecting to dashboard..."
              );
              router.push("/");
            },
            (err) => {
              console.error("Error changing password:", err);
              setLoading(false);
              setError(
                (err as { message: string }).message ||
                  "Password change failed. Please try again."
              );
            }
          );
        }
      );
    } catch (err) {
      console.error("Error changing password:", err);
      const typedErr = err as { message: string };
      setError(typedErr.message || "Password change failed. Please try again.");
    } finally {
      setLoading(false);
    }
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
        Complete Account Setup
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

        <Text ta="center" mb="md" c="dimmed">
          Please change your temporary password to complete your account setup.
        </Text>

        <form onSubmit={form.onSubmit(onSubmit)}>
          <TextInput
            label="Email"
            placeholder="Your email address"
            required
            {...form.getInputProps("email")}
          />
          <PasswordInput
            label="Temporary Password"
            placeholder="Enter your temporary password"
            required
            mt="md"
            {...form.getInputProps("temporaryPassword")}
          />
          <PasswordInput
            label="New Password"
            placeholder="Choose a secure password"
            required
            mt="md"
            {...form.getInputProps("newPassword")}
          />
          <PasswordInput
            label="Confirm New Password"
            placeholder="Confirm your new password"
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
            Change Password
          </Button>
        </form>

        <Text ta="center" mt="md">
          Need help?{" "}
          <Anchor
            component={Link}
            href="/support"
            size="sm"
            c={theme.primaryColor}
          >
            Contact support
          </Anchor>
        </Text>
      </Paper>
    </Container>
  );
}
