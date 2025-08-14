import { CustomMessageTriggerEvent } from "aws-lambda";

const messageAdminCreatedUser = (event: CustomMessageTriggerEvent) => ({
  emailSubject: "Welcome to Semantic Lighthouse!",
  emailMessage: `
    <h2>Welcome to Semantic Lighthouse!</h2>
    <p>Your account has been created. Please use the following credentials to log in:</p>
    <p><strong>Username:</strong> ${event.request.usernameParameter}</p>
    <p><strong>Temporary Password:</strong> ${event.request.codeParameter}</p>
    <p>Or <a href="${process.env.FRONTEND_URL}/login?email=${encodeURIComponent(
    event.request.userAttributes.email
  )}">click here</a> to login</p>
    <p>You will be required to change your password on first login.</p>
  `,
});

const firstUserEmailVerification = (event: CustomMessageTriggerEvent) => ({
  emailSubject: "Welcome to Semantic Lighthouse",
  emailMessage: `
    <h2>Verify your email address</h2>
    <p>Thank you for signing up for Semantic Lighthouse!</p>
    <p>Please verify your email address by entering the following code:</p>
    <p><strong>Verification Code:</strong> ${
      event.request.codeParameter
    } or <a href="${process.env.FRONTEND_URL}/verify?code=${
    event.request.codeParameter
  }&username=${encodeURIComponent(event.userName)}">click here to verify</a></p>
    <p>This code will expire in 24 hours.</p>
    <p>If you didn't create an account, please ignore this email.</p>
  `,
});

// const resendVerificationCode = (event: CustomMessageTriggerEvent) => ({
//   emailSubject: "Semantic Lighthouse - Verification Code",
//   emailMessage: `
//     <h2>Your verification code</h2>
//     <p>Here's your requested verification code for Semantic Lighthouse:</p>
//     <p><strong>Verification Code:</strong> ${event.request.codeParameter}</p>
//     <p>Or <a href="${process.env.FRONTEND_URL}/verify?code=${event.request.codeParameter}&email=${event.request.userAttributes.email}">click here to verify</a></p>
//     <p>This code will expire in 24 hours.</p>
//     <p>If you didn't request this code, please ignore this email.</p>
//   `,
// });

// const forgotPassword = (event: CustomMessageTriggerEvent) => ({
//   emailSubject: "Semantic Lighthouse - Password Reset",
//   emailMessage: `
//     <h2>Reset your password</h2>
//     <p>You requested a password reset for your Semantic Lighthouse account.</p>
//     <p>Please use the following code to reset your password:</p>
//     <p><strong>Reset Code:</strong> ${event.request.codeParameter}</p>
//     <p>Or <a href="${process.env.FRONTEND_URL}/reset-password?code=${event.request.codeParameter}&email=${event.request.userAttributes.email}">click here to reset your password</a></p>
//     <p>This code will expire in 24 hours.</p>
//     <p>If you didn't request a password reset, please ignore this email.</p>
//   `,
// });

// const verifyEmailChange = (event: CustomMessageTriggerEvent) => ({
//   emailSubject: "Semantic Lighthouse - Verify Email Change",
//   emailMessage: `
//     <h2>Verify your new email address</h2>
//     <p>You requested to change your email address for Semantic Lighthouse.</p>
//     <p>Please verify your new email address by entering the following code:</p>
//     <p><strong>Verification Code:</strong> ${event.request.codeParameter}</p>
//     <p>Or <a href="${process.env.FRONTEND_URL}/verify-email-change?code=${event.request.codeParameter}&email=${event.request.userAttributes.email}">click here to verify</a></p>
//     <p>This code will expire in 24 hours.</p>
//     <p>If you didn't request this change, please contact support immediately.</p>
//   `,
// });

// const mfaSetup = (event: CustomMessageTriggerEvent) => ({
//   emailSubject: "Semantic Lighthouse - MFA Setup",
//   emailMessage: `
//     <h2>Multi-Factor Authentication Setup</h2>
//     <p>Please use the following code to complete your MFA setup:</p>
//     <p><strong>Setup Code:</strong> ${event.request.codeParameter}</p>
//     <p>This code will expire in 15 minutes.</p>
//     <p>If you didn't initiate MFA setup, please contact support.</p>
//   `,
// });

export const handler = async (event: CustomMessageTriggerEvent) => {
  console.log("INFO: Custom message event:", JSON.stringify(event, null, 2));
  event.response = event.response || {};

  if (event.triggerSource === "CustomMessage_AdminCreateUser") {
    const { emailMessage, emailSubject } = messageAdminCreatedUser(event);
    event.response.emailSubject = emailSubject;
    event.response.emailMessage = emailMessage;
    // event.response.smsMessage = emailMessage;
  } else if (event.triggerSource === "CustomMessage_SignUp") {
    const { emailMessage, emailSubject } = firstUserEmailVerification(event);
    event.response.emailSubject = emailSubject;
    event.response.emailMessage = emailMessage;
  }
  // else if (event.triggerSource === "CustomMessage_ResendCode") {
  //   const { emailMessage, emailSubject } = resendVerificationCode(event);
  //   event.response.emailSubject = emailSubject;
  //   event.response.emailMessage = emailMessage;
  // } else if (event.triggerSource === "CustomMessage_ForgotPassword") {
  //   const { emailMessage, emailSubject } = forgotPassword(event);
  //   event.response.emailSubject = emailSubject;
  //   event.response.emailMessage = emailMessage;
  // } else if (event.triggerSource === "CustomMessage_UpdateUserAttribute") {
  //   const { emailMessage, emailSubject } = verifyEmailChange(event);
  //   event.response.emailSubject = emailSubject;
  //   event.response.emailMessage = emailMessage;
  // } else if (event.triggerSource === "CustomMessage_VerifyUserAttribute") {
  //   const { emailMessage, emailSubject } = verifyEmailChange(event);
  //   event.response.emailSubject = emailSubject;
  //   event.response.emailMessage = emailMessage;
  // } else if (event.triggerSource === "CustomMessage_Authentication") {
  //   const { emailMessage, emailSubject } = mfaSetup(event);
  //   event.response.emailSubject = emailSubject;
  //   event.response.emailMessage = emailMessage;
  // }
  else {
    console.warn(
      "WARN: Unhandled trigger source:",
      (event as CustomMessageTriggerEvent).triggerSource
    );
  }

  console.log(
    "INFO: Custom message event response:",
    JSON.stringify(event, null, 2)
  );

  return event;
};
