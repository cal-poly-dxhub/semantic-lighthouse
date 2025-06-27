"use client";

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
} from "amazon-cognito-identity-js";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import awsConfig from "./aws-config";

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  handleLogin: (
    emailOrUsername: string,
    password: string,
    onSuccess: (result: unknown) => void,
    onFailure: (err: unknown) => void
  ) => void;
  handleSignup: (
    email: string,
    username: string,
    password: string,
    onSuccess: (result: unknown) => void,
    onFailure: (err: unknown) => void
  ) => void;
  handleConfirmSignup: (
    username: string,
    confirmationCode: string,
    onSuccess: (result: unknown) => void,
    onFailure: (err: unknown) => void
  ) => void;
  handleLogout: () => void;
  handleChangePassword: (
    oldPassword: string,
    newPassword: string,
    onSuccess: () => void,
    onFailure: (err: unknown) => void
  ) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const userPool = new CognitoUserPool({
  UserPoolId: awsConfig.userPoolId,
  ClientId: awsConfig.userPoolWebClientId,
});

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const handleLogin = async (
    emailOrUsername: string,
    password: string,
    onSuccess: (result: unknown) => void,
    onFailure: (err: unknown) => void
  ) => {
    const authData = {
      Username: emailOrUsername,
      Password: password,
    };

    const authDetails = new AuthenticationDetails(authData);

    const userData = {
      Username: emailOrUsername,
      Pool: userPool,
    };
    const cognitoUser = new CognitoUser(userData);

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (result) => {
        const newToken = result.getIdToken().getJwtToken();
        const payload = result.getIdToken().payload;

        console.log("Authentication successful, token:", newToken);
        console.log("User data:", payload);

        // Extract user information from the token payload
        const newUser: User = {
          id: payload.sub,
          email: payload.email || emailOrUsername,
          username: payload["cognito:username"] || emailOrUsername,
          name: payload.name || payload["cognito:username"] || emailOrUsername,
        };

        setUser(newUser);
        setToken(newToken);
        sessionStorage.setItem("token", newToken);
        sessionStorage.setItem("user", JSON.stringify(newUser));

        onSuccess(result);
      },
      onFailure: (err: unknown) => {
        console.error("Authentication failed:", err);
        onFailure(err);
      },
      mfaRequired: function (codeDeliveryDetails) {
        console.log("MFA required:", codeDeliveryDetails);
        // Handle MFA if needed
        onFailure(new Error("MFA required but not implemented yet"));
      },
      newPasswordRequired: function (userAttributes, requiredAttributes) {
        console.log(
          "New password required:",
          userAttributes,
          requiredAttributes
        );
        // Handle password change requirement
        onFailure(
          new Error("Password change required but not implemented yet")
        );
      },
    });
  };

  const handleSignup = async (
    email: string,
    username: string,
    password: string,
    onSuccess: (result: unknown) => void,
    onFailure: (err: unknown) => void
  ) => {
    const attributeList = [
      new CognitoUserAttribute({
        Name: "email",
        Value: email,
      }),
    ];

    userPool.signUp(username, password, attributeList, [], (err, result) => {
      if (err) {
        console.error("Signup failed:", err);
        onFailure(err);
      } else {
        console.log("Signup successful:", result);
        onSuccess(result);
      }
    });
  };

  const handleConfirmSignup = (
    username: string,
    confirmationCode: string,
    onSuccess: (result: unknown) => void,
    onFailure: (err: unknown) => void
  ) => {
    const userData = {
      Username: username,
      Pool: userPool,
    };
    const cognitoUser = new CognitoUser(userData);

    cognitoUser.confirmRegistration(confirmationCode, true, (err, result) => {
      if (err) {
        console.error("Email confirmation failed:", err);
        onFailure(err);
      } else {
        console.log("Email confirmed successfully:", result);
        onSuccess(result);
      }
    });
  };

  const handleLogout = () => {
    if (user) {
      const userData = {
        Username: user.username, // Use username instead of email for logout
        Pool: userPool,
      };

      const cognitoUser = new CognitoUser(userData);
      cognitoUser.signOut();
    }

    setUser(null);
    setToken(null);
    sessionStorage.clear();
  };

  const handleChangePassword = (
    oldPassword: string,
    newPassword: string,
    onSuccess: () => void,
    onFailure: (err: unknown) => void
  ) => {
    if (!user) {
      onFailure(new Error("No user is currently logged in"));
      return;
    }

    const userData = {
      Username: user.username, // Use username instead of email
      Pool: userPool,
    };
    const cognitoUser = new CognitoUser(userData);

    cognitoUser.changePassword(oldPassword, newPassword, (err, result) => {
      if (err) {
        console.error("Password change failed:", err);
        onFailure(err);
      } else {
        console.log("Password changed successfully:", result);
        onSuccess();
      }
    });
  };

  useEffect(() => {
    const storedUser = sessionStorage.getItem("user");
    const storedToken = sessionStorage.getItem("token");

    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      } catch (error) {
        console.error("Error parsing stored user:", error);
        sessionStorage.removeItem("user");
      }
    }

    if (storedToken) {
      setToken(storedToken);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        handleLogin,
        handleSignup,
        handleConfirmSignup,
        handleLogout,
        handleChangePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export { AuthProvider, useAuth };
