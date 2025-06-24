"use client";

import {
  Alert,
  Button,
  Container,
  Paper,
  PasswordInput,
  Text,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../constants/AuthContext";

export default function ChangePasswordPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { handleChangePassword, user } = useAuth();
  const router = useRouter();

  const form = useForm({
    initialValues: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    validate: {
      newPassword: (value) =>
        value.length < 8 ? "Password must be at least 8 characters" : null,
      confirmPassword: (value, values) =>
        value !== values.newPassword ? "Passwords do not match" : null,
    },
  });

  const onSubmit = async (values: {
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) => {
    if (!user) {
      setError("You must be logged in to change your password");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    handleChangePassword(
      values.oldPassword,
      values.newPassword,
      () => {
        setLoading(false);
        setSuccess("Password changed successfully!");
        form.reset();
        setTimeout(() => {
          router.push("/dashboard");
        }, 2000);
      },
      (err) => {
        setLoading(false);
        setError(
          (err as { message: string }).message ||
            "Failed to change password. Please try again."
        );
      }
    );
  };

  if (!user) {
    return (
      <Container size={420} my={40}>
        <Alert color="red">
          You must be logged in to change your password.
        </Alert>
      </Container>
    );
  }

  return (
    <Container size={420} my={40}>
      <Title
        ta="center"
        style={{
          fontFamily: "Greycliff CF, var(--mantine-font-family)",
          fontWeight: 900,
        }}
      >
        Change Password
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Enter your current password and choose a new one
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
          <PasswordInput
            label="Current Password"
            placeholder="Enter current password"
            required
            {...form.getInputProps("oldPassword")}
          />
          <PasswordInput
            label="New Password"
            placeholder="Enter new password"
            required
            mt="md"
            {...form.getInputProps("newPassword")}
          />
          <PasswordInput
            label="Confirm New Password"
            placeholder="Confirm new password"
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
            style={{
              background: "linear-gradient(45deg, #1c7ed6, #339af0)",
            }}
          >
            Change Password
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
