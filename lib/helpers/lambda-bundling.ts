import * as cdk from "aws-cdk-lib";

export function createBundledLambdaCode(entryPoint: string): cdk.aws_lambda.AssetCode {
  return cdk.aws_lambda.Code.fromAsset("lambda", {
    bundling: {
      image: cdk.aws_lambda.Runtime.NODEJS_22_X.bundlingImage,
      command: [
        "bash",
        "-c",
        `npm config set cache /tmp/.npm && npm install -g esbuild && cd /asset-input && esbuild ${entryPoint} --bundle --platform=node --target=node22 --outfile=/asset-output/index.js --external:aws-sdk --tsconfig=tsconfig.json`,
      ],
      user: "root",
    },
  });
}