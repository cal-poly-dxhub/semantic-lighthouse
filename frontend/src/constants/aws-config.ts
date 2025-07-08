const awsConfig = {
  region: process.env.NEXT_PUBLIC_AWS_REGION as string,
  userPoolId: process.env.NEXT_PUBLIC_AWS_USER_POOL_ID as string,
  userPoolWebClientId: process.env
    .NEXT_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID as string,
  videoAuthApiUrl: process.env.NEXT_PUBLIC_MEETING_API_URL as string,
};

export default awsConfig;
