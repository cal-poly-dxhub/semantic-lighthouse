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
  // TODO: in prod use lazy initialization because will be deployed statically
  // const [user, setUser] = useState<User | null>(() => {
  //   if (typeof window === "undefined") return null;
  //   const storedUser = localStorage.getItem("user");
  //   return storedUser ? JSON.parse(storedUser) : null;
  // });
  // const [token, setToken] = useState<string | null>(() => {
  //   if (typeof window === "undefined") return null;
  //   return localStorage.getItem("token");
  // });
  // end prod section

  // TODO: for development use this whole block (flickery buttons)
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    // check localStorage for user and token on initial load
    const storedUser = localStorage.getItem("user");
    const storedToken = localStorage.getItem("token");

    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    if (storedToken) {
      setToken(storedToken);
    }
  }, []);
  // end development section

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

        // console.log("Authentication successful, token:", newToken);
        // console.log("User data:", payload);

        // Extract user information from the token payload
        const newUser: User = {
          id: payload.sub,
          email: payload.email || emailOrUsername,
          username: payload["cognito:username"] || emailOrUsername,
          name: payload.name || payload["cognito:username"] || emailOrUsername,
        };

        setUser(newUser);
        setToken(newToken);
        localStorage.setItem("token", newToken);
        localStorage.setItem("user", JSON.stringify(newUser));

        // console.log("User logged in:", newUser);
        // console.log(localStorage.getItem("user"));

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
    password: string,
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
        // automatically log in the user after confirmation
        handleLogin(username, password, onSuccess, onFailure);
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
    localStorage.clear();
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
