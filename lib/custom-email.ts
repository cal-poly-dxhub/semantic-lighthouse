import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { createBundledLambdaCode } from "./helpers/lambda-bundling";

export interface CustomEmailResourcesProps {
  userPool: cdk.aws_cognito.UserPool;
  frontendDistribution: cdk.aws_cloudfront.IDistribution;
}

export class CustomEmailResources extends Construct {
  constructor(scope: Construct, id: string, props: CustomEmailResourcesProps) {
    super(scope, id);

    const customMessageLambda = new cdk.aws_lambda.Function(
      this,
      "CustomMessageLambda",
      {
        description: "lambda function for custom email messages",
        runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
        code: createBundledLambdaCode("src/auth/customMessage/index.ts"),
        handler: "index.handler",
        environment: {
          FRONTEND_URL: `https://${props.frontendDistribution.distributionDomainName}`,
        },
        logGroup: new cdk.aws_logs.LogGroup(
          this,
          "CustomMessageLambdaLogGroup",
          {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          }
        ),
      }
    );

    // grant lambda permission to be invoked by cognito
    customMessageLambda.addPermission("CognitoInvokePermission", {
      principal: new cdk.aws_iam.ServicePrincipal("cognito-idp.amazonaws.com"),
      sourceArn: props.userPool.userPoolArn,
    });

    // trigger for custom messages (signup verification and admin created user)
    props.userPool.addTrigger(
      cdk.aws_cognito.UserPoolOperation.CUSTOM_MESSAGE,
      customMessageLambda
    );
  }
}
