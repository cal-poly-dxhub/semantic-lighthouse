"use client";

import { useApiRequest } from "@/constants/apiRequest";
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

export default function SetupAccountPage() {
  const theme = useMantineTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { user, handleLogin } = useAuth();
  const { apiRequest } = useApiRequest();
  const router = useRouter();

  const form = useForm({
    initialValues: {
      email: user?.email || "",
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
      const { data, status, error } = await apiRequest<{
        message: string;
        accessToken: string;
        idToken: string;
        refreshToken: string;
      }>("POST", "users/setup", {
        body: {
          email: values.email,
          temporaryPassword: values.temporaryPassword,
          newPassword: values.newPassword,
        },
      });

      if (status !== 200) {
        throw new Error(error || "Failed to change password");
      }

      if (!data || !data.accessToken || !data.idToken || !data.refreshToken) {
        throw new Error("Unexpected response from server");
      }

      if (error) {
        throw new Error(error);
      }

      handleLogin(
        values.email,
        values.newPassword,
        () => {
          setLoading(false);
          setSuccess(
            "Password changed successfully! Redirecting to dashboard..."
          );
          router.push("/");
        },
        (err: unknown) => {
          setLoading(false);
          setError(
            (err as { message: string }).message ||
              "Login failed. Please try again."
          );
        }
      );
    } catch (err) {
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
