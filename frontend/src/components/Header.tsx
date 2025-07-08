"use client";

import { useAuth } from "@/constants/AuthContext";
import {
  Anchor,
  Box,
  Button,
  Group,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { memo } from "react";
import classes from "./HeaderMegaMenu.module.css";

const Header = memo(function DefaultHeader() {
  const theme = useMantineTheme();
  const { user, handleLogout, isLoading } = useAuth();

  // try to prevent flickering
  const renderAuthButtons = () => {
    if (isLoading) {
      return (
        // placeholder for layout
        <Group visibleFrom="sm" style={{ minHeight: "36px" }} />
      );
    }

    if (user) {
      return (
        <Group visibleFrom="sm">
          <Button variant="default" onClick={handleLogout}>
            Log out
          </Button>
        </Group>
      );
    }

    return (
      <Group visibleFrom="sm">
        <Button variant="default" component="a" href="/login">
          Log in
        </Button>
        <Button bg={theme.primaryColor} component="a" href="/signup">
          Sign up
        </Button>
      </Group>
    );
  };

  return (
    <Box pb={120}>
      <header className={classes.header}>
        <Group justify="space-between" h="100%">
          <Group h="100%" gap={0} visibleFrom="sm">
            <Title order={4} className={classes.title} mr={theme.spacing.md}>
              Semantic Lighthouse
            </Title>
            {user ? (
              <>
                <Anchor
                  href="/"
                  className={classes.link}
                  style={{ textDecoration: "none" }}
                >
                  Home
                </Anchor>
                <Anchor
                  href="/upload"
                  className={classes.link}
                  style={{ textDecoration: "none" }}
                >
                  Upload
                </Anchor>
                <Anchor
                  href="/create-user"
                  className={classes.link}
                  style={{ textDecoration: "none" }}
                >
                  Create User
                </Anchor>
              </>
            ) : (
              <></>
            )}
          </Group>
          {renderAuthButtons()}
        </Group>
      </header>
    </Box>
  );
});

export default Header;
